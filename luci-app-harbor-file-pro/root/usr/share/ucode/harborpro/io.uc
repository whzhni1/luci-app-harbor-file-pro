

'use strict';

const _fs = require('fs');
const open = _fs.open,
      stat = _fs.stat,
      readfile = _fs.readfile,
      stdin = _fs.stdin,
      stdout = _fs.stdout,
      basename = _fs.basename,
      rename = _fs.rename,
      unlink = _fs.unlink,
      writefile = _fs.writefile;
const _ubus = require('ubus');
const connect = _ubus.connect;
const _uci = require('uci');
const cursor = _uci.cursor;

const CHUNK = 65536;

// A regex match has no fixed length, so the tail carried across chunks is a
// flat budget instead of needle-1; matches longer than this are not found.
const REGEX_CARRY = 16384;
const REPLACE_PROG = '/tmp/harbor_file_pro_replace.progress';
const SLICE_MAX = 1024 * 1024;

const SYSTEM_FOLDER_ROOTS = [
	'/bin', '/sbin', '/proc', '/dev', '/usr/bin', '/usr/sbin',
	'/usr/lib', '/usr/lib64', '/sys', '/lib64', '/overlay', '/rom'
];

const MIME_MAP = {
	png: 'image/png',  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
	bmp: 'image/bmp',  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
	avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
	mp4: 'video/mp4',  m4v: 'video/mp4',  mov: 'video/quicktime',
	webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
	ogv: 'video/ogg',  ts: 'video/mp2t',
	mp3: 'audio/mpeg', wav: 'audio/wav',  flac: 'audio/flac', aac: 'audio/aac',
	ogg: 'audio/ogg',  m4a: 'audio/mp4',  opus: 'audio/opus',
	pdf: 'application/pdf',
	txt: 'text/plain; charset=UTF-8'
};

let headers_sent = false;

function header(name, value) {
	printf('%s: %s\r\n', name, value);
}

function end_headers() {
	print("\r\n");
	headers_sent = true;
}

function fail(status, message) {
	if (!headers_sent) {
		printf("Status: %s\r\n", status);
		header('Content-Type', 'text/plain; charset=UTF-8');
		header('Cache-Control', 'no-store');
		end_headers();
	}
	print(message + "\n");
	exit(0);
}

function urldecode(s) {
	if (s == null)
		return null;
	s = replace('' + s, '+', ' ');
	return replace(s, /%([0-9A-Fa-f]{2})/g, (m, digits) => chr(hex(digits)));
}

function read_params() {
	let params = {};

	let parse = (blob) => {
		for (let pair in split(blob ?? '', '&')) {
			if (pair == '')
				continue;
			let kv = split(pair, '=', 2);
			params[urldecode(kv[0])] = urldecode(kv[1] ?? '');
		}
	};

	parse(getenv('QUERY_STRING'));

	let ctype = getenv('CONTENT_TYPE') ?? '';
	if (getenv('REQUEST_METHOD') == 'POST' &&
	    index(ctype, 'application/x-www-form-urlencoded') == 0) {
		let len = +(getenv('CONTENT_LENGTH') ?? 0);
		if (len > 0 && len < 65536)
			parse(stdin.read(len));
	}

	return params;
}

function normalize_path(path) {
	if (type(path) != 'string' || path == '' || substr(path, 0, 1) != '/')
		return null;

	let parts = [];

	for (let seg in split(path, '/')) {
		if (seg == '..') {
			if (!length(parts))
				return null;
			pop(parts);
		}
		else if (seg != '.' && seg != '') {
			push(parts, seg);
		}
	}

	return length(parts) ? '/' + join('/', parts) : '/';
}

function is_system_path(path) {
	for (let root in SYSTEM_FOLDER_ROOTS)
		if (path == root || substr(path, 0, length(root) + 1) == root + '/')
			return true;
	return false;
}

function allow_system_operations() {
	let uci = cursor();
	uci.load('harbor_file_pro');
	let v = uci.get('harbor_file_pro', 'main', 'allow_system_operations');
	uci.unload('harbor_file_pro');
	return (v == '1');
}

function session_id(params) {
	if (params.sessionid && match(params.sessionid, /^[a-fA-F0-9]{32}$/))
		return params.sessionid;

	let cookies = getenv('HTTP_COOKIE') ?? '';
	let m = match(cookies, /sysauth[_a-z]*=([a-fA-F0-9]{32})/);

	return m ? m[1] : null;
}

