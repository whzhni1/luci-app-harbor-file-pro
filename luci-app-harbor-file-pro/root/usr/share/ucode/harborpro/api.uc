#!/usr/bin/ucode

'use strict';

const _fs = require('fs');
const open = _fs.open,
      stat = _fs.stat,
      lsdir = _fs.lsdir,
      mkdir = _fs.mkdir,
      unlink = _fs.unlink,
      rmdir = _fs.rmdir,
      rename = _fs.rename,
      chmod = _fs.chmod,
      readfile = _fs.readfile,
      writefile = _fs.writefile,
      popen = _fs.popen,
      basename = _fs.basename,
      dirname = _fs.dirname,
      readlink = _fs.readlink;

const cursor = require('uci').cursor;

const CONFIG          = 'harbor_file_pro';
const CONFIG_FILE     = '/etc/config/harbor_file_pro';
const CONFIG_SECTION  = 'main';

const ARCHIVE_STATE_FILE   = '/tmp/harbor_file_pro_archive_state.json';
const PACKAGE_STATE_FILE   = '/tmp/harbor_file_pro_package_install_state.json';
const THUMBNAIL_STATE_FILE = '/tmp/harbor_file_pro_thumbnail_state.json';
const THUMBNAIL_CACHE_VERSION = 'contain-v2';

const OPERATION_SPACE_MARGIN = 16 * 1024 * 1024;

const COMMON_DIRECTORY_ENTRIES = [
	{ name: 'Documents', path_name: 'documents', icon: 'documents' },
	{ name: 'Pictures',  path_name: 'pictures',  icon: 'pictures'  },
	{ name: 'Videos',    path_name: 'videos',    icon: 'videos'    },
	{ name: 'Music',     path_name: 'music',     icon: 'music'     },
	{ name: 'Downloads', path_name: 'downloads', icon: 'downloads' }
];

const HIDDEN_MOUNTS = {
	'/rom': true, '/overlay': true, '/dev': true
};

const SYSTEM_FOLDER_ROOTS = [
	'/bin', '/sbin', '/proc', '/dev', '/usr/bin', '/usr/sbin',
	'/usr/lib', '/usr/lib64', '/sys', '/lib64', '/overlay', '/rom'
];

const IMAGE_MIME_MAP = {
	png: 'image/png',  jpg: 'image/jpeg', jpeg: 'image/jpeg',
	gif: 'image/gif',  bmp: 'image/bmp',  webp: 'image/webp',
	svg: 'image/svg+xml', ico: 'image/x-icon', tif: 'image/tiff',
	tiff: 'image/tiff', avif: 'image/avif'
};

const VIDEO_MIME_MAP = {
	mp4: 'video/mp4',   m4v: 'video/mp4',  mov: 'video/quicktime',
	webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
	ts: 'video/mp2t',   flv: 'video/x-flv', ogv: 'video/ogg'
};

const AUDIO_MIME_MAP = {
	mp3: 'audio/mpeg', wav: 'audio/wav',  flac: 'audio/flac',
	aac: 'audio/aac',  ogg: 'audio/ogg',  m4a: 'audio/mp4', opus: 'audio/opus'
};

const TOOL_PACKAGE_MAP = {
	unzip:    'unzip',
	tar:      'tar',
	gzip:     'gzip',
	gunzip:   'gzip',
	bzip2:    'bzip2',
	xz:       'xz-utils',
	ffmpeg:   'ffmpeg',
	convert:  'imagemagick',
	gm:       'graphicsmagick',
	ttyd:     'ttyd'
};

const TEXT_EXT_MAP = {
	txt: true, log: true, conf: true, cfg: true, ini: true, json: true,
	xml: true, csv: true, lua: true, sh: true, md: true, yaml: true,
	yml: true, html: true, htm: true, css: true, js: true
};

const PACKAGE_EXT_MAP = {
	ipk: { installer: 'opkg', args: [ 'install' ] },
	apk: { installer: 'apk',  args: [ 'add', '--allow-untrusted' ] }
};

const UHTTPD_SCRIPT_TIMEOUT_DEFAULT  = 600;
const UHTTPD_NETWORK_TIMEOUT_DEFAULT = 600;

const PREFERENCE_DEFAULTS = {
	window_width: 820,
	window_height: 620,
	mobile_window_width: 360,
	mobile_window_height: 560,
	view_mode: 1,
	allow_system_operations: 0,
	show_hidden_files: 0,
	home_dir: '/tmp/root',
	enable_thumbnails: 1,
	editor_auto_indent: 1,
	editor_auto_wrap: 0,
	restore_last_directory: 1,
	show_line_numbers: 1,
	last_directory: '',
	update_mirror: 'auto'
};

const BOOLEAN_VALUES  = { "0": true, "1": true };

const VIEW_MODE_VALUES = {
	"0": true, "1": true, "2": true, "3": true, "4": true, "5": true
};

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

function join_path(base, name) {
	if (base == '/')
		return '/' + name;
	return base + '/' + name;
}

function parent_path(path) {
	let n = normalize_path(path);
	if (!n || n == '/')
		return null;
	let parts = split(n, '/');
	pop(parts);
	let p = join('/', parts);
	return (p == '') ? '/' : p;
}

function path_name(path) {
	let n = normalize_path(path);
	if (!n || n == '/')
		return '/';
	let parts = split(n, '/');
	return parts[length(parts) - 1];
}

function file_extension(path) {
	let parts = split('' + (path ?? ''), '/');
	let name = parts[length(parts) - 1] ?? '';
	let m = match(name, /\.([A-Za-z0-9_]+)$/);
	return m ? lc(m[1]) : '';
}

function is_system_path(path) {
	let n = normalize_path(path);
	if (!n)
		return false;

	for (let root in SYSTEM_FOLDER_ROOTS)
		if (n == root || substr(n, 0, length(root) + 1) == root + '/')
			return true;

	return false;
}

function valid_component(name) {
	if (type(name) != 'string' || name == '' || name == '.' || name == '..')
		return false;
	if (index(name, '/') >= 0)
		return false;
	if (index(name, '\0') >= 0)
		return false;
	if (length(name) > 255)
		return false;
	return true;
}

function query_params(http_obj) {
	let out = {};
	let qs = http_obj.getenv('QUERY_STRING') ?? '';

	for (let pair in split(qs, '&')) {
		if (pair == '')
			continue;

		let kv = split(pair, '=', 2);
		let k = replace(kv[0] ?? '', '+', ' ');
		let v = replace(kv[1] ?? '', '+', ' ');

		k = replace(k, /%([0-9A-Fa-f][0-9A-Fa-f])/g, (m, d) => chr(hex(d)));
		v = replace(v, /%([0-9A-Fa-f][0-9A-Fa-f])/g, (m, d) => chr(hex(d)));

		if (k != '')
			out[k] = v;
	}

	return out;
}

function formvalue_any(http, names) {
	for (let n in names) {
		let v = http.formvalue(n);
		if (v != null && v != '')
			return v;
	}
	return null;
}

function write_json(http, obj) {
	http.prepare_content('application/json; charset=UTF-8');
	http.write_json(obj);
}

function write_json_status(http, code, msg, obj) {
	http.status(code, msg);
	http.prepare_content('application/json; charset=UTF-8');
	http.write_json(obj);
}

function ok(http, data) {
	write_json(http, { code: 0, message: 'success', data });
}

function fail(http, code, message, data) {
	write_json(http, { code: code ?? 1, message: message ?? 'failed', data });
}

function tr(text) {
	try { return _(text) ?? text; }
	catch (e) { return text; }
}

function read_json_file(path) {
	try {
		let fd = open(path, 'r');
		if (!fd)
			return null;
		let data = json(fd.read('all'));
		fd.close();
		return (type(data) == 'object') ? data : null;
	}
	catch (e) {
		return null;
	}
}

function write_json_file(path, obj) {
	try {
		let tmp = path + '.tmp';
		if (!writefile(tmp, sprintf('%J', obj)))
			return false;
		return rename(tmp, path);
	}
	catch (e) {
		return false;
	}
}

function normalize_number(value, fallback, allowed) {
	let n = +value;
	if (value == null || value == '' || n != n)
		return fallback;
	n = int(n);
	return allowed[`${n}`] ? n : fallback;
}

function normalize_dimension(value, fallback) {
	let n = +value;
	if (value == null || value == '' || n != n)
		return fallback;
	n = int(n);
	return (n >= 100 && n <= 8192) ? n : fallback;
}

function normalize_timeout(value, fallback) {
	let n = +value;
	if (value == null || value == '' || n != n)
		return fallback;
	n = int(n);
	return (n >= 1 && n <= 86400) ? n : fallback;
}

function normalize_home_dir(value) {
	let n = normalize_path(value);
	if (!n || n == '/')
		return PREFERENCE_DEFAULTS.home_dir;
	return n;
}

function ensure_config_file() {
	if (stat(CONFIG_FILE))
		return true;

	return writefile(CONFIG_FILE, sprintf("config %s '%s'\n", CONFIG, CONFIG_SECTION)) != null;
}

// Load the config on a fresh cursor, healing the file when needed:
//   missing  -> created by ensure_config_file()
//   unloadable (e.g. parse error from a migrated/edited file)
//            -> moved to <file>.bak and recreated with defaults
// Returns { uci, err } -- exactly one is set; err already translated.
function open_config() {
	if (!ensure_config_file())
		return { uci: null, err: sprintf(tr('Cannot create %s'), CONFIG_FILE) };

	for (let attempt = 0; attempt < 2; attempt++) {
		let uci = cursor();

		if (uci.load(CONFIG))
			return { uci, err: null };

		let detail;
		try { detail = require('uci').error(); }
		catch (e) { detail = null; }

		warn(sprintf('[harborpro] uci.load(%s) failed (%s), healing file\n',
			CONFIG, detail ?? 'unknown'));

		try { rename(CONFIG_FILE, CONFIG_FILE + '.bak'); }
		catch (e) {}
		if (writefile(CONFIG_FILE, sprintf("config %s '%s'\n", CONFIG, CONFIG_SECTION)) == null)
			return { uci: null, err: sprintf(tr('Cannot create %s'), CONFIG_FILE) };
	}

	return { uci: null, err: sprintf(tr('Cannot load the %s UCI config'), CONFIG) };
}