function authorize(sid, path, perm) {
	perm ??= 'read';

	if (!sid)
		return 'no session id (no sessionid parameter, no sysauth cookie)';

	let ubus = connect();
	if (!ubus)
		return 'cannot connect to ubus';

	let rv;
	try {
		rv = ubus.call('session', 'access', {
			ubus_rpc_session: sid,
			scope: 'file',
			object: path,
			function: perm
		});
	}
	catch (e) {
		rv = null;
	}

	if (rv?.access === true)
		return null;

	try {
		rv = ubus.call('session', 'access', {
			ubus_rpc_session: sid,
			scope: 'ubus',
			object: 'harborpro.file',
			function: perm
		});
	}
	catch (e) {
		rv = null;
	}

	if (rv?.access === true)
		return null;

	return sprintf('session has no %s grant for %s (file scope and harbor.file scope both denied)',
		perm, path);
}

function parse_range(header_value, size) {
	if (type(header_value) != 'string')
		return null;

	let m = match(header_value, /^bytes=(\d*)-(\d*)$/);
	if (!m)
		return null;

	let first = m[1], last = m[2];
	let start, end;

	if (first == '' && last == '') {
		return null;
	}
	else if (first == '') {
		let n = +last;
		if (n <= 0)
			return null;
		start = (size > n) ? (size - n) : 0;
		end = size - 1;
	}
	else {
		start = +first;
		end = (last == '') ? (size - 1) : +last;
	}

	if (start < 0 || start >= size)
		return 'unsatisfiable';

	if (end >= size)
		end = size - 1;

	if (end < start)
		return 'unsatisfiable';

	return { start, end, length: end - start + 1 };
}

function stream(fd, offset, remaining) {
	fd.seek(offset, 0);

	while (remaining > 0) {
		let want = (remaining < CHUNK) ? remaining : CHUNK;
		let buf = fd.read(want);

		if (!length(buf))
			break;

		stdout.write(buf);
		remaining -= length(buf);
	}

	stdout.flush();
}

function mime_for(path) {
	let m = match(basename(path), /\.([A-Za-z0-9]+)$/);
	let ext = m ? lc(m[1]) : '';
	return MIME_MAP[ext] ?? 'application/octet-stream';
}

function content_disposition(name, inline) {
	let ascii = replace(name, /[^\x20-\x7E]/g, '_');
	ascii = replace(ascii, '"', '');
	ascii = replace(ascii, '\\', '');

	let encoded = replace(name, /[^A-Za-z0-9._~-]/g, (c) => sprintf('%%%02X', ord(c)));

	return sprintf('%s; filename="%s"; filename*=UTF-8\'\'%s',
		inline ? 'inline' : 'attachment', ascii, encoded);
}

function home_dir() {
	let uci = cursor();
	uci.load('harbor_file_pro');
	let v = uci.get('harbor_file_pro', 'main', 'home_dir');
	uci.unload('harbor_file_pro');
	return normalize_path(v) ?? '/tmp/root';
}

function stable_hash(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < length(s); i++) {
		h = (h ^ ord(s, i)) & 0xFFFFFFFF;
		h = (h * 0x01000193) & 0xFFFFFFFF;
	}
	return sprintf('%08x', h);
}

function pump_body(len, sink) {
	let remaining = len;

	while (remaining > 0) {
		let want = (remaining < CHUNK) ? remaining : CHUNK;
		let buf = stdin.read(want);

		if (!length(buf))
			break;

		if (!sink(buf))
			return false;

		remaining -= length(buf);
	}

	return (remaining == 0);
}

function json_reply(status, obj) {
	printf("Status: %s\r\n", status);
	header('Content-Type', 'application/json; charset=UTF-8');
	header('Cache-Control', 'no-store');
	end_headers();
	printf('%J', obj);
}

function do_patch(path, params) {
	let st = stat(path);
	if (!st || st.type != 'file')
		fail('400 Bad Request', 'not a regular file');

	let offset = +(params.offset ?? -1);
	let len = +(getenv('CONTENT_LENGTH') ?? 0);

	if (offset != offset || offset < 0 || offset > st.size)
		return json_reply('400 Bad Request', { code: 1, message: 'offset out of range' });

	if (offset + len > st.size)
		return json_reply('400 Bad Request',
			{ code: 1, message: 'patch would extend the file, use mode=splice' });

	let expect = params.expected_size;
	if (expect != null && +expect != st.size)
		return json_reply('409 Conflict', {
			code: 2,
			message: 'the file changed on disk since it was opened',
			size: st.size
		});

	let fd = open(path, 'r+');
	if (!fd)
		return json_reply('403 Forbidden', { code: 1, message: 'cannot open for writing' });

	fd.seek(offset, 0);

	let written = 0;
	let okay = pump_body(len, (buf) => {
		if (fd.write(buf) == null)
			return false;
		written += length(buf);
		return true;
	});

	fd.flush();
	fd.close();

	if (!okay)
		return json_reply('500 Internal Server Error',
			{ code: 1, message: 'short write', written });

	json_reply('200 OK', { code: 0, message: 'success',
		data: { path, offset, written, size: st.size } });
}

function do_splice(path, params) {
	let st = stat(path);
	if (!st || st.type != 'file')
		fail('400 Bad Request', 'not a regular file');

	let start = +(params.start ?? -1);
	let end   = +(params.end ?? -1);
	let len   = +(getenv('CONTENT_LENGTH') ?? 0);

	if (start != start || end != end || start < 0 || end < start || end > st.size)
		return json_reply('400 Bad Request', { code: 1, message: 'range out of bounds' });

	let expect = params.expected_size;
	if (expect != null && +expect != st.size)
		return json_reply('409 Conflict', {
			code: 2,
			message: 'the file changed on disk since it was opened',
			size: st.size
		});

	let tmp = path + '.harbor-splice';
	let src = open(path, 'r');
	let dst = open(tmp, 'w', st.mode & 0o7777);

	if (!src || !dst) {
		if (src) src.close();
		if (dst) { dst.close(); unlink(tmp); }
		return json_reply('403 Forbidden', { code: 1, message: 'cannot open for writing' });
	}

	let copied = 0, okay = true;
	src.seek(0, 0);
	while (copied < start && okay) {
		let want = ((start - copied) < CHUNK) ? (start - copied) : CHUNK;
		let buf = src.read(want);
		if (!length(buf)) { okay = false; break; }
		if (dst.write(buf) == null) okay = false;
		copied += length(buf);
	}

	if (okay)
		okay = pump_body(len, (buf) => dst.write(buf) != null);

	if (okay) {
		src.seek(end, 0);
		while (true) {
			let buf = src.read(CHUNK);
			if (!length(buf))
				break;
			if (dst.write(buf) == null) { okay = false; break; }
		}
	}

	dst.flush();
	dst.close();
	src.close();

	if (!okay) {
		unlink(tmp);
		return json_reply('500 Internal Server Error',
			{ code: 1, message: 'rewrite failed' });
	}

	if (!rename(tmp, path)) {
		unlink(tmp);
		return json_reply('500 Internal Server Error',
			{ code: 1, message: 'rename failed' });
	}

	let nst = stat(path);
	json_reply('200 OK', { code: 0, message: 'success', data: {
		path, start, end,
		removed: end - start,
		inserted: len,
		size: nst?.size ?? 0
	}});
}

// ucode compiles dynamic patterns with POSIX ERE.  Perl classes are silently
// ignored there (regexp("\\d{3}") matches nothing at all), so map the few that
// have an exact ERE equivalent and refuse the rest instead of pretending.
const RE_CLASSES = {
	d: '[0-9]', D: '[^0-9]',
	w: '[A-Za-z0-9_]', W: '[^A-Za-z0-9_]',
	s: '[ \t\r\n\f\v]', S: '[^ \t\r\n\f\v]'
};

function re_error(pattern) {
	if (index(pattern, chr(0)) >= 0)
		return 'pattern must not contain a NUL byte';

	for (let i = 0; i + 1 < length(pattern); i++) {
		if (ord(substr(pattern, i, 1)) != 0x5c)
			continue;

		let c = substr(pattern, i + 1, 1);
		let o = ord(c);

		if (RE_CLASSES[c] == null && ((o >= 48 && o <= 57) || (o >= 65 && o <= 90) || (o >= 97 && o <= 122)))
			return 'unsupported escape \\' + c;

		i++;
	}

	if (index(pattern, '(?') >= 0)
		return 'group extensions like (? are not supported';

	return null;
}

function ere_translate(pattern) {
	let out = '';

	for (let i = 0; i < length(pattern); i++) {
		if (ord(substr(pattern, i, 1)) != 0x5c || i + 1 >= length(pattern)) {
			out += substr(pattern, i, 1);
			continue;
		}

		let c = substr(pattern, i + 1, 1);
		out += RE_CLASSES[c] != null ? RE_CLASSES[c] : ('\\' + c);
		i++;
	}

	return out;
}