function read_preferences() {
	let opened = open_config();
	let uci = opened.uci;

	if (!uci)
		return { ...PREFERENCE_DEFAULTS };

	const g = (k) => uci.get(CONFIG, CONFIG_SECTION, k);

	let p = {
		view_mode:               normalize_number(g('view_mode'), PREFERENCE_DEFAULTS.view_mode, VIEW_MODE_VALUES),
		allow_system_operations: normalize_number(g('allow_system_operations'), PREFERENCE_DEFAULTS.allow_system_operations, BOOLEAN_VALUES),
		show_hidden_files:       normalize_number(g('show_hidden_files'), PREFERENCE_DEFAULTS.show_hidden_files, BOOLEAN_VALUES),
		home_dir:                normalize_home_dir(g('home_dir')),
		enable_thumbnails:       normalize_number(g('enable_thumbnails'), PREFERENCE_DEFAULTS.enable_thumbnails, BOOLEAN_VALUES),
		editor_auto_indent:      normalize_number(g('editor_auto_indent'), PREFERENCE_DEFAULTS.editor_auto_indent, BOOLEAN_VALUES),
		editor_auto_wrap:        normalize_number(g('editor_auto_wrap'), PREFERENCE_DEFAULTS.editor_auto_wrap, BOOLEAN_VALUES),
		restore_last_directory:  normalize_number(g('restore_last_directory'), PREFERENCE_DEFAULTS.restore_last_directory, BOOLEAN_VALUES),
		show_line_numbers:       normalize_number(g('show_line_numbers'), PREFERENCE_DEFAULTS.show_line_numbers, BOOLEAN_VALUES),
		last_directory:          '' + (g('last_directory') ?? ''),
		update_mirror:        ((g('update_mirror') == 'gitee' || g('update_mirror') == 'github' || g('update_mirror') == 'gitlab') ? g('update_mirror') : 'auto'),
		open_type_map:           g('open_type_map') ?? '',

		window_width:         normalize_dimension(g('window_width'),         PREFERENCE_DEFAULTS.window_width),
		window_height:        normalize_dimension(g('window_height'),        PREFERENCE_DEFAULTS.window_height),
		mobile_window_width:  normalize_dimension(g('mobile_window_width'),  PREFERENCE_DEFAULTS.mobile_window_width),
		mobile_window_height: normalize_dimension(g('mobile_window_height'), PREFERENCE_DEFAULTS.mobile_window_height)
	};

	uci.unload(CONFIG);
	return p;
}

function save_preference_values(values) {
	let opened = open_config();
	let uci = opened.uci;

	if (!uci)
		return opened.err;

	if (!uci.get(CONFIG, CONFIG_SECTION))
		uci.set(CONFIG, CONFIG_SECTION, CONFIG);

	for (let k, v in values)
		uci.set(CONFIG, CONFIG_SECTION, k, '' + v);

	uci.save(CONFIG);
	uci.commit(CONFIG);
	uci.unload(CONFIG);

	let verify = cursor();
	verify.load(CONFIG);

	let missing = [];
	for (let k, v in values)
		if ('' + (verify.get(CONFIG, CONFIG_SECTION, k) ?? '') != '' + v)
			push(missing, k);

	verify.unload(CONFIG);

	if (length(missing))
		return sprintf('%s did not persist to %s', join(', ', missing), CONFIG_FILE);

	return null;
}

function validate_write_request(http, path) {
	let prefs = read_preferences();

	if (path != null) {
		let n = normalize_path(path);
		if (!n) {
			write_json_status(http, 400, 'Bad Request',
				{ code: 1, message: tr('Invalid path') });
			return null;
		}
		if (is_system_path(n) && !prefs.allow_system_operations) {
			write_json_status(http, 403, 'Forbidden',
				{ code: 1, message: tr('System folder operations are disabled') });
			return null;
		}
		return n;
	}

	return prefs;
}

function lstat_safe(path) {
	try {
		return require('fs').lstat(path);
	}
	catch (e) {
		return stat(path);
	}
}

function mkdir_p(path) {
	let n = normalize_path(path);
	if (!n)
		return false;
	if (stat(n))
		return true;

	let cur = '';
	for (let seg in split(n, '/')) {
		if (seg == '')
			continue;
		cur += '/' + seg;
		let st = stat(cur);
		if (st) {
			if (st.type != 'directory')
				return false;
			continue;
		}
		if (!mkdir(cur, 0o755))
			return false;
	}

	return true;
}

function have_tool(name) {
	for (let dir in [ '/bin/', '/usr/bin/', '/sbin/', '/usr/sbin/' ])
		if (stat(dir + name))
			return true;
	return false;
}

function shellquote(s) {
	return "'" + replace('' + s, "'", "'\\''") + "'";
}

function remove_recursive(path) {
	let st = lstat_safe(path);
	if (!st)
		return true;

	if (st.type == 'directory') {
		for (let name in (lsdir(path) ?? []))
			if (!remove_recursive(join_path(path, name)))
				return false;
		return rmdir(path);
	}

	return unlink(path);
}

function unique_target(dir, name) {
	let target = join_path(dir, name);
	if (!lstat_safe(target))
		return target;

	let base = name, ext = '';
	let m = match(name, /^(.+)(\.[^.]+)$/);
	if (m) { base = m[1]; ext = m[2]; }

	for (let i = 1; i < 1000; i++) {
		target = join_path(dir, sprintf('%s (%d)%s', base, i, ext));
		if (!lstat_safe(target))
			return target;
	}

	return null;
}

const THUMBNAIL_SIZE = 256;

function thumbnail_cache_dir(prefs) {
	return normalize_path(join_path(join_path(prefs.home_dir, '.cache'), 'pictures'));
}

function stable_hash(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < length(s); i++) {
		h = (h ^ ord(s, i)) & 0xFFFFFFFF;
		h = (h * 0x01000193) & 0xFFFFFFFF;
	}
	return sprintf('%08x', h);
}

function thumbnail_cache_path(path, st, prefs) {
	let dir = thumbnail_cache_dir(prefs);
	if (!dir)
		return null;

	let key = stable_hash(join('|', [
		normalize_path(path) ?? '',
		'' + (st?.size ?? 0),
		'' + (st?.mtime ?? 0),
		'' + THUMBNAIL_SIZE,
		THUMBNAIL_CACHE_VERSION
	]));

	return join_path(dir, key + '.jpg');
}

function classify_preview(path, name) {
	let ext = file_extension(name);

	if (IMAGE_MIME_MAP[ext]) return 'image';
	if (TEXT_EXT_MAP[ext])   return 'text';
	if (VIDEO_MIME_MAP[ext]) return 'video';
	if (ext == 'pdf')        return 'pdf';
	if (PACKAGE_EXT_MAP[ext])return 'package';

	if (ext == '' && (path == '/etc' || substr(path, 0, 5) == '/etc/'))
		return 'text';

	return 'none';
}

function perm_string(mode) {
	const bits = [ 'r', 'w', 'x' ];
	let s = '';
	for (let i = 8; i >= 0; i--)
		s += ((mode >> i) & 1) ? bits[(8 - i) % 3] : '-';
	return s;
}

function stat_to_item(name, path, st, lst) {
	if (!st)
		return null;

	let is_link = (lst?.type == 'link');
	let kind = st.type;

	let link_target = null;

	if (is_link) {
		let raw = readlink(path);

		if (raw != null) {
			let abs = (substr(raw, 0, 1) == '/')
				? raw
				: join_path(parent_path(path) ?? '/', raw);

			link_target = {
				raw,
				path: normalize_path(abs) ?? abs
			};
		}
	}

	let item_type = (kind == 'directory') ? 'directory' : (is_link ? 'symlink' : 'file');
	let ext = (kind == 'directory') ? '' : file_extension(name);

	return {
		name,
		path,
		type: item_type,
		is_symlink: is_link,
		size: (kind == 'directory') ? -1 : (st.size ?? 0),
		mtime: st.mtime ?? 0,
		mode: sprintf('%o', (st.mode ?? 0) & 0o7777),
		permissions: perm_string(st.mode ?? 0),
		numeric_permissions: sprintf('%03o', (st.mode ?? 0) & 0o777),
		ext,
		extension: ext,
		preview: (item_type == 'directory') ? 'none' : classify_preview(path, name),
		link_target,
		hidden: (substr(name, 0, 1) == '.')
	};
}

function list_directory(path, prefs) {
	let n = normalize_path(path);
	if (!n)
		return { items: null, error: tr('Invalid path') };

	let st = stat(n);
	if (!st)
		return { items: null, error: tr('Path not found') };
	if (st.type != 'directory')
		return { items: null, error: tr('Not a directory') };

	let names = lsdir(n);
	if (names == null)
		return { items: null, error: tr('Permission denied') };

	let items = [];

	for (let name in names) {
		if (!prefs?.show_hidden_files && substr(name, 0, 1) == '.')
			continue;

		let full = join_path(n, name);
		let lst  = lstat_safe(full);
		let s    = stat(full) ?? lst;
		let item = stat_to_item(name, full, s, lst);

		if (!item)
			continue;

		if (prefs?.enable_thumbnails && item.preview == 'image') {
			let cp = thumbnail_cache_path(full, s, prefs);
			item.thumbnail_available = (cp != null && stat(cp) != null);
		}

		push(items, item);
	}

	sort(items, (a, b) => {
		let ad = (a.type == 'directory') ? 0 : 1;
		let bd = (b.type == 'directory') ? 0 : 1;
		if (ad != bd)
			return ad - bd;
		let al = lc(a.name), bl = lc(b.name);
		return (al < bl) ? -1 : ((al > bl) ? 1 : 0);
	});

	return { items, error: null };
}

function get_directory_space_info(path) {
	let n = normalize_path(path) ?? '/';
	let p = popen(sprintf("df -k -P %s 2>/dev/null | tail -n 1", shellquote(n)), 'r');

	if (!p)
		return { available: null, total: null, margin: OPERATION_SPACE_MARGIN };

	let line = p.read('all') ?? '';
	p.close();

	let f = split(trim(line), /\s+/);
	if (length(f) < 4)
		return { available: null, total: null, margin: OPERATION_SPACE_MARGIN };

	return {
		available: (+f[3]) * 1024,
		total:     (+f[1]) * 1024,
		margin:    OPERATION_SPACE_MARGIN
	};
}

function drive_name(device, mount) {
	if (mount == '/')
		return tr('System Disk');
	if (mount == '/tmp')
		return tr('Temporary Space');

	let parts = split(device ?? '', '/');
	let name = parts[length(parts) - 1] ?? '';
	return (name != '') ? name : (device ?? mount);
}

function list_drives() {
	let out = [], seen_mount = {}, seen_name = {};
	let p = popen("df -k -P 2>/dev/null | tail -n +2", 'r');
	if (!p)
		return out;

	for (let line = p.read('line'); length(line); line = p.read('line')) {
		let f = split(trim(line), /\s+/);
		if (length(f) < 6)
			continue;

		let device = f[0];
		let mount  = f[5];

		let keep = (mount == '/') || (mount == '/tmp') ||
			(substr(device, 0, 5) == '/dev/');

		if (!keep || HIDDEN_MOUNTS[mount] || seen_mount[mount])
			continue;

		seen_mount[mount] = true;

		let name = drive_name(device, mount);
		let key = lc(name);
		if (seen_name[key])
			continue;
		seen_name[key] = true;

		let total_kb = +f[1], used_kb = +f[2], avail_kb = +f[3];

		push(out, {
			name,
			path: mount,
			device,
			total_kb,
			used_kb,
			available_kb: avail_kb,
			usage_percent: total_kb ? int((used_kb * 100) / total_kb) : 0,
			mode: '---',
			total_bytes: total_kb * 1024,
			available_bytes: avail_kb * 1024,
			used_bytes: used_kb * 1024,
			is_system: (mount == '/')
		});
	}

	p.close();

	if (!seen_mount['/'])
		unshift(out, {
			name: tr('System Disk'), path: '/', device: 'rootfs',
			total_kb: 0, used_kb: 0, available_kb: 0, usage_percent: 0,
			mode: '---', total_bytes: 0, available_bytes: 0, used_bytes: 0,
			is_system: true
		});

	return out;
}

function list_root_folders() {
	let prefs = read_preferences();
	let res = list_directory('/', prefs);
	let out = [];

	for (let it in (res.items ?? []))
		if (it.type == 'directory')
			push(out, { name: it.name, path: it.path });

	return out;
}

function build_quick_access(prefs) {
	let home = normalize_home_dir(prefs?.home_dir);
	mkdir_p(home);

	let out = [];
	for (let e in COMMON_DIRECTORY_ENTRIES) {
		let p = normalize_path(join_path(home, e.path_name));
		if (!p)
			continue;

		mkdir_p(p);
		let st = stat(p);

		push(out, {
			name: tr(e.name),
			path: p,
			icon: e.icon,
			exists: (st != null && st.type == 'directory'),
			mtime: st?.mtime ?? 0,
			mode: st ? sprintf('%03o', st.mode & 0o777) : '---'
		});
	}

	return out;
}

function looks_like_text(buf) {
	let n = length(buf);
	let i = 0;

	while (i < n) {
		let b = ord(buf, i);

		if (b == 0)
			return false;

		if (b <= 0x7F) { i++; continue; }

		let need;
		if ((b & 0xE0) == 0xC0)      need = 1;
		else if ((b & 0xF0) == 0xE0) need = 2;
		else if ((b & 0xF8) == 0xF0) need = 3;
		else return false;

		if (i + need >= n)
			break;

		for (let k = 1; k <= need; k++)
			if ((ord(buf, i + k) & 0xC0) != 0x80)
				return false;

		i += need + 1;
	}

	return true;
}

function detect_content_type(path, st) {
	let ext = file_extension(path);

	if (IMAGE_MIME_MAP[ext]) return { kind: 'image', mime: IMAGE_MIME_MAP[ext] };
	if (VIDEO_MIME_MAP[ext]) return { kind: 'video', mime: VIDEO_MIME_MAP[ext] };
	if (AUDIO_MIME_MAP[ext]) return { kind: 'audio', mime: AUDIO_MIME_MAP[ext] };
	if (ext == 'pdf')        return { kind: 'pdf',   mime: 'application/pdf' };
	if (PACKAGE_EXT_MAP[ext]) return { kind: 'package', mime: 'application/octet-stream' };

	let fd = open(path, 'r');
	if (!fd)
		return { kind: 'binary', mime: 'application/octet-stream' };

	let sample = fd.read(4096) ?? '';
	fd.close();

	return looks_like_text(sample)
		? { kind: 'text',   mime: 'text/plain; charset=UTF-8' }
		: { kind: 'binary', mime: 'application/octet-stream' };
}

function now() {
	return time();
}

let task_seq = 0;

function make_task_id(prefix) {
	return sprintf('%s-%d-%d', prefix, time(), ++task_seq);
}

function spawn_background(cmd, logfile, rcfile) {
	let quoted = replace(cmd, '"', '\\"');

	let full = rcfile
		? sprintf('( { echo "$ %s"; ( %s ) 2>&1; __rc=$?; echo; echo "-- exit $__rc"; } >%s 2>&1; echo $__rc >%s ) </dev/null >/dev/null 2>&1 & echo $!',
			quoted, cmd, shellquote(logfile), shellquote(rcfile))
		: sprintf('( { echo "$ %s"; ( %s ) 2>&1; echo; echo "-- exit $?"; } >%s 2>&1 ) </dev/null >/dev/null 2>&1 & echo $!',
			quoted, cmd, shellquote(logfile));

	let proc = popen(full, 'r');
	if (!proc)
		return null;

	let pid = trim(proc.read('line') ?? '');
	proc.close();

	return length(pid) ? +pid : null;
}

function process_alive(pid) {
	if (!pid)
		return false;
	return stat(sprintf('/proc/%d', pid)) != null;
}

function read_task_state(file) {
	return read_json_file(file);
}

function task_running(file) {
	let st = read_json_file(file);
	return st && !st.done && st.pid && process_alive(st.pid);
}

function write_task_state(file, st) {
	return write_json_file(file, st);
}

function truncate_log(text, limit) {
	limit ??= 16384;
	if (length(text) <= limit)
		return text;
	return '...' + substr(text, length(text) - limit);
}

const NGINX_TEMPLATE = '/etc/nginx/uci.conf.template';
const UWSGI_CONFIG   = '/etc/uwsgi/vassals/luci-webui.ini';

function read_nginx_preferences() {
	let content = readfile(NGINX_TEMPLATE);

	if (!content)
		return {
			nginx_config_available:  false,
			uwsgi_request_buffering: 'on',
			client_max_body_size:    '0'
		};

	let buffering = match(content, /uwsgi_request_buffering\s+(\w+)\s*;/);
	let maxbody   = match(content, /client_max_body_size\s+(\S+)\s*;/);

	return {
		nginx_config_available:  true,
		uwsgi_request_buffering: buffering ? buffering[1] : 'on',
		client_max_body_size:    maxbody ? maxbody[1] : '0'
	};
}

const UWSGI_KEYS = [
	'reload-on-as', 'reload-on-rss', 'post-buffering',
	'limit-as', 'reload-mercy', 'buffer-size'
];

function read_uwsgi_preferences() {
	let content = readfile(UWSGI_CONFIG);

	if (!content) {
		let out = { uwsgi_config_available: false };
		for (let key in UWSGI_KEYS) {
			out[key] = null;
			out[key + '_enabled'] = false;
		}
		return out;
	}

	let out = { uwsgi_config_available: true };

	for (let key in UWSGI_KEYS) {
		let re = regexp(sprintf('^([;#]?)\\s*%s\\s*=\\s*(\\S+)',
			replace(key, '-', '\\-')), 'm');
		let m = match(content, re);

		out[key] = m ? m[2] : null;
		out[key + '_enabled'] = m ? (m[1] == '') : false;
	}

	return out;
}

function detect_web_server() {
	let proc = popen("ps ww 2>/dev/null || ps w 2>/dev/null || ps 2>/dev/null", 'r');
	if (!proc)
		return { web_server: 'unknown', nginx_running: false };

	let nginx = false, uhttpd = false;

	for (let line = proc.read('line'); length(line); line = proc.read('line')) {
		let l = lc(line);
		if (index(l, 'grep') >= 0)
			continue;
		if (index(l, 'nginx:') >= 0 || index(l, '/nginx') >= 0)
			nginx = true;
		else if (index(l, '/uhttpd') >= 0)
			uhttpd = true;
	}
	proc.close();

	return {
		web_server: nginx ? 'nginx' : (uhttpd ? 'uhttpd' : 'unknown'),
		nginx_running: nginx
	};
}

function read_uhttpd_preferences() {
	let out = {
		uhttpd_config_available: (stat('/etc/config/uhttpd') != null),
		uhttpd_script_timeout: UHTTPD_SCRIPT_TIMEOUT_DEFAULT,
		uhttpd_network_timeout: UHTTPD_NETWORK_TIMEOUT_DEFAULT
	};

	let uci = cursor();
	uci.load('uhttpd');
	out.uhttpd_script_timeout = normalize_timeout(
		uci.get('uhttpd', 'main', 'script_timeout'), out.uhttpd_script_timeout);
	out.uhttpd_network_timeout = normalize_timeout(
		uci.get('uhttpd', 'main', 'network_timeout'), out.uhttpd_network_timeout);
	uci.unload('uhttpd');

	return out;
}

function save_uhttpd_configuration(script_timeout, network_timeout) {
	let uci = cursor();
	uci.load('uhttpd');

	if (!uci.get('uhttpd', 'main'))
		uci.set('uhttpd', 'main', 'uhttpd');

	uci.set('uhttpd', 'main', 'script_timeout', '' + script_timeout);
	uci.set('uhttpd', 'main', 'network_timeout', '' + network_timeout);

	let rv = uci.commit('uhttpd');
	uci.unload('uhttpd');

	if (!rv)
		return 'failed to update the uHTTPd configuration';

	spawn_background('sleep 1; /etc/init.d/uhttpd reload', '/tmp/harbor_file_pro_uhttpd.log');
	return null;
}

function set_nginx_directive(content, directive, value) {
	let re = regexp(sprintf('^([ \t]*)%s[ \t]+[^;]*;',
		replace(directive, '_', '_')), 'm');

	if (match(content, re))
		return replace(content, re, sprintf('$1%s %s;', directive, value));

	return content;
}

function save_nginx_configuration(buffering, body_size) {
	let content = readfile(NGINX_TEMPLATE);
	if (!content)
		return 'the nginx configuration template was not found';

	let updated = content;
	updated = set_nginx_directive(updated, 'uwsgi_request_buffering',
		buffering ? 'on' : 'off');
	updated = set_nginx_directive(updated, 'client_max_body_size', body_size);

	if (updated == content)
		return null;

	let backup = NGINX_TEMPLATE + '.harbor-bak';
	if (!writefile(backup, content))
		return 'failed to back up the nginx configuration';

	if (!writefile(NGINX_TEMPLATE, updated)) {
		writefile(NGINX_TEMPLATE, content);
		return 'failed to write the nginx configuration';
	}

	let proc = popen(sprintf('nginx -t -c %s 2>&1', shellquote(NGINX_TEMPLATE)), 'r');
	let out = proc ? (proc.read('all') ?? '') : '';
	let rc = proc ? proc.close() : 0;

	if (rc != 0) {
		writefile(NGINX_TEMPLATE, content);
		return sprintf(tr('Nginx rejected the new configuration: %s'), trim(out));
	}

	spawn_background('sleep 1; /etc/init.d/nginx reload', '/tmp/harbor_file_pro_nginx.log');
	return null;
}

function save_uwsgi_configuration(values) {
	let content = readfile(UWSGI_CONFIG);
	if (!content)
		return 'the uwsgi configuration was not found';

	let updated = content;

	for (let key, value in values) {
		if (value == null)
			continue;
		let re = regexp(sprintf('^[;#]?[ \t]*%s[ \t]*=.*$',
			replace(key, '-', '\\-')), 'm');
		let line = sprintf('%s = %s', key, value);
		updated = match(updated, re) ? replace(updated, re, line)
		                             : trim(updated) + "\n" + line + "\n";
	}

	if (updated == content)
		return null;

	if (!writefile(UWSGI_CONFIG + '.harbor-bak', content))
		return 'failed to back up the uwsgi configuration';

	if (!writefile(UWSGI_CONFIG, updated)) {
		writefile(UWSGI_CONFIG, content);
		return 'failed to write the uwsgi configuration';
	}

	spawn_background('sleep 1; /etc/init.d/uwsgi reload', '/tmp/harbor_file_pro_uwsgi.log');
	return null;
}

function api_preferences() {
	let prefs = read_preferences();

	for (let k, v in read_nginx_preferences())
		prefs[k] = v;

	for (let k, v in read_uwsgi_preferences())
		prefs[k] = v;

	for (let k, v in read_uhttpd_preferences())
		prefs[k] = v;

	for (let k, v in detect_web_server())
		prefs[k] = v;

	prefs.ttyd_available = (stat('/etc/init.d/ttyd') != null);
	prefs.fcm = (stat('/etc/fwx_release') != null) ? 1 : 0;

	ok(http, prefs);
}

const BOOL_KEYS = [
	'allow_system_operations', 'show_hidden_files', 'enable_thumbnails',
	'editor_auto_indent', 'editor_auto_wrap', 'restore_last_directory',
	'show_line_numbers'
];