// regexec stops at the first NUL, so binary data is matched segment by segment
// while the offsets stay absolute.  ucode exposes no match indices, but split()
// hands out the pieces between matches, so the offsets are reconstructed from
// their lengths -- and a pattern able to match the empty string shows up as a
// piece count that does not add up.
function regex_scan(hay, base, re_all, re_one) {
	let out = [], at = 0;
	let segs = split(hay, chr(0));

	for (let i = 0; i < length(segs); i++) {
		let hits = match(segs[i], re_all);
		let parts = split(segs[i], re_one);

		if (hits == null) {
			at += length(segs[i]);
		} else {
			if (length(parts) != length(hits) + 1)
				return null;

			for (let k = 0; k < length(hits); k++) {
				at += length(parts[k]);
				push(out, [ base + at, length(hits[k][0]) ]);
				at += length(hits[k][0]);
			}

			at += length(parts[length(hits)]);
		}

		if (i + 1 < length(segs))
			at += 1;
	}

	return out;
}

const RE_EMPTY_MSG = 'pattern may match an empty string';

// Shared by search and replace-all: the same engine, the same refusals.
function compile_regex(needle, enc, icase) {
	if (enc == 'hex')
		return { error: 'regex needs text encoding' };

	let why = re_error(needle);

	if (why)
		return { error: why };

	try {
		let src = ere_translate(needle);
		return {
			all: regexp(src, 'g' + (icase ? 'i' : '')),
			one: regexp(src, icase ? 'i' : '')
		};
	} catch (e) {
		return { error: 'invalid pattern' };
	}
}

// The fold must never change the byte count, or the offsets we report into the
// raw file drift (and replace-all rewrites unrelated bytes).  ucode's lc()
// drops the NULs that file data is full of, so instead of giving up on the whole
// 64 KiB chunk the haystack is folded NUL-free segment by NUL-free segment --
// split() keeps the NULs, so the offsets stay absolute.  A segment whose fold
// still changes length is matched exactly rather than approximately.
function fold_segments(hay, base, needle, icase) {
	let out = [];

	if (!icase) {
		push(out, [ hay, base, needle ]);
		return out;
	}

	let f_needle = lc(needle);
	let fold_needle = length(f_needle) == length(needle);
	let segs = split(hay, chr(0));
	let at = base;

	for (let i = 0; i < length(segs); i++) {
		let seg = segs[i];
		let f_seg = lc(seg);
		let safe = fold_needle && length(f_seg) == length(seg);

		push(out, [ safe ? f_seg : seg, at, safe ? f_needle : needle ]);
		at += length(seg) + 1;
	}

	return out;
}

function decode_needle(q, encoding) {
	if (encoding != 'hex')
		return q;

	let clean = replace(q, /[^0-9A-Fa-f]/g, '');
	if (length(clean) % 2)
		return null;

	let out = '';
	for (let i = 0; i < length(clean); i += 2)
		out += chr(hex(substr(clean, i, 2)));

	if (length(out) * 2 != length(clean))
		return null;

	return out;
}

// Rewrite the byte range [start,end) with `repl` (in-memory string), via the
// same streamed head/body/tail rewrite do_splice uses. Returns null on
// success or an error string.
function splice_string(path, st, start, end, repl) {
	let tmp = path + '.harbor-replace';
	let src = open(path, 'r');
	let dst = open(tmp, 'w', st.mode & 0o7777);

	if (!src || !dst) {
		if (src) src.close();
		if (dst) { dst.close(); unlink(tmp); }
		return 'cannot open for writing';
	}

	let copied = 0, okay = true;
	src.seek(0, 0);
	while (copied < start && okay) {
		let want = ((start - copied) < CHUNK) ? (start - copied) : CHUNK;
		let buf = src.read(want);
		if (!length(buf)) { okay = false; break; }
		if (dst.write(buf) == null) okay = false;
		copied += length(buf);
	}

	if (okay && length(repl) && dst.write(repl) == null)
		okay = false;

	if (okay) {
		src.seek(end, 0);
		while (true) {
			let buf = src.read(CHUNK);
			if (!length(buf))
				break;
			if (dst.write(buf) == null) { okay = false; break; }
		}
	}

	dst.flush();
	dst.close();
	src.close();

	if (!okay) {
		unlink(tmp);
		return 'rewrite failed';
	}

	if (!rename(tmp, path)) {
		unlink(tmp);
		return 'rename failed';
	}

	return null;
}