function api_save_preferences() {
	let section = http.formvalue('section') ?? 'basic';

	if (section == 'nginx')
		section = 'web_server';

	if (section == 'window') {
		let current = read_preferences();
		let mobile = (http.formvalue('window_target') == 'mobile');

		let w = normalize_dimension(http.formvalue('window_width'),
			mobile ? current.mobile_window_width : current.window_width);
		let h = normalize_dimension(http.formvalue('window_height'),
			mobile ? current.mobile_window_height : current.window_height);

		let values = mobile
			? { mobile_window_width: w, mobile_window_height: h }
			: { window_width: w, window_height: h };

		let err = save_preference_values(values);
		if (err)
			return write_json_status(http, 500, 'Save Failed',
				{ code: 1, message: sprintf(tr('Save window preferences failed: %s'), err) });

		return ok(http, read_preferences());
	}

	if (section == 'web_server' || section == 'uhttpd') {
		let detected = detect_web_server();
		let target = http.formvalue('web_server') ?? section;

		if (target == 'web_server')
			target = detected.web_server;

		if (target == 'uhttpd') {
			let cur = read_uhttpd_preferences();
			let err = save_uhttpd_configuration(
				normalize_timeout(http.formvalue('uhttpd_script_timeout'), cur.uhttpd_script_timeout),
				normalize_timeout(http.formvalue('uhttpd_network_timeout'), cur.uhttpd_network_timeout));

			if (err)
				return write_json_status(http, 500, 'Save Failed', { code: 1, message: err });
		}
		else {
			let cur = read_nginx_preferences();

			let buffering = http.formvalue('uwsgi_request_buffering');
			buffering = (buffering == null)
				? (cur.uwsgi_request_buffering == 'on')
				: (buffering == '1' || buffering == 'on');

			let body = http.formvalue('client_max_body_size') ??
				cur.client_max_body_size ?? '0';

			if (!match('' + body, /^[0-9]+[kKmMgG]?$/))
				return fail(http, 1, tr('Invalid client_max_body_size'));

			let err = save_nginx_configuration(buffering, body);
			if (err)
				return write_json_status(http, 500, 'Save Failed', { code: 1, message: err });

			let uw = {};
			for (let k in UWSGI_KEYS) {
				let v = http.formvalue(k);
				if (v != null && v != '')
					uw[k] = v;
			}
			if (length(uw)) {
				err = save_uwsgi_configuration(uw);
				if (err)
					return write_json_status(http, 500, 'Save Failed', { code: 1, message: err });
			}
		}

		return api_preferences();
	}

	let values = {};

	let view_mode = http.formvalue('view_mode');
	if (view_mode != null && match('' + view_mode, /^[0-5]$/))
		values.view_mode = view_mode;

	for (let key in BOOL_KEYS) {
		let v = http.formvalue(key);
		if (v != null && match('' + v, /^[01]$/))
			values[key] = v;
	}

	let mirror = http.formvalue('update_mirror');
	if (mirror != null && (mirror == 'auto' || mirror == 'gitee' || mirror == 'github' || mirror == 'gitlab'))
		values.update_mirror = mirror;

	let home = http.formvalue('home_dir');
	if (home != null && home != '') {
		let n = normalize_path(home);
		if (!n || n == '/')
			return fail(http, 1, tr('Invalid home directory'));
		mkdir_p(n);
		values.home_dir = n;
	}

	let open_type_map = http.formvalue('open_type_map');
	if (open_type_map != null)
		values.open_type_map = open_type_map;

	if (!length(values))
		return fail(http, 1, tr('Nothing to save'));

	let err = save_preference_values(values);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, read_preferences());
}

function api_save_last_directory() {
	let path = normalize_path(http.formvalue('path'));

	if (!path)
		return fail(http, 1, tr('Invalid path'));

	let err = save_preference_values({ last_directory: path });
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, { last_directory: path });
}

function api_save_show_line_numbers() {
	let v = formvalue_any(http, [ 'value', 'show_line_numbers' ]) == '1' ? '1' : '0';

	let err = save_preference_values({ show_line_numbers: v });
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, { show_line_numbers: +v });
}

const PACKAGE_LOG   = '/tmp/harbor_file_pro_package_install.log';
const THUMBNAIL_LOG = '/tmp/harbor_file_pro_thumbnail.log';
const PACKAGE_RC    = '/tmp/harbor_file_pro_package_install.rc';
const THUMBNAIL_RC  = '/tmp/harbor_file_pro_thumbnail.rc';

function detect_package_manager() {
	if (stat('/usr/bin/apk') || stat('/sbin/apk'))
		return 'apk';
	if (stat('/bin/opkg') || stat('/usr/bin/opkg'))
		return 'opkg';
	return null;
}

function install_command(packages) {
	let pm = detect_package_manager();
	let quoted = [];

	for (let p in packages)
		push(quoted, shellquote(p));

	if (pm == 'apk')
		return sprintf('apk update && apk add %s', join(' ', quoted));
	if (pm == 'opkg')
		return sprintf('opkg update && opkg install %s', join(' ', quoted));

	return null;
}

function task_busy(file) {
	return task_running(file);
}

function start_install(packages, label) {

	if (task_busy(PACKAGE_STATE_FILE))
		return write_json_status(http, 409, 'Conflict',
			{ code: 1, message: tr('Another installation is already running') });

	let cmd = install_command(packages);
	if (!cmd)
		return fail(http, 1, tr('No supported package manager found'));

	let task_id = make_task_id('tool');
	let pid = spawn_background(cmd, PACKAGE_LOG, PACKAGE_RC);

	let task = {
		task_id, label,
		packages,
		package_name: join(' ', packages),
		package_type: 'repository',
		installer: detect_package_manager() ?? 'opkg',
		path: join(' ', packages),
		state: 'running', done: false,
		success: false, pid, started: now()
	};
	write_task_state(PACKAGE_STATE_FILE, task);

	ok(http, task);
}

function install_status(file, logfile, rcfile) {
	let st = read_task_state(file);

	if (!st)
		return ok(http, { state: 'idle', done: true, success: false });

	let want = http.formvalue('task_id');
	if (want && st.task_id && want != st.task_id)
		return ok(http, { task_id: want, state: 'gone', done: true, success: false });

	if (!st.done && st.pid && !process_alive(st.pid)) {
		let rc = rcfile ? trim(readfile(rcfile) ?? '') : '';
		st.exit_code = length(rc) ? +rc : 0;
		st.success = (st.exit_code == 0);
		st.state = st.success ? 'success' : 'failed';
		st.done = true;
		st.finished = now();
		write_task_state(file, st);
	}

	st.log = truncate_log(readfile(logfile) ?? '', 16384);

	if (!st.message)
		st.message = st.done
			? (st.success ? tr('Installation finished') : sprintf(tr('Installation failed (exit %d)'), st.exit_code ?? -1))
			: 'installing...';

	ok(http, st);
}

function ttyd_config() {
	let cfg = {};

	try {
		let uci = cursor();
		uci.load('ttyd');
		uci.foreach('ttyd', 'ttyd', (section) => {
			cfg = section;
			return false;
		});
		uci.unload('ttyd');
	}
	catch (e) {}

	return cfg;
}

function ttyd_running() {
	let p = popen("ps ww 2>/dev/null || ps w 2>/dev/null || ps 2>/dev/null", 'r');
	if (!p)
		return false;

	let running = false;
	for (let line = p.read('line'); length(line); line = p.read('line')) {
		if (match(line, /[\t ]ttyd/) && !match(line, /[\t ]grep[\t ]/)) {
			running = true;
			break;
		}
	}
	p.close();

	return running;
}

function api_terminal_info() {
	let cfg = ttyd_config();
	let running = ttyd_running();
	let init_script = stat('/etc/init.d/ttyd');
	let config_file = stat('/etc/config/ttyd');
	let executable = have_tool('ttyd');
	let installed = executable || init_script || config_file || running;

	let url_override = cfg.url_override ?? cfg.url ?? cfg.path ?? '';
	let port = +(cfg.port ?? 0);

	ok(http, {
		available: installed ? true : false,
		port: (port == port && port > 0 && port < 65536) ? port : 7681,
		ssl: (cfg.ssl == '1' || cfg.ssl == 1 || cfg.ssl == 'on' ||
			cfg.ssl == 'true' || cfg.ssl == true) ? 1 : 0,
		url: (type(url_override) == 'string') ? url_override : '',
		command: '' + (cfg.command ?? '/bin/login'),
		interface: '' + (cfg.interface ?? ''),
		installed: installed ? 1 : 0,
		running: running ? 1 : 0
	});
}

function api_terminal_tool_install_start() {
	start_install([ 'ttyd', 'luci-app-ttyd' ], 'terminal');
}

function api_nginx_install_start() {
	start_install([ 'nginx-ssl-util', 'luci-nginx' ], 'nginx');
}

function api_thumbnail_tool_install_start() {
	start_install([ TOOL_PACKAGE_MAP.gm ], 'gm');
}

function api_tool_install_start() {
	let tool = http.formvalue('tool');
	if (tool != null && tool != '') {
		if (!match('' + tool, /^[A-Za-z0-9._+-]+$/))
			return fail(http, 1, tr('Invalid tool name'));

		let pkg = TOOL_PACKAGE_MAP[tool] ?? tool;
		return start_install([ pkg ], tool);
	}

	let raw = http.formvalue('packages');
	let packages = [];

	if (type(raw) == 'array')
		packages = raw;
	else if (type(raw) == 'string' && raw != '') {
		try {
			let v = json(raw);
			packages = (type(v) == 'array') ? v : [ raw ];
		}
		catch (e) {
			packages = split(raw, /[\s,]+/);
		}
	}

	let clean = [];
	for (let p in packages)
		if (match('' + p, /^[A-Za-z0-9._+-]+$/))
			push(clean, p);

	if (!length(clean))
		return fail(http, 1, tr('No valid package name given'));

	start_install(clean, http.formvalue('label') ?? 'tool');
}

function api_package_install_start() {
	let path = validate_write_request(http, http.formvalue('path'));
	if (!path) return;

	if (task_busy(PACKAGE_STATE_FILE))
		return write_json_status(http, 409, 'Conflict',
			{ code: 1, message: tr('Another package installation is already running') });

	let st = stat(path);
	if (!st || st.type != 'file')
		return write_json_status(http, 400, 'Bad Request',
			{ code: 1, message: tr('Package file not found') });

	let ext = file_extension(path);
	let spec = PACKAGE_EXT_MAP[ext];

	if (!spec)
		return write_json_status(http, 400, 'Bad Request',
			{ code: 1, message: tr('Unsupported package type') });

	if (!stat('/bin/' + spec.installer) && !stat('/usr/bin/' + spec.installer) &&
	    !stat('/sbin/' + spec.installer))
		return fail(http, 1, sprintf(tr('%s is not available on this system'), spec.installer));

	let cmd = sprintf('%s %s %s', spec.installer,
		join(' ', spec.args), shellquote(path));

	let task_id = make_task_id('pkg');
	let pid = spawn_background(cmd, PACKAGE_LOG, PACKAGE_RC);

	let task = {
		task_id, path,
		package_name: path_name(path),
		package_type: ext,
		installer: spec.installer,
		state: 'running',
		done: false, success: false, pid, started: now()
	};
	write_task_state(PACKAGE_STATE_FILE, task);

	ok(http, task);
}

function api_package_install_status() {
	install_status(PACKAGE_STATE_FILE, PACKAGE_LOG, PACKAGE_RC);
}

function have_thumbnailer() {
	return have_tool('gm');
}