// Streamed whole-file replace-all for huge files: server-side scan collects
// every match offset (numbers only, flat memory), then rewrites back-to-front
// so earlier offsets stay valid. 1 TB costs the same as 1 KB.
// ONE streaming pass over the file: copy bytes, swapping each match range
// for the replacement. Progress is written every hit (i/total) so the
// frontend can show a live percentage; memory stays flat for any file size.
function rewrite_with_replacements(path, st, offsets, needle, repl, dst_path, lens) {
	let out_path = dst_path ?? path;
	let tmp = out_path + '.harbor-replace';
	let src = open(path, 'r');
	let dst = open(tmp, 'w', st.mode & 0o7777);

	if (!src || !dst) {
		if (src) src.close();
		if (dst) { dst.close(); unlink(tmp); }
		return 'cannot open for writing';
	}

	let total = length(offsets);
	let src_at = 0, okay = true, out_at = 0;

	for (let i = 0; i < total && okay; i++) {
		let at = offsets[i];

		let nlen = (lens != null) ? lens[i] : length(needle);

		while (src_at < at && okay) {
			let want = ((at - src_at) < CHUNK) ? (at - src_at) : CHUNK;
			let buf = src.read(want);
			if (!length(buf)) { okay = false; break; }
			if (dst.write(buf) == null) okay = false;
			else { src_at += length(buf); out_at += length(buf); }
		}

		if (!okay)
			break;

		src.seek(at + nlen, 0);
		src_at = at + nlen;
		if (length(repl) && dst.write(repl) == null)
			okay = false;
		else
			out_at += length(repl);

		writefile(REPLACE_PROG, sprintf('%d %d', i + 1, total));
	}

	while (okay) {
		let buf = src.read(CHUNK);
		if (!length(buf))
			break;
		if (dst.write(buf) == null) { okay = false; break; }
		out_at += length(buf);
	}

	dst.flush();
	dst.close();
	src.close();

	if (!okay) {
		unlink(tmp);
		writefile(REPLACE_PROG, '0 0');
		return 'rewrite failed';
	}

	if (!rename(tmp, out_path)) {
		unlink(tmp);
		return 'rename failed';
	}

	return null;
}

function stage_path(path) {
	return path + '.harbor-stage';
}

function do_stage_commit(path) {
	let sp = stage_path(path);

	if (!stat(sp))
		return json_reply('404 Not Found', { code: 1, message: 'no staged changes' });

	if (!rename(sp, path))
		return json_reply('500 Internal Server Error', { code: 1, message: 'commit failed' });

	json_reply('200 OK', { code: 0, message: 'success', data: { path } });
}

function do_stage_discard(path) {
	let sp = stage_path(path);

	if (stat(sp))
		unlink(sp);

	json_reply('200 OK', { code: 0, message: 'success', data: { path } });
}