function api_thumbnail_generate_start() {
	let dir = normalize_path(http.formvalue('path'));

	if (!dir)
		return fail(http, 1, tr('Invalid path'));

	if (!have_thumbnailer())
		return write_json_status(http, 424, 'Failed Dependency', {
			code: 2,
			message: tr('GraphicsMagick is not installed'),
			data: {
				missing_tool: 'gm',
				package_name: TOOL_PACKAGE_MAP.gm,
				installer: detect_package_manager() ?? 'opkg',
				dependency_missing: true,
				path: dir
			}
		});

	if (task_busy(THUMBNAIL_STATE_FILE))
		return write_json_status(http, 409, 'Conflict',
			{ code: 1, message: tr('Thumbnail generation is already running') });

	let prefs = read_preferences();
	let cache = thumbnail_cache_dir(prefs);
	mkdir_p(cache);

	let listing = list_directory(dir, prefs);
	let jobs = [], cached = 0;

	for (let it in (listing.items ?? [])) {
		if (it.type != 'file')
			continue;
		if (!IMAGE_MIME_MAP[it.extension])
			continue;

		let st = stat(it.path);
		let cp = thumbnail_cache_path(it.path, st, prefs);
		if (!cp)
			continue;

		if (stat(cp))
			cached++;
		else
			push(jobs, { path: it.path, cache: cp });
	}

	if (!length(jobs)) {
		let empty = {
			task_id: make_task_id('thumb'), state: 'success', done: true,
			success: true, path: dir, directory: dir,
			total: 0, processed: 0, success_count: 0, failed_count: 0,
			cached_count: cached, current_file: '', finished: now()
		};
		write_task_state(THUMBNAIL_STATE_FILE, empty);
		return ok(http, empty);
	}

	let lines = [];
	for (let j in jobs) {
		push(lines, sprintf('echo "BEGIN %s"', j.path));
		push(lines, sprintf('if gm convert %s -auto-orient -thumbnail %dx%d %s 2>&1; then echo "OK %s"; else echo "FAIL %s"; fi',
			shellquote(j.path), THUMBNAIL_SIZE, THUMBNAIL_SIZE, shellquote(j.cache),
			j.path, j.path));
	}

	let script = '/tmp/harbor_file_pro_thumbnail.sh';
	let fd = open(script, 'w', 0o700);
	fd.write("#!/bin/sh\n" + join("\n", lines) + "\n");
	fd.close();

	let task_id = make_task_id('thumb');
	let pid = spawn_background('/bin/sh ' + script, THUMBNAIL_LOG, THUMBNAIL_RC);

	let task = {
		task_id, state: 'running', done: false, success: false, pid,
		path: dir, directory: dir,
		total: length(jobs), processed: 0,
		success_count: 0, failed_count: 0, cached_count: cached,
		current_file: '', started: now()
	};
	write_task_state(THUMBNAIL_STATE_FILE, task);

	ok(http, task);
}

function api_thumbnail_generate_status() {
	let st = read_task_state(THUMBNAIL_STATE_FILE);

	if (!st)
		return ok(http, {
			state: 'idle', done: true, success: true,
			total: 0, processed: 0, success_count: 0,
			failed_count: 0, cached_count: 0, current_file: ''
		});

	let want = http.formvalue('task_id');
	if (want && st.task_id && want != st.task_id)
		return ok(http, { task_id: want, state: 'gone', done: true, success: false });

	let log = readfile(THUMBNAIL_LOG) ?? '';
	let okc = 0, failc = 0, current = '';

	for (let line in split(log, "\n")) {
		if (substr(line, 0, 3) == 'OK ')      { okc++;   current = ''; }
		else if (substr(line, 0, 5) == 'FAIL '){ failc++; current = ''; }
		else if (substr(line, 0, 6) == 'BEGIN ') current = substr(line, 6);
	}

	st.success_count = okc;
	st.failed_count  = failc;
	st.processed     = okc + failc;
	st.current_file  = current;
	st.log           = truncate_log(log, 8192);

	if (!st.done && st.pid && !process_alive(st.pid)) {
		let rc = trim(readfile(THUMBNAIL_RC) ?? '');
		st.exit_code = length(rc) ? +rc : 0;
		st.success = (failc == 0);
		st.state = st.success ? 'success' : 'failed';
		st.done = true;
		st.current_file = '';
		st.finished = now();
		write_task_state(THUMBNAIL_STATE_FILE, st);
	}

	if (st.done && !st.success && !st.message)
		st.message = sprintf('%d of %d thumbnails failed', failc, st.total ?? 0);

	ok(http, st);
}

const ARCHIVE_LOG = '/tmp/harbor_file_pro_archive.log';
const ARCHIVE_RC  = '/tmp/harbor_file_pro_archive.rc';

function copy_file(src, dst) {
	let inf = open(src, 'r');
	if (!inf)
		return false;

	let outf = open(dst, 'w');
	if (!outf) {
		inf.close();
		return false;
	}

	let okay = true;
	while (true) {
		let chunk = inf.read(65536);
		if (!length(chunk))
			break;
		if (outf.write(chunk) == null) {
			okay = false;
			break;
		}
	}

	inf.close();
	outf.close();

	if (okay) {
		let st = stat(src);
		if (st)
			chmod(dst, st.mode & 0o7777);
	}
	else {
		unlink(dst);
	}

	return okay;
}

function copy_recursive(src, dst) {
	let st = lstat_safe(src);
	if (!st)
		return false;

	if (st.type == 'directory') {
		if (!mkdir_p(dst))
			return false;
		for (let name in (lsdir(src) ?? []))
			if (!copy_recursive(join_path(src, name), join_path(dst, name)))
				return false;
		return true;
	}

	return copy_file(src, dst);
}

function is_descendant(parent, child) {
	return (child == parent) || (substr(child, 0, length(parent) + 1) == parent + '/');
}

function transfer_one(src, dest_dir, mode, on_conflict, forced_name) {
	let st = lstat_safe(src);
	if (!st)
		return { ok: false, error: tr('Source not found') };

	if (st.type == 'directory' && is_descendant(src, dest_dir))
		return { ok: false, error: tr('Cannot transfer a directory into itself') };

	let name = forced_name && valid_component(forced_name)
		? forced_name : path_name(src);
	let target = join_path(dest_dir, name);

	if (lstat_safe(target)) {
		if (on_conflict == 'skip')
			return { ok: true, error: 'skipped' };
		else if (on_conflict == 'rename')
			target = unique_target(dest_dir, name);
		else if (on_conflict == 'overwrite')
			remove_recursive(target);
		else
			return { ok: false, error: tr('Target already exists') };

		if (!target)
			return { ok: false, error: tr('Cannot allocate a unique name') };
	}

	if (mode == 'move') {
		if (rename(src, target))
			return { ok: true, error: null };
		if (!copy_recursive(src, target))
			return { ok: false, error: tr('Move failed') };
		if (!remove_recursive(src))
			return { ok: false, error: tr('Move succeeded but source could not be removed') };
		return { ok: true, error: null };
	}

	return copy_recursive(src, target)
		? { ok: true, error: null }
		: { ok: false, error: tr('Copy failed') };
}

function parse_path_array(http_obj, field) {
	let raw = http_obj.formvalue(field);
	if (type(raw) == 'array')
		return raw;
	if (type(raw) != 'string' || raw == '')
		return null;

	try {
		let v = json(raw);
		return (type(v) == 'array') ? v : [ raw ];
	}
	catch (e) {
		return [ raw ];
	}
}


function read_bookmarks() {
	let uci = open_config().uci;
	if (!uci)
		return [];

	let out = [];
	uci.foreach(CONFIG, 'bookmark', (sec) => {
		let p = normalize_path(sec.path ?? '');
		if (!p)
			return;
		push(out, {
			label: trim('' + (sec.label ?? p)) || p,
			path: p,
			folder: trim('' + (sec.folder ?? ''))
		});
	});
	uci.unload(CONFIG);

	return out;
}

// Rewriting every section keeps ordering portable across ucode-uci builds
// instead of relying on an optional reorder() binding.
function write_bookmarks(list) {
	if (!ensure_config_file())
		return sprintf(tr('Cannot create %s'), CONFIG_FILE);

	let uci = open_config().uci;
	if (!uci)
		return sprintf(tr('Cannot load the %s UCI config'), CONFIG);

	let stale = [];
	uci.foreach(CONFIG, 'bookmark', (sec) => {
		if (sec['.name'])
			push(stale, sec['.name']);
	});
	// ucode-uci has no remove(); the method is delete(config, section).
	for (let sid in stale)
		uci.delete(CONFIG, sid);

	for (let b in list) {
		let sid = uci.add(CONFIG, 'bookmark');
		uci.set(CONFIG, sid, 'label', b.label);
		uci.set(CONFIG, sid, 'path', b.path);
		if (b.folder != null && b.folder != '')
			uci.set(CONFIG, sid, 'folder', b.folder);
	}

	if (!uci.save(CONFIG))
		return sprintf(tr('Cannot load the %s UCI config'), CONFIG);

	if (!uci.commit(CONFIG)) {
		uci.unload(CONFIG);
		return tr('Save failed');
	}

	uci.unload(CONFIG);

	return null;
}

function bookmark_payload(list) {
	let out = [];
	for (let b in list) {
		let st = stat(b.path);
		push(out, {
			label: b.label,
			path: b.path,
			folder: b.folder ?? '',
			exists: (st != null && st.type == 'directory')
		});
	}
	return out;
}

function read_bookmark_folders() {
	let uci = open_config().uci;
	if (!uci)
		return [];

	let out = [];
	uci.foreach(CONFIG, 'bookmark_folder', (sec) => {
		let n = trim('' + (sec.name ?? ''));
		if (n != '')
			push(out, n);
	});
	uci.unload(CONFIG);

	return out;
}

function write_bookmark_folders(list) {
	if (!ensure_config_file())
		return sprintf(tr('Cannot create %s'), CONFIG_FILE);

	let uci = open_config().uci;
	if (!uci)
		return sprintf(tr('Cannot load the %s UCI config'), CONFIG);

	let stale = [];
	uci.foreach(CONFIG, 'bookmark_folder', (sec) => {
		if (sec['.name'])
			push(stale, sec['.name']);
	});
	for (let sid in stale)
		uci.delete(CONFIG, sid);

	for (let name in list) {
		let sid = uci.add(CONFIG, 'bookmark_folder');
		uci.set(CONFIG, sid, 'name', name);
	}

	if (!uci.save(CONFIG))
		return sprintf(tr('Cannot load the %s UCI config'), CONFIG);

	if (!uci.commit(CONFIG)) {
		uci.unload(CONFIG);
		return tr('Save failed');
	}

	uci.unload(CONFIG);
	return null;
}

function clean_bookmark_folder_name(raw) {
	let v = trim('' + (raw ?? ''));
	let out = '';
	for (let i = 0; i < length(v); i++) {
		let code = ord(v, i);
		if (code >= 32 && code != 127)
			out += substr(v, i, 1);
	}
	if (length(out) > 64)
		out = substr(out, 0, 64);
	return out;
}

function bookmark_folders_payload(list) {
	return map(list, (n) => n);
}

function read_fav_expanded() {
	let uci = open_config().uci;
	if (!uci)
		return [];

	let v = uci.get_all(CONFIG, CONFIG_SECTION)?.fav_expanded ?? [];
	uci.unload(CONFIG);

	if (type(v) == 'string')
		return [ v ];
	if (type(v) == 'array')
		return filter(map(v, (x) => '' + x), (x) => length(x) > 0);
	return [];
}

function write_fav_expanded(list) {
	if (!ensure_config_file())
		return sprintf(tr('Cannot create %s'), CONFIG_FILE);

	let uci = open_config().uci;
	if (!uci)
		return sprintf(tr('Cannot load the %s UCI config'), CONFIG);

	if (!uci.get(CONFIG, CONFIG_SECTION))
		uci.set(CONFIG, CONFIG_SECTION, CONFIG);

	uci.delete(CONFIG, CONFIG_SECTION, 'fav_expanded');
	if (length(list))
		uci.set(CONFIG, CONFIG_SECTION, 'fav_expanded', list);

	if (!uci.save(CONFIG) || !uci.commit(CONFIG)) {
		uci.unload(CONFIG);
		return tr('Save failed');
	}

	uci.unload(CONFIG);
	return null;
}

// Explicit folder sections plus folders that only exist as bookmark.folder
// values (created before folders were materialized). With persist=true the
// merged list is written back, so every folder operation sees one namespace.
function merged_bookmark_folders(persist) {
	let explicit = read_bookmark_folders();
	let merged = [ ...explicit ];

	for (let b in read_bookmarks())
		if (b.folder != '' && index(merged, b.folder) < 0)
			push(merged, b.folder);

	if (persist && length(merged) != length(explicit)) {
		let err = write_bookmark_folders(merged);
		if (err)
			return null;
	}

	return merged;
}

function apply_bookmarks_payload(list, folders) {
	return {
		bookmarks: bookmark_payload(list),
		bookmark_folders: bookmark_folders_payload(merged_bookmark_folders(false) ?? folders),
		fav_expanded: read_fav_expanded()
	};
}

function api_bookmark_save() {
	let path = normalize_path(formvalue_any(http, [ 'path', 'address' ]));
	if (!path)
		return fail(http, 1, tr('Invalid path'));

	let raw_label = trim('' + (http.formvalue('label') ?? ''));
	let label = '';
	for (let i = 0; i < length(raw_label); i++) {
		let code = ord(raw_label, i);
		if (code >= 32 && code != 127)
			label += substr(raw_label, i, 1);
	}
	if (length(label) > 64)
		label = substr(label, 0, 64);
	if (label == '')
		label = path_name(path) ?? path;

	let folder = trim('' + (formvalue_any(http, [ 'folder', 'group' ]) ?? ''));
	let clean_folder = '';
	for (let i = 0; i < length(folder); i++) {
		let code = ord(folder, i);
		if (code >= 32 && code != 127)
			clean_folder += substr(folder, i, 1);
	}
	if (length(clean_folder) > 64)
		clean_folder = substr(clean_folder, 0, 64);

	// Editing may change the address: original_path names the bookmark being
	// edited so it is moved (removed at the old path) instead of duplicated.
	let original = normalize_path(formvalue_any(http,
		[ 'original_path', 'original', 'old_path' ]));

	let list = read_bookmarks();
	let found = false;

	if (original && original != path) {
		let kept = [];
		for (let b in list) {
			if (b.path != original)
				push(kept, b);
		}
		list = kept;
	}

	for (let b in list) {
		if (b.path == path) {
			b.label = label;
			b.folder = clean_folder;
			found = true;
		}
	}
	if (!found)
		push(list, { label, path, folder: clean_folder });

	if (clean_folder != '') {
		let folders = read_bookmark_folders();
		if (index(folders, clean_folder) < 0) {
			push(folders, clean_folder);
			let ferr = write_bookmark_folders(folders);
			if (ferr)
				return fail(http, 2, sprintf(tr('Save failed: %s'), ferr));
		}
	}

	let err = write_bookmarks(list);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, apply_bookmarks_payload(list, read_bookmark_folders()));
}

function api_bookmark_delete() {
	let path = normalize_path(formvalue_any(http, [ 'path', 'address' ]));
	if (!path)
		return fail(http, 1, tr('Invalid path'));

	let list = read_bookmarks();
	let next = [];
	for (let b in list)
		if (b.path != path)
			push(next, b);

	let err = write_bookmarks(next);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, apply_bookmarks_payload(next, read_bookmark_folders()));
}

function api_bookmark_move() {
	let path = normalize_path(http.formvalue('path'));
	let dir = http.formvalue('direction') ?? 'up';

	if (!path)
		return fail(http, 1, tr('Invalid path'));

	let list = read_bookmarks();
	let i = -1;
	for (let k = 0; k < length(list); k++)
		if (list[k].path == path) {
			i = k;
			break;
		}

	if (i < 0)
		return fail(http, 1, tr('Path not found'));

	let group = list[i].folder ?? '';
	let peers = [];
	for (let k = 0; k < length(list); k++)
		if ((list[k].folder ?? '') == group)
			push(peers, k);

	let pos = -1;
	for (let k = 0; k < length(peers); k++)
		if (peers[k] == i)
			pos = k;

	let np = (dir == 'down') ? pos + 1 : pos - 1;
	if (pos < 0 || np < 0 || np >= length(peers))
		return ok(http, apply_bookmarks_payload(list, read_bookmark_folders()));

	let j = peers[np];

	let tmp = list[i];
	list[i] = list[j];
	list[j] = tmp;

	let err = write_bookmarks(list);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, apply_bookmarks_payload(list, read_bookmark_folders()));
}

function api_bookmark_folder_add() {
	let name = clean_bookmark_folder_name(formvalue_any(http, [ 'name', 'folder' ]));
	if (name == '')
		return fail(http, 1, tr('Invalid name'));

	let folders = read_bookmark_folders();
	if (index(folders, name) < 0)
		push(folders, name);

	let err = write_bookmark_folders(folders);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, apply_bookmarks_payload(read_bookmarks(), folders));
}

function api_bookmark_folder_rename() {
	let from = clean_bookmark_folder_name(http.formvalue('from'));
	let to = clean_bookmark_folder_name(http.formvalue('to'));

	if (from == '' || to == '' || from == to)
		return fail(http, 1, tr('Invalid name'));

	let folders = merged_bookmark_folders(true);
	if (!folders)
		return fail(http, 2, sprintf(tr('Save failed: %s'), tr('Save failed')));
	let next = [];
	for (let f in folders)
		push(next, (f == from) ? to : f);

	let err = write_bookmark_folders(next);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	let expanded = read_fav_expanded();
	let next_expanded = [];
	for (let f in expanded)
		push(next_expanded, (f == from) ? to : f);
	err = write_fav_expanded(next_expanded);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	let list = read_bookmarks();
	for (let b in list)
		if ((b.folder ?? '') == from)
			b.folder = to;

	err = write_bookmarks(list);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, apply_bookmarks_payload(read_bookmarks(), next));
}

function api_bookmark_folder_delete() {
	let name = clean_bookmark_folder_name(http.formvalue('name'));
	if (name == '')
		return fail(http, 1, tr('Invalid name'));

	let folders = merged_bookmark_folders(true);
	if (!folders)
		return fail(http, 2, sprintf(tr('Save failed: %s'), tr('Save failed')));
	let next = [];
	for (let f in folders)
		if (f != name)
			push(next, f);

	let err = write_bookmark_folders(next);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	let expanded = read_fav_expanded();
	let next_expanded = [];
	for (let f in expanded)
		if (f != name)
			push(next_expanded, f);
	err = write_fav_expanded(next_expanded);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	// Deleting a folder keeps its bookmarks; they fall back to ungrouped.
	let list = read_bookmarks();
	let changed = false;
	for (let b in list)
		if ((b.folder ?? '') == name) {
			b.folder = '';
			changed = true;
		}

	if (changed) {
		err = write_bookmarks(list);
		if (err)
			return fail(http, 2, sprintf(tr('Save failed: %s'), err));
	}

	ok(http, apply_bookmarks_payload(read_bookmarks(), next));
}

function api_bookmark_folder_state() {
	let name = clean_bookmark_folder_name(http.formvalue('name'));
	let expanded = (http.formvalue('expanded') == '1');

	if (name == '')
		return fail(http, 1, tr('Invalid name'));

	if (!merged_bookmark_folders(true))
		return fail(http, 2, sprintf(tr('Save failed: %s'), tr('Save failed')));

	let list = read_fav_expanded();
	let next = [];
	for (let f in list)
		if (f != name)
			push(next, f);
	if (expanded)
		push(next, name);

	let err = write_fav_expanded(next);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, apply_bookmarks_payload(read_bookmarks(), read_bookmark_folders()));
}

function api_bookmark_folder_move() {
	let name = clean_bookmark_folder_name(http.formvalue('name'));
	let dir = http.formvalue('direction') ?? 'up';

	if (name == '')
		return fail(http, 1, tr('Invalid name'));

	let folders = merged_bookmark_folders(true);
	if (!folders)
		return fail(http, 2, sprintf(tr('Save failed: %s'), tr('Save failed')));

	let i = index(folders, name);
	if (i < 0)
		return fail(http, 1, tr('Path not found'));

	let j = (dir == 'down') ? i + 1 : i - 1;
	if (j < 0 || j >= length(folders))
		return ok(http, apply_bookmarks_payload(read_bookmarks(), folders));

	let tmp = folders[i];
	folders[i] = folders[j];
	folders[j] = tmp;

	let err = write_bookmark_folders(folders);
	if (err)
		return fail(http, 2, sprintf(tr('Save failed: %s'), err));

	ok(http, apply_bookmarks_payload(read_bookmarks(), folders));
}

function api_navigation() {
	let prefs = read_preferences();

	ok(http, {
		quick_access: build_quick_access(prefs),
		bookmarks:    bookmark_payload(read_bookmarks()),
		bookmark_folders: bookmark_folders_payload(merged_bookmark_folders(false) ?? []),
		fav_expanded:        read_fav_expanded(),
		home_dir:     prefs.home_dir,
		folders:      list_root_folders(),
		drives:       list_drives()
	});
}

function api_list() {
	let path = normalize_path(http.formvalue('path'));

	if (!path)
		return fail(http, 1, tr('Invalid path'));

	let prefs = read_preferences();
	let listing = list_directory(path, prefs);

	if (!listing.items)
		return fail(http, 2, listing.error ?? tr('List failed'));

	let space = get_directory_space_info(path);
	let available = space.available, total = space.total, margin = space.margin;
	let has_space = (available != null && available >= (margin ?? 0));

	ok(http, {
		path,
		parent:                  parent_path(path),
		available_bytes:         available ?? 0,
		total_bytes:             total ?? 0,
		operation_space_margin:  margin ?? 0,
		has_operation_space:     has_space,
		is_system_path:          is_system_path(path),
		allow_system_operations: prefs.allow_system_operations,
		items: listing.items
	});
}

function api_create_directory() {
	let parent = validate_write_request(http,
		formvalue_any(http, [ 'target_dir', 'path' ]));
	if (!parent) return;

	let name = http.formvalue('name');
	if (!valid_component(name))
		return fail(http, 1, tr('Invalid name'));

	let target = join_path(parent, name);

	if (lstat_safe(target))
		return fail(http, 2, tr('Target already exists'));

	if (!mkdir(target, 0o755))
		return fail(http, 3, tr('Create failed'));

	ok(http, { path: target });
}

function api_create_file() {
	let parent = validate_write_request(http,
		formvalue_any(http, [ 'target_dir', 'path' ]));
	if (!parent) return;

	let name = http.formvalue('name');
	if (!valid_component(name))
		return fail(http, 1, tr('Invalid name'));

	let target = join_path(parent, name);

	if (lstat_safe(target))
		return fail(http, 2, tr('Target already exists'));

	let fd = open(target, 'w');
	if (!fd)
		return fail(http, 3, tr('Create failed'));
	fd.close();

	ok(http, { path: target });
}