function do_replace_all(path, params) {
	// Staged mode: rewrite SRC into path+'.harbor-stage' instead of the real
	// file, so the frontend can show the result and only commit on Save.
	// SRC must be the file itself or its own stage -- never arbitrary.
	let staging = (params.stage == '1');
	let src_path = path;
	let dst_path = null;

	if (staging) {
		dst_path = stage_path(path);
		let src = normalize_path(params.src ?? path);

		if (src != path && src != dst_path)
			return json_reply('400 Bad Request', { code: 1, message: 'invalid source' });

		src_path = src;

		if (src == dst_path && !stat(dst_path))
			return json_reply('404 Not Found', { code: 1, message: 'staged source missing' });
	}

	let st = stat(src_path);
	if (!st || st.type != 'file')
		fail('400 Bad Request', 'not a regular file');

	let enc = params.encoding ?? 'text';

	// One known range ("replace this hit only") needs no scan at all: the
	// frontend already knows where the match is and how long it was.
	let range = params.range != null ? split(params.range, ':') : null;

	if (range != null && length(range) == 2) {
		let at = +range[0];
		let len = +range[1];

		if (at != at || len != len || at < 0 || len < 0 || at + len > (st.size ?? 0))
			return json_reply('400 Bad Request', { code: 1, message: 'invalid range' });

		let rvalue = decode_needle(params.r ?? '', params.rencoding ?? enc);

		if (rvalue == null || length(rvalue) > 65536)
			return json_reply('400 Bad Request', { code: 1, message: 'empty or malformed pattern' });

		if (rewrite_with_replacements(src_path, st, [ at ], '', rvalue, dst_path, [ len ]))
			return json_reply('500 Internal Server Error', { code: 1, message: 'rewrite failed' });

		let rst = stat(dst_path ?? path);
		return json_reply('200 OK', { code: 0, message: 'success', data: {
			path, replaced: 1, size: rst?.size ?? st.size, staged: staging ? dst_path : null
		} });
	}

	let needle = decode_needle(params.q ?? '', enc);
	let repl = decode_needle(params.r ?? '', params.rencoding ?? enc);

	if (needle == null || length(needle) == 0)
		return json_reply('400 Bad Request', { code: 1, message: 'empty or malformed pattern' });

	if (length(needle) > 4096 || length(repl) > 65536)
		return json_reply('400 Bad Request', { code: 1, message: 'pattern too long' });

	let icase = (params.ignorecase == '1') && enc != 'hex';

	let rgx = params.regex == '1' ? compile_regex(needle, enc, icase) : null;

	if (rgx != null && rgx.error != null)
		return json_reply('400 Bad Request', { code: 1, message: rgx.error });

	// a regex hit has no fixed length, so lengths travel alongside the offsets
	let overlap = rgx != null ? REGEX_CARRY : length(needle) - 1;

	// pagination loop reusing do_search's proven carry scan
	let offsets = [];
	let match_lens = rgx != null ? [] : null;
	let cursor = 0;
	let size = st.size ?? 0;

	while (cursor < size) {
		let fd = open(src_path, 'r');
		if (!fd)
			return json_reply('403 Forbidden', { code: 1, message: 'cannot open file' });

		let matches = [];
		let lens = rgx != null ? [] : null;
		let carry = '';
		let carry_pos = cursor;
		let pos = cursor;
		let min_start = 0;

		fd.seek(cursor, 0);

		while (length(matches) < 1000) {
			let buf = fd.read(CHUNK);
			if (!length(buf))
				break;

			let hay = carry + buf;
			let base = carry_pos;

			if (rgx != null) {
				let found = regex_scan(hay, base, rgx.all, rgx.one);
				if (found == null) {
					fd.close();
					return json_reply('400 Bad Request', { code: 1, message: RE_EMPTY_MSG });
				}

				for (let i = 0; i < length(found) && length(matches) < 1000; i++) {
					let at = found[i][0];

					if (at < min_start)
						continue;

					min_start = at + found[i][1];

					if (at >= cursor) {
						push(matches, at);
						push(lens, found[i][1]);
					}
				}
			} else {
				let subs = fold_segments(hay, base, needle, icase);

				for (let s = 0; s < length(subs) && length(matches) < 1000; s++) {
					let from = 0;

					while (length(matches) < 1000) {
						let idx = index(substr(subs[s][0], from), subs[s][2]);
						if (idx < 0)
							break;
						let absolute = subs[s][1] + from + idx;
						if (absolute >= cursor) {
							push(matches, absolute);

							if (lens != null)
								push(lens, length(needle));
						}
						from += idx + 1;
					}
				}
			}

			pos = base + length(hay);
			carry = (overlap > 0) ? substr(hay, -overlap) : '';
			carry_pos = pos - length(carry);
		}

		fd.close();

		for (let i = 0; i < length(matches); i++) {
			push(offsets, matches[i]);

			if (match_lens != null)
				push(match_lens, lens[i]);
		}

		if (!length(matches))
			break;
		let last = matches[length(matches) - 1];
		cursor = (length(matches) >= 1000) ? last + 1 : size;
	}

	if (!length(offsets))
		return json_reply('200 OK', { code: 0, message: 'success',
			data: { path, replaced: 0, size } });

	let rv = rewrite_with_replacements(src_path, st, offsets, needle, repl, dst_path, match_lens);
	if (rv)
		return json_reply('500 Internal Server Error', { code: 1, message: rv });

	let nst = stat(dst_path ?? path);
	json_reply('200 OK', { code: 0, message: 'success',
		data: {
			path,
			replaced: length(offsets),
			size: nst?.size ?? size,
			staged: staging ? dst_path : null
		} });
}

function do_replace_progress(path, params) {
	let raw = trim(readfile(REPLACE_PROG) ?? '');
	let done = 0, total = 0;

	let m = match(raw, /^([0-9]+) ([0-9]+)$/);
	if (m) {
		done = +m[1];
		total = +m[2];
	}

	json_reply('200 OK', { code: 0, message: 'success', data: {
		path, done, total
	}});
}