function api_rename() {
	let src = validate_write_request(http, http.formvalue('path'));
	if (!src) return;

	if (src == '/')
		return fail(http, 1, tr('Cannot rename root'));

	let name = formvalue_any(http, [ 'new_name', 'name' ]);
	if (!valid_component(name))
		return fail(http, 1, tr('Invalid name'));

	let parent = parent_path(src);
	let target = join_path(parent, name);

	if (target == src)
		return ok(http, { path: target });

	if (lstat_safe(target))
		return fail(http, 2, tr('Target already exists'));

	if (!rename(src, target))
		return fail(http, 3, tr('Rename failed'));

	ok(http, { path: target });
}

function api_delete() {
	let path = validate_write_request(http, http.formvalue('path'));
	if (!path) return;

	if (path == '/')
		return fail(http, 1, tr('Cannot delete root'));

	if (!lstat_safe(path))
		return fail(http, 2, tr('Path not found'));

	if (!remove_recursive(path))
		return fail(http, 3, tr('Delete failed'));

	ok(http, { path });
}

function do_transfer(mode, batch) {
	let prefs = read_preferences();

	let dest = normalize_path(formvalue_any(http,
		[ 'target_dir', 'destination', 'dest' ]));
	if (!dest)
		return fail(http, 1, tr('Invalid destination'));

	if (is_system_path(dest) && !prefs.allow_system_operations)
		return write_json_status(http, 403, 'Forbidden',
			{ code: 1, message: tr('System folder operations are disabled') });

	let dst_st = stat(dest);
	if (!dst_st || dst_st.type != 'directory')
		return fail(http, 2, tr('Destination is not a directory'));

	let on_conflict = formvalue_any(http,
		[ 'conflict_action', 'on_conflict' ]) ?? 'error';

	let rename_map = {};
	let raw_map = http.formvalue('rename_map');
	if (raw_map) {
		try { rename_map = json(raw_map) ?? {}; }
		catch (e) { rename_map = {}; }
	}

	let sources = batch
		? (parse_path_array(http, 'sources') ?? parse_path_array(http, 'paths'))
		: [ http.formvalue('path') ];

	if (!length(sources))
		return fail(http, 1, tr('No source given'));

	let results = [], failures = 0;

	for (let raw in sources) {
		let src = normalize_path(raw);

		if (!src) {
			push(results, { path: raw, ok: false, error: tr('Invalid path') });
			failures++;
			continue;
		}

		if (is_system_path(src) && !prefs.allow_system_operations) {
			push(results, { path: src, ok: false, error: 'system path' });
			failures++;
			continue;
		}

		let rv = transfer_one(src, dest, mode, on_conflict,
			rename_map[path_name(src)]);
		push(results, { path: src, ok: rv.ok, error: rv.error });
		if (!rv.ok) failures++;
	}

	if (failures && !batch)
		return fail(http, 3, results[0].error ?? tr('Transfer failed'), { results });

	ok(http, { destination: dest, total: length(results), failed: failures, results });
}

function api_copy()       { do_transfer('copy', false); }
function api_move()       { do_transfer('move', false); }
function api_batch_copy() { do_transfer('copy', true);  }
function api_batch_move() { do_transfer('move', true);  }

function api_batch_delete() {
	let prefs = read_preferences();
	let sources = parse_path_array(http, 'paths') ??
		parse_path_array(http, 'sources');

	if (!length(sources))
		return fail(http, 1, tr('No source given'));

	let results = [], failures = 0;

	for (let raw in sources) {
		let p = normalize_path(raw);

		if (!p || p == '/') {
			push(results, { path: raw, ok: false, error: tr('Invalid path') });
			failures++;
			continue;
		}

		if (is_system_path(p) && !prefs.allow_system_operations) {
			push(results, { path: p, ok: false, error: 'system path' });
			failures++;
			continue;
		}

		let okay = remove_recursive(p);
		push(results, { path: p, ok: okay, error: okay ? null : 'delete failed' });
		if (!okay) failures++;
	}

	ok(http, { total: length(results), failed: failures, results });
}

function api_batch_check() {
	let dest = normalize_path(formvalue_any(http,
		[ 'target_dir', 'destination', 'dest' ]));
	let sources = parse_path_array(http, 'sources') ??
		parse_path_array(http, 'paths') ?? [];

	let conflicts = [], total_bytes = 0, count = 0;

	for (let raw in sources) {
		let src = normalize_path(raw);
		if (!src)
			continue;

		let st = lstat_safe(src);
		if (!st)
			continue;

		count++;
		total_bytes += (st.size ?? 0);

		if (dest) {
			let target = join_path(dest, path_name(src));
			if (lstat_safe(target))
				push(conflicts, { path: src, target, name: path_name(src) });
		}
	}

	let space = dest ? get_directory_space_info(dest)
	                 : { available: null, total: null, margin: 0 };

	ok(http, {
		count, total_bytes, conflicts,
		available_bytes: space.available ?? 0,
		has_operation_space: (space.available == null) ||
			(space.available >= total_bytes + (space.margin ?? 0))
	});
}

function api_chmod() {
	let path = validate_write_request(http, http.formvalue('path'));
	if (!path) return;

	let modestr = http.formvalue('mode') ?? '';
	if (!match(modestr, /^[0-7]{3,4}$/))
		return fail(http, 1, tr('Invalid mode'));

	let mode = 0;
	for (let i = 0; i < length(modestr); i++)
		mode = mode * 8 + (ord(modestr, i) - 48);

	let recursive = (http.formvalue('recursive') == '1');

	if (!chmod(path, mode))
		return fail(http, 2, tr('chmod failed'));

	if (recursive) {
		function walk(p) {
			for (let name in (lsdir(p) ?? [])) {
				let child = join_path(p, name);
				chmod(child, mode);
				let cst = lstat_safe(child);
				if (cst?.type == 'directory')
					walk(child);
			}
		}

		let st = lstat_safe(path);
		if (st?.type == 'directory')
			walk(path);
	}

	ok(http, { path, mode: modestr });
}

function api_detect_type() {
	let path = normalize_path(http.formvalue('path'));

	if (!path)
		return fail(http, 1, tr('Invalid path'));

	let st = stat(path);
	if (!st)
		return fail(http, 2, tr('Path not found'));

	if (st.type == 'directory')
		return ok(http, { path, type: 'directory', kind: 'directory', mime: null, size: -1 });

	let ct = detect_content_type(path, st);

	ok(http, {
		path, type: ct.kind, kind: ct.kind, mime: ct.mime,
		size: st.size ?? 0,
		mtime: st.mtime ?? 0,
		numeric_permissions: sprintf('%03o', (st.mode ?? 0) & 0o777),
		editable: !is_system_path(path) || read_preferences().allow_system_operations
	});
}

function api_read_text() {
	let path = normalize_path(http.formvalue('path'));

	if (!path)
		return fail(http, 1, tr('Invalid path'));

	let st = stat(path);
	if (!st || st.type != 'file')
		return fail(http, 2, tr('Not a regular file'));

	let fd = open(path, 'r');
	if (!fd)
		return fail(http, 3, tr('Open failed'));

	let content = fd.read('all') ?? '';
	fd.close();

	ok(http, {
		path,
		content,
		size: st.size ?? 0,
		mtime: st.mtime ?? 0,
		is_text: looks_like_text(content),
		numeric_permissions: sprintf('%03o', (st.mode ?? 0) & 0o777)
	});
}

function api_save_text() {
	let path = validate_write_request(http, http.formvalue('path'));
	if (!path) return;

	let content = http.formvalue('content') ?? '';
	let st = lstat_safe(path);

	if (st && st.type == 'directory')
		return fail(http, 2, tr('Target is a directory'));

	let mode = st ? (st.mode & 0o7777) : 0o644;
	let tmp  = path + '.harbor-tmp';

	let fd = open(tmp, 'w', mode);
	if (!fd)
		return fail(http, 3, tr('Cannot create temporary file'));

	let written = fd.write(content);
	fd.flush();
	fd.close();

	if (written == null) {
		unlink(tmp);
		return fail(http, 4, tr('Write failed'));
	}

	if (!rename(tmp, path)) {
		unlink(tmp);
		return fail(http, 5, tr('Rename failed'));
	}

	chmod(path, mode);

	let nst = stat(path);
	ok(http, { path, size: nst?.size ?? 0, mtime: nst?.mtime ?? 0 });
}

function api_save_editor_upload() {
	let q = query_params(http);
	let target = validate_write_request(http, q.path);
	if (!target) return;

	let existing = lstat_safe(target);
	if (existing && existing.type == 'directory')
		return fail(http, 2, tr('Target is a directory'));

	let mode = existing ? (existing.mode & 0o7777) : 0o644;
	let tmp = target + '.harbor-tmp';
	let state = { fd: null, written: 0, error: null };

	http.setfilehandler(function(meta, chunk, eof) {
		if (state.error)
			return;

		if (!state.fd) {
			state.fd = open(tmp, 'w', mode);
			if (!state.fd) {
				state.error = 'cannot create the temporary file';
				return;
			}
		}

		if (length(chunk)) {
			if (state.fd.write(chunk) == null) {
				state.error = 'write failed (disk full?)';
				state.fd.close();
				unlink(tmp);
				state.fd = null;
				return;
			}
			state.written += length(chunk);
		}

		if (eof && state.fd) {
			state.fd.flush();
			state.fd.close();
			state.fd = null;
		}
	});

	http.formvalue('__harbor_parse__');

	if (state.error) {
		unlink(tmp);
		return fail(http, 3, state.error);
	}

	if (!lstat_safe(tmp))
		return fail(http, 3, tr('No content received'));

	if (!rename(tmp, target)) {
		unlink(tmp);
		return fail(http, 4, tr('Rename failed'));
	}

	chmod(target, mode);

	let st = stat(target);
	ok(http, { path: target, size: st?.size ?? state.written, mtime: st?.mtime ?? 0 });
}

function api_upload_check() {
	let dir = normalize_path(formvalue_any(http, [ 'target_dir', 'path' ]));

	if (!dir)
		return fail(http, 1, tr('Invalid path'));

	let names = parse_path_array(http, 'names') ?? [];
	let total_size = +(http.formvalue('total_size') ?? 0);
	if (total_size != total_size)
		total_size = 0;

	let prefs = read_preferences();
	let conflicts = [], blocked = [];

	for (let name in names) {
		if (!valid_component(name)) {
			push(blocked, name);
			continue;
		}

		let target = join_path(dir, name);
		let st = lstat_safe(target);

		if (!st)
			continue;

		if (st.type == 'directory' ||
		    (is_system_path(target) && !prefs.allow_system_operations))
			push(blocked, name);
		else
			push(conflicts, name);
	}

	let space = get_directory_space_info(dir);
	let margin = space.margin ?? 0;

	let enough = (space.available == null) ||
		(space.available >= total_size + margin);

	ok(http, {
		path: dir,
		target_dir: dir,
		conflicts,
		blocked_conflicts: blocked,
		enough_space: enough,
		space_message: enough ? '' : 'space_less_than_50mb',
		total_size,
		available_bytes: space.available ?? 0,
		operation_space_margin: margin
	});
}

function api_upload() {
	let q = query_params(http);

	let dir = normalize_path(q.target_dir ?? q.path);
	if (!dir)
		return fail(http, 1, tr('Invalid target directory'));

	let prefs = read_preferences();
	if (is_system_path(dir) && !prefs.allow_system_operations)
		return write_json_status(http, 403, 'Forbidden',
			{ code: 1, message: tr('System folder operations are disabled') });

	let dst = stat(dir);
	if (!dst || dst.type != 'directory')
		return fail(http, 1, tr('Target directory does not exist'));

	let overwrite = (q.overwrite == '1');
	let expected  = (q.expected_size != null) ? +q.expected_size : -1;
	if (expected != expected)
		expected = -1;

	let state = { fd: null, path: null, written: 0, error: null };

	http.setfilehandler(function(meta, chunk, eof) {
		if (state.error)
			return;

		if (!state.fd && meta?.file) {
			let name = basename(meta.file);
			if (!valid_component(name)) {
				state.error = 'invalid file name';
				return;
			}

			let target = join_path(dir, name);

			if (lstat_safe(target) && !overwrite) {
				let unique = unique_target(dir, name);
				if (!unique) {
					state.error = 'target already exists';
					return;
				}
				target = unique;
			}

			state.path = target;
			state.fd = open(target + '.part', 'w', 0o644);

			if (!state.fd) {
				state.error = 'cannot create target file';
				return;
			}
		}

		if (state.fd && length(chunk)) {
			if (state.fd.write(chunk) == null) {
				state.error = 'write failed (disk full?)';
				state.fd.close();
				unlink(state.path + '.part');
				state.fd = null;
				return;
			}
			state.written += length(chunk);
		}

		if (eof && state.fd) {
			state.fd.flush();
			state.fd.close();
			state.fd = null;

			if (expected >= 0 && state.written != expected) {
				unlink(state.path + '.part');
				state.error = sprintf(tr('Size mismatch: got %d bytes, expected %d'),
					state.written, expected);
				return;
			}

			if (!rename(state.path + '.part', state.path)) {
				unlink(state.path + '.part');
				state.error = 'finalize failed';
			}
		}
	});

	http.formvalue('__harbor_parse__');

	if (state.error)
		return fail(http, 1, state.error);

	if (!state.path)
		return fail(http, 1, tr('No file received'));

	ok(http, { path: state.path, size: state.written });
}

function archive_busy() {
	return task_running(ARCHIVE_STATE_FILE);
}

function begin_archive_task(task) {
	unlink(ARCHIVE_RC);
	unlink(ARCHIVE_LOG);
	task.task_id = make_task_id('archive');
	task.done = false;
	task.state = 'running';
	task.started = now();
	task.pid = spawn_background(task.cmd, ARCHIVE_LOG, ARCHIVE_RC);
	delete task.cmd;
	write_task_state(ARCHIVE_STATE_FILE, task);
	return task;
}

function archive_entries(src, ext) {
	let lower = lc(src);
	let cmd;

	if (ext == 'zip')
		cmd = sprintf('unzip -l %s 2>/dev/null', shellquote(src));
	else if (substr(lower, -7) == '.tar.gz' || ext == 'tgz')
		cmd = sprintf('tar -tzf %s 2>/dev/null', shellquote(src));
	else if (substr(lower, -8) == '.tar.bz2' || ext == 'tbz')
		cmd = sprintf('tar -tjf %s 2>/dev/null', shellquote(src));
	else if (substr(lower, -7) == '.tar.xz' || ext == 'txz')
		cmd = sprintf('tar -tJf %s 2>/dev/null', shellquote(src));
	else if (ext == 'tar')
		cmd = sprintf('tar -tf %s 2>/dev/null', shellquote(src));
	else
		return null;

	let proc = popen(cmd, 'r');
	if (!proc)
		return null;

	let seen = {}, out = [];

	for (let line = proc.read('line'); length(line); line = proc.read('line')) {
		let name = trim(line);

		if (ext == 'zip') {
			let m = match(name, /^[0-9]+ +[^ ]+ +[^ ]+ +(.+)$/);
			if (!m)
				continue;
			name = m[1];
		}

		let top = split(name, '/')[0];
		if (top == '' || top == '.' || top == '..')
			continue;

		if (!seen[top]) {
			seen[top] = true;
			push(out, top);
		}
	}

	proc.close();
	return out;
}

function api_archive_create_start() {
	let dest_dir = validate_write_request(http,
		formvalue_any(http, [ 'target_dir', 'path' ]));
	if (!dest_dir) return;

	if (archive_busy())
		return write_json_status(http, 409, 'Conflict',
			{ code: 1, message: tr('Another archive task is already running') });

	let name = formvalue_any(http, [ 'output_name', 'name' ]);
	if (!valid_component(name))
		return fail(http, 1, tr('Invalid archive name'));

	let format = http.formvalue('format') ?? 'tar.gz';

	if (format != 'tar' && format != 'tar.gz')
		return fail(http, 1, tr('Unsupported archive format'));

	let sources = parse_path_array(http, 'sources') ??
		parse_path_array(http, 'paths') ?? [];

	if (!length(sources))
		return fail(http, 1, tr('No source given'));

	let rel = [], parent = null;

	for (let raw in sources) {
		let p = normalize_path(raw);
		if (!p || !lstat_safe(p))
			return fail(http, 1, sprintf(tr('Source not found: %s'), raw));
		parent ??= parent_path(p) ?? '/';
		push(rel, shellquote(path_name(p)));
	}

	let target = join_path(dest_dir, name);

	for (let raw in sources) {
		let p = normalize_path(raw);
		if (p && (p == target || is_descendant(p, target)))
			return fail(http, 5, tr('The archive cannot be written inside its own source'));
	}

	let existing = lstat_safe(target);

	if (existing && http.formvalue('overwrite') != '1')
		return fail(http, 3, 'archive already exists', {
			output_path: target,
			target_is_directory: (existing.type == 'directory')
		});

	if (existing && !remove_recursive(target))
		return fail(http, 6, tr('Cannot replace the existing target'));

	if (!have_tool('tar'))
		return fail(http, 2, 'tar is not installed', {
			missing_tool: 'tar',
			package_name: TOOL_PACKAGE_MAP.tar
		});

	let cmd = (format == 'tar')
		? sprintf('cd %s && tar -cvf %s %s',
			shellquote(parent), shellquote(target), join(' ', rel))
		: sprintf('cd %s && tar -czvf %s %s',
			shellquote(parent), shellquote(target), join(' ', rel));

	let task = begin_archive_task({
		mode: 'create', format, cmd,
		output_path: target, target_dir: dest_dir
	});

	ok(http, task);
}

function api_archive_extract_start() {
	let dest_dir = validate_write_request(http,
		formvalue_any(http, [ 'target_dir', 'destination' ]));
	if (!dest_dir) return;

	if (archive_busy())
		return write_json_status(http, 409, 'Conflict',
			{ code: 1, message: tr('Another archive task is already running') });

	let src = normalize_path(formvalue_any(http, [ 'path', 'archive', 'source' ]));

	if (!src || !lstat_safe(src))
		return fail(http, 1, tr('Archive not found'));

	let ext = file_extension(src);
	let lower = lc(src);
	let cmd, tool = 'tar';

	if (ext == 'zip') {
		tool = 'unzip';
		cmd = sprintf('unzip -o %s -d %s', shellquote(src), shellquote(dest_dir));
	}
	else if (substr(lower, -7) == '.tar.gz' || ext == 'tgz')
		cmd = sprintf('tar -xzvf %s -C %s', shellquote(src), shellquote(dest_dir));
	else if (substr(lower, -8) == '.tar.bz2' || ext == 'tbz')
		cmd = sprintf('tar -xjvf %s -C %s', shellquote(src), shellquote(dest_dir));
	else if (substr(lower, -7) == '.tar.xz' || ext == 'txz')
		cmd = sprintf('tar -xJvf %s -C %s', shellquote(src), shellquote(dest_dir));
	else if (ext == 'tar')
		cmd = sprintf('tar -xvf %s -C %s', shellquote(src), shellquote(dest_dir));
	else if (ext == 'gz') {
		tool = 'gunzip';
		cmd = sprintf('gunzip -c %s > %s', shellquote(src),
			shellquote(join_path(dest_dir, replace(path_name(src), /\.gz$/, ''))));
	}
	else
		return fail(http, 1, tr('Unsupported archive format'));

	if (!have_tool(tool))
		return fail(http, 2, sprintf(tr('%s is not installed'), tool), {
			missing_tool: tool,
			package_name: TOOL_PACKAGE_MAP[tool] ?? tool
		});

	if (!mkdir_p(dest_dir))
		return fail(http, 5, tr('Cannot create the destination directory'));

	let dst = stat(dest_dir);
	if (!dst || dst.type != 'directory')
		return fail(http, 5, tr('Destination is not a directory'));

	if (http.formvalue('overwrite') != '1') {
		let entries = archive_entries(src, ext);
		let clash = [];

		for (let name in (entries ?? []))
			if (lstat_safe(join_path(dest_dir, name)))
				push(clash, name);

		if (length(clash))
			return fail(http, 3, 'the destination already contains these entries', {
				conflicts: clash,
				destination_path: dest_dir,
				path: src
			});
	}

	let task = begin_archive_task({
		mode: 'extract', format: ext, cmd,
		path: src, destination_path: dest_dir, target_dir: dest_dir
	});

	ok(http, task);
}

function api_archive_status() {
	let st = read_task_state(ARCHIVE_STATE_FILE);

	if (!st)
		return ok(http, { state: 'idle', done: true, success: false });

	let want = http.formvalue('task_id');
	if (want && st.task_id && want != st.task_id)
		return ok(http, { task_id: want, state: 'gone', done: true, success: false });

	if (!st.done && st.pid && !process_alive(st.pid)) {
		let rc = trim(readfile(ARCHIVE_RC) ?? '');
		st.exit_code = length(rc) ? +rc : 0;
		st.success = (st.exit_code == 0);
		st.state = st.success ? 'success' : 'failed';
		st.done = true;
		st.finished = now();
		write_task_state(ARCHIVE_STATE_FILE, st);
	}

	st.log = truncate_log(readfile(ARCHIVE_LOG) ?? '', 8192);

	if (st.done && !st.success && !st.message)
		st.message = sprintf(tr('Command exited with status %d'), st.exit_code ?? -1);

	ok(http, st);
}

return {
	api_navigation, api_list,
	api_create_directory, api_create_file, api_rename, api_delete,
	api_copy, api_move,
	api_batch_copy, api_batch_move, api_batch_delete, api_batch_check,
	api_chmod, api_detect_type,

	api_read_text, api_save_text,

	api_upload_check, api_upload, api_save_editor_upload,

	api_archive_create_start, api_archive_extract_start, api_archive_status,

	api_preferences, api_save_preferences,
	api_save_last_directory, api_save_show_line_numbers,
	api_bookmark_save, api_bookmark_delete, api_bookmark_move,
	api_bookmark_folder_add, api_bookmark_folder_rename, api_bookmark_folder_delete,
	api_bookmark_folder_state, api_bookmark_folder_move,

	api_terminal_info, api_terminal_tool_install_start,
	api_nginx_install_start, api_thumbnail_tool_install_start,
	api_tool_install_start,
	api_package_install_start, api_package_install_status,
	api_thumbnail_generate_start, api_thumbnail_generate_status
};