function search_take(acc, at, len) {
	if (at < acc.min_start)
		return;

	acc.total++;

	if (acc.capped)
		return;

	if (acc.window_mode) {
		if (at >= acc.start && (acc.last_mode || at < acc.before)) {
			push(acc.window, at);
			push(acc.wlens, len);
			acc.accepted++;

			if (length(acc.window) > acc.limit) {
				acc.window = slice(acc.window, length(acc.window) - acc.limit);
				acc.wlens = slice(acc.wlens, length(acc.wlens) - acc.limit);
			}
		}

		return;
	}

	push(acc.matches, at);
	push(acc.mlens, len);

	if (length(acc.matches) >= acc.limit)
		acc.capped = true;
}

function do_search(path, params) {
	let st = stat(path);
	if (!st || st.type != 'file')
		fail('400 Bad Request', 'not a regular file');

	let enc = params.encoding ?? 'text';
	let needle = decode_needle(params.q ?? '', enc);

	if (needle == null || length(needle) == 0)
		return json_reply('400 Bad Request', { code: 1, message: 'empty or malformed pattern' });

	if (length(needle) > 4096)
		return json_reply('400 Bad Request', { code: 1, message: 'pattern too long' });

	let start = +(params.start ?? 0);
	if (start != start || start < 0) start = 0;

	let limit = +(params.limit ?? 100);
	if (limit != limit || limit < 1) limit = 100;
	if (limit > 1000) limit = 1000;

	let icase = (params.ignorecase == '1') && enc != 'hex';

	let rgx = params.regex == '1' ? compile_regex(needle, enc, icase) : null;

	if (rgx != null && rgx.error != null)
		return json_reply('400 Bad Request', { code: 1, message: rgx.error });

	let re_all = rgx != null ? rgx.all : null;
	let re_one = rgx != null ? rgx.one : null;

	let fd = open(path, 'r');
	if (!fd)
		return json_reply('403 Forbidden', { code: 1, message: 'cannot open file' });

	let overlap = re_all != null ? REGEX_CARRY : length(needle) - 1;
	let pos = start;
	let carry = '';
	let carry_pos = start;

	// Reverse navigation windows: last=1 returns the FINAL `limit` matches of
	// the file; before=X returns the final `limit` matches strictly below X.
	// `below` (how many matches precede the window) lets the client compute
	// absolute numbering; total always counts the whole file.
	let last_mode = (params.last == '1');
	let before = +(params.before ?? -1);
	if (before != before || before < -1)
		before = -1;
	let window_mode = last_mode || before >= 0;

	fd.seek(start, 0);

	let acc = {
		total: 0, accepted: 0, capped: false, matches: [], mlens: [], window: [], wlens: [],
		limit: limit, start: start, before: before, last_mode: last_mode, window_mode: window_mode,
		regex: re_all != null, min_start: 0
	};

	while (true) {
		let buf = fd.read(CHUNK);
		if (!length(buf))
			break;

		let hay = carry + buf;
		let base = carry_pos;

		if (acc.regex) {
			let found = regex_scan(hay, base, re_all, re_one);
			if (found == null) {
				fd.close();
				return json_reply('400 Bad Request', { code: 1, message: RE_EMPTY_MSG });
			}

			for (let i = 0; i < length(found); i++) {
				search_take(acc, found[i][0], found[i][1]);

				if (!acc.window_mode)
					acc.min_start = found[i][0] + found[i][1];
			}
		} else {
			let subs = fold_segments(hay, base, needle, icase);

			for (let s = 0; s < length(subs); s++) {
				let from = 0;

				while (true) {
					let idx = index(substr(subs[s][0], from), subs[s][2]);
					if (idx < 0)
						break;
					search_take(acc, subs[s][1] + from + idx, length(needle));
					from += idx + 1;
				}
			}
		}

		pos = base + length(hay);
		carry = (overlap > 0) ? substr(hay, -overlap) : '';
		carry_pos = pos - length(carry);
	}

	fd.close();

	if (window_mode) {
		json_reply('200 OK', { code: 0, message: 'success', data: {
			path,
			matches: acc.window,
			count: length(acc.window),
			total: acc.total,
			below: acc.accepted - length(acc.window),
			first: length(acc.window) ? acc.window[0] : null,
			next: null,
			scanned_to: pos,
			size: st.size,
			done: true
		}});
		return;
	}

	json_reply('200 OK', { code: 0, message: 'success', data: {
		path,
		matches: acc.matches,
		count: length(acc.matches),
		total: acc.total,
		lengths: acc.regex ? acc.mlens : null,
		next: acc.capped ? (acc.matches[length(acc.matches) - 1] + 1) : null,
		scanned_to: pos,
		size: st.size,
		done: true
	}});
}

function main() {
	let params = read_params();
	let mode   = params.mode ?? 'download';
	let path   = normalize_path(params.path);

	if (!path)
		fail('400 Bad Request', 'invalid path');

	let writing = (mode == 'patch' || mode == 'splice' || mode == 'replace_all' || mode == 'stage_commit' || mode == 'stage_discard');

	let sid = session_id(params);
	let reason = authorize(sid, path, writing ? 'write' : 'read');

	if (reason) {
		warn(sprintf('[harbor-io-pro] 403 mode=%s path=%s sid=%s: %s\n',
			mode, path, sid ? 'present' : 'missing', reason));
		fail('403 Forbidden', 'permission denied: ' + reason);
	}

	if (writing && is_system_path(path) && !allow_system_operations())
		fail('403 Forbidden', 'system folder access is disabled');

	if (mode == 'thumbnail') {
		let src = stat(path);

		if (!src)
			fail('404 Not Found', 'source not found');

		let key = stable_hash(join('|', [
			path, '' + (src.size ?? 0), '' + (src.mtime ?? 0), '256', 'contain-v2'
		]));

		let cache = home_dir() + '/.cache/pictures/' + key + '.jpg';

		if (!stat(cache))
			fail('404 Not Found', 'thumbnail not generated');

		path = cache;
		mode = 'inline';
	}

	if (mode == 'patch')       return do_patch(path, params);
	if (mode == 'replace_all')     return do_replace_all(path, params);
	if (mode == 'stage_commit')    return do_stage_commit(path);
	if (mode == 'stage_discard')   return do_stage_discard(path);
	if (mode == 'replace_progress') return do_replace_progress(path, params);
	if (mode == 'splice') return do_splice(path, params);
	if (mode == 'search') return do_search(path, params);

	let st = stat(path);

	if (!st)
		fail('404 Not Found', 'file not found');

	if (st.type != 'file')
		fail('400 Bad Request', 'not a regular file');

	let size = st.size ?? 0;
	let fd = open(path, 'r');

	if (!fd)
		fail('403 Forbidden', 'cannot open file');

	if (mode == 'slice') {
		let offset = +(params.offset ?? 0);
		let len    = +(params.length ?? 4096);

		if (offset != offset || offset < 0)  offset = 0;
		if (len != len || len <= 0)          len = 4096;
		if (len > SLICE_MAX)                 len = SLICE_MAX;

		if (offset > size)
			offset = size;

		if (offset + len > size)
			len = size - offset;

		printf("Status: 200 OK\r\n");
		header('Content-Type', 'application/octet-stream');
		header('Content-Length', '' + len);
		header('X-Harbor-Offset', '' + offset);
		header('X-Harbor-Total', '' + size);
		header('Accept-Ranges', 'bytes');
		header('Cache-Control', 'no-store');
		end_headers();

		if (len > 0)
			stream(fd, offset, len);

		fd.close();
		exit(0);
	}

	let inline = (mode == 'inline');
	let name   = params.filename ? basename(params.filename) : basename(path);
	let ctype  = params.mimetype ?? (inline ? mime_for(path) : 'application/octet-stream');

	let range = parse_range(getenv('HTTP_RANGE'), size);

	if (range == 'unsatisfiable') {
		fd.close();
		printf("Status: 416 Requested Range Not Satisfiable\r\n");
		header('Content-Range', sprintf('bytes */%d', size));
		header('Content-Type', 'text/plain');
		end_headers();
		exit(0);
	}

	if (range) {
		printf("Status: 206 Partial Content\r\n");
		header('Content-Range', sprintf('bytes %d-%d/%d', range.start, range.end, size));
		header('Content-Length', '' + range.length);
	}
	else {
		printf("Status: 200 OK\r\n");
		header('Content-Length', '' + size);
	}

	header('Content-Type', ctype);
	header('Content-Disposition', content_disposition(name, inline));
	header('Accept-Ranges', 'bytes');
	header('ETag', sprintf('"%x-%x"', st.mtime ?? 0, size));
	header('Cache-Control', 'private, max-age=0, must-revalidate');
	header('X-Content-Type-Options', 'nosniff');
	end_headers();

	if (getenv('REQUEST_METHOD') != 'HEAD') {
		if (range)
			stream(fd, range.start, range.length);
		else
			stream(fd, 0, size);
	}

	fd.close();
}

return {
	main
};
