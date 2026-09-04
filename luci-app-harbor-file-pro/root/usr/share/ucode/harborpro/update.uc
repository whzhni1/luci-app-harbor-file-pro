'use strict';

const _fs = require('fs');
const stat = _fs.stat, readfile = _fs.readfile, writefile = _fs.writefile,
      popen = _fs.popen;

const PACKAGE_NAME = 'luci-app-harbor-file-pro';
const FALLBACK_VERSION = '1.0.0';

const WORK_DIR = '/tmp/harbor_file_pro_update';
const STATE_FILE = WORK_DIR + '/state.json';
const LOG_FILE   = WORK_DIR + '/log';
const RC_FILE    = WORK_DIR + '/rc';
const PROG_FILE  = WORK_DIR + '/progress';
const RELEASE_FILE = WORK_DIR + '/release.json';
const SCRIPT     = WORK_DIR + '/update.sh';

const MIRRORS = [
	{ id: 'gitee',  api: 'https://gitee.com/api/v5/repos/whzhni/luci-app-harbor-file-pro/releases' },
	{ id: 'github', api: 'https://api.github.com/repos/whzhni1/luci-app-harbor-file-pro/releases/latest' },
	{ id: 'gitlab', api: 'https://gitlab.com/api/v4/projects/whzhni%2Fluci-app-harbor-file-pro/releases' }
];

function tr(s) {
	try { return _(s) ?? s; }
	catch (e) { return s; }
}

function shellquote(s) {
	return "'" + replace('' + s, "'", "'\\''") + "'";
}

function write_json(http, obj) {
	http.prepare_content('application/json; charset=UTF-8');
	http.write_json(obj);
}

function ok(http, data) {
	write_json(http, { code: 0, message: 'success', data });
}

function write_json_status(http, code, msg, obj) {
	http.status(code, msg);
	http.prepare_content('application/json; charset=UTF-8');
	http.write_json(obj);
}

function fail(http, code, message, data) {
	write_json(http, { code: code ?? 1, message: message ?? 'failed', data });
}

function detect_fetcher() {
	for (let p in [ '/usr/bin/curl', '/bin/curl' ])
		if (stat(p))
			return 'curl';
	for (let p in [ '/usr/bin/wget', '/bin/wget' ])
		if (stat(p))
			return 'wget';
	return null;
}

function fetch_url(url, connect_timeout, max_time) {
	let cmd;

	if (detect_fetcher() == 'curl')
		cmd = sprintf('curl -sL --connect-timeout %d --max-time %d %s 2>/dev/null',
			connect_timeout, max_time, shellquote(url));
	else
		cmd = sprintf('wget -q -T %d -O - %s 2>/dev/null', max_time, shellquote(url));

	let p = popen(cmd, 'r');
	if (!p)
		return null;

	let body = p.read('all');
	p.close();

	return (body != null && length(body)) ? body : null;
}

function detect_package_manager() {
	if (stat('/bin/apk') || stat('/usr/bin/apk'))
		return { pm: 'apk',  ext: '.apk' };
	if (stat('/bin/opkg') || stat('/usr/bin/opkg'))
		return { pm: 'opkg', ext: '.ipk' };
	return null;
}

function pkg_query(pm) {
	let pkg = shellquote(PACKAGE_NAME);
	let cmd = (pm?.pm == 'apk')
		? sprintf('apk info %s 2>/dev/null | head -1', pkg)
		: sprintf('opkg info %s 2>/dev/null | grep ^Version:', pkg);
	let p = popen(cmd, 'r');
	let line = trim(p?.read('line') ?? '');
	if (p) p.close();
	return length(line) ? line : null;
}

function pkg_version(pm, line) {
	if (line == null)
		return null;
	let v = trim(line);
	let prefix = PACKAGE_NAME + '-';
	let cut;

	if (pm?.pm == 'apk') {
		cut = index(v, ' description:');
		if (cut >= 0)
			v = substr(v, 0, cut);
		if (substr(v, 0, length(prefix)) == prefix)
			v = substr(v, length(prefix));
	}
	else if (substr(v, 0, 8) == 'Version:') {
		v = trim(substr(v, 8));
	}

	cut = index(v, ':');
	if (cut >= 0)
		v = substr(v, cut + 1);

	let m = match(trim(v), /^v?([0-9]+(\.[0-9]+)*)/);
	return m ? m[1] : null;
}

function installed_version(pm) {
	pm = pm ?? detect_package_manager();
	return pkg_version(pm, pkg_query(pm)) ?? FALLBACK_VERSION;
}

function parse_ver(v) {
	let m = match('' + v, /([0-9]+)\.([0-9]+)\.?([0-9]+)?/);
	if (!m)
		return null;
	return [ +m[1], +m[2], +(m[3] ?? 0) ];
}

function ver_cmp(a, b) {
	let va = parse_ver(a), vb = parse_ver(b);
	if (!va) return (vb ? -1 : 0);
	if (!vb) return 1;
	for (let i = 0; i < 3; i++) {
		if (va[i] < vb[i]) return -1;
		if (va[i] > vb[i]) return 1;
	}
	return 0;
}

function release_entries(body) {
	let v;

	try { v = json(body); }
	catch (e) { return []; }

	if (type(v) == 'array')
		return filter(v, (x) => type(x) == 'object');

	if (type(v) == 'object')
		return [ v ];

	return [];
}

function clean_tag(t) {
	let v = trim('' + (t ?? ''));
	return ((substr(v, 0, 1) == 'v' || substr(v, 0, 1) == 'V')) ? substr(v, 1) : v;
}

function all_tags(body) {
	let tags = [];

	for (let rel in release_entries(body)) {
		let t = clean_tag(rel?.tag_name);
		if (length(t) && index(tags, t) < 0)
			push(tags, t);
	}

	return tags;
}

function latest_release(body) {
	let best = null, best_tag = null;

	for (let rel in release_entries(body)) {
		let t = clean_tag(rel?.tag_name);
		if (!length(t))
			continue;
		if (!best_tag || ver_cmp(t, best_tag) > 0) {
			best_tag = t;
			best = rel;
		}
	}

	return best ? { tag: best_tag, release: best } : null;
}

function latest_tag(body) {
	let r = latest_release(body);
	return r ? r.tag : null;
}

function current_lang() {
	let l = null;

	try { l = dispatcher?.lang; }
	catch (e) { l = null; }

	if (!length(l)) {
		try {
			let uci = require('uci').cursor();
			uci.load('luci');
			l = uci.get('luci', 'main', 'lang');
			uci.unload('luci');
		}
		catch (e) { l = null; }
	}

	l = trim('' + (l ?? ''));
	return (length(l) && l != 'auto') ? l : 'en';
}

function lang_tokens(l) {
	let low = lc(l);
	let toks = [];

	for (let t in [ replace(low, '_', '-'), replace(low, '-', '_') ])
		if (length(t) && index(toks, t) < 0)
			push(toks, t);

	return toks;
}

function is_lang_asset(url, toks) {
	let base = lc(replace(replace(url, /[?#].*$/, ''), /^.*\//, ''));

	if (index(base, 'i18n') < 0)
		return false;

	for (let t in toks)
		if (match(base, regexp('[-_]' + t + '[-_.]')))
			return true;

	return false;
}

function collect_urls(v, ext, main, i18n, seen) {
	let tv = type(v);

	if (tv == 'array') {
		for (let item in v)
			collect_urls(item, ext, main, i18n, seen);
		return;
	}

	if (tv == 'object') {
		for (let k in v)
			collect_urls(v[k], ext, main, i18n, seen);
		return;
	}

	if (tv != 'string' || !match(v, /^https?:\/\//))
		return;

	if (substr(lc(v), length(v) - length(ext)) != ext)
		return;

	if (index(seen, v) >= 0)
		return;

	push(seen, v);

	let base = lc(replace(replace(v, /[?#].*$/, ''), /^.*\//, ''));
	if (index(base, 'i18n') >= 0)
		push(i18n, v);
	else
		push(main, v);
}

function asset_urls(body, pm) {
	let ext = pm.ext;
	let main = [], i18n = [], seen = [];
	let r = latest_release(body);

	if (r)
		collect_urls(r.release, ext, main, i18n, seen);

	let toks = lang_tokens(current_lang());
	let lang = filter(i18n, (u) => is_lang_asset(u, toks));

	return { main, lang };
}

function mirror_order(pref) {
	if (pref && pref != 'auto') {
		for (let m in MIRRORS)
			if (m.id == pref)
				return [ m ];
	}
	return MIRRORS;
}

function read_mirror_pref() {
	try {
		let uci = require('uci').cursor();
		uci.load('harbor_file_pro');
		let v = uci.get('harbor_file_pro', 'main', 'update_mirror');
		uci.unload('harbor_file_pro');
		return (v == 'gitee' || v == 'github' || v == 'gitlab') ? v : 'auto';
	}
	catch (e) {
		return 'auto';
	}
}

function api_update_check() {
	if (!detect_fetcher())
		return ok(http, {
			current: installed_version(),
			fetcher: false
		});

	let pm = detect_package_manager();
	let current = installed_version(pm);

	if (!pm)
		return ok(http, {
			current,
			latest: null,
			has_update: false,
			fetcher: true,
			pm: null
		});

	for (let m in mirror_order(read_mirror_pref())) {
		let body = fetch_url(m.api, 3, 8);
		if (!body)
			continue;

		let latest = latest_tag(body);
		if (!latest)
			continue;

		let urls = asset_urls(body, pm);

		return ok(http, {
			current,
			latest,
			has_update: ver_cmp(latest, current) > 0,
			mirror: m.id,
			main_url: urls.main[0] ?? null,
			lang_url: urls.lang[0] ?? null,
			lang: current_lang(),
			fetcher: true,
			pm: pm.pm,
			ext: pm.ext
		});
	}

	return ok(http, {
		current,
		latest: null,
		has_update: false,
		fetcher: true,
		pm: pm.pm,
		ext: pm.ext
	});
}

function read_state() {
	try {
		let v = json(readfile(STATE_FILE) ?? 'null');
		return (type(v) == 'object') ? v : null;
	}
	catch (e) {
		return null;
	}
}

function task_running(st) {
	if (!st || st.done)
		return false;
	if (!st.pid)
		return true;

	let p = popen(sprintf('kill -0 %d 2>/dev/null && echo y', st.pid), 'r');
	let alive = trim(p?.read('all') ?? '');
	if (p) p.close();
	return alive == 'y';
}

function build_update_script(main_urls, lang_url, pm) {
	let fetch = detect_fetcher();
	let dl, head;

	let main_out = WORK_DIR + '/main' + pm.ext;
	let lang_out = WORK_DIR + '/lang' + pm.ext;

	if (fetch == 'curl') {
		dl = '"$FETCH" -fsL --retry 2 --retry-delay 1 --connect-timeout 5 --max-time 120 -o "$out" "$u" >/dev/null 2>&1';
		head = '$FETCH -sIL --connect-timeout 5 --max-time 8 "$1" 2>/dev/null';
	}
	else {
		dl = '"$FETCH" -q -T 120 -O "$out" "$u" >/dev/null 2>&1';
		head = ':';
	}

	let L = [
		'#!/bin/sh',
		'FETCH=' + shellquote(fetch),
		'PM=' + shellquote(pm.pm),
		'PROG=' + shellquote(PROG_FILE),
		'MAIN_OUT=' + shellquote(main_out),
		'LANG_OUT=' + shellquote(lang_out),
		'URLS_MAIN=' + shellquote(join(' ', main_urls)),
		'URL_LANG=' + shellquote(lang_url ?? ''),
		'',
		'fsize() {',
		's=""',
		'[ -f "$1" ] && s=$( { wc -c < "$1"; } 2>/dev/null | tr -dc 0-9)',
		'echo "${s:-0}"',
		'}',
		'',
		'total_of() {',
		'(' + head + ') | awk \'tolower($1)=="content-length:" {v=$2} END {print v}\' | tr -dc \'0-9\'',
		'}',
		'',
		'dl() {',
		'urls="$1"; out="$2"; ph="$3"',
		'rm -f "$out"',
		'for u in $urls; do',
		'tot=$(total_of "$u")',
		'[ -n "$tot" ] || tot=0',
		'echo "$ph 0 $tot" > "$PROG"',
		dl + ' &',
		'cpid=$!',
		'while kill -0 $cpid 2>/dev/null; do',
		'sleep 1',
		'got=$(fsize "$out")',
		'echo "$ph $got $tot" > "$PROG"',
		'done',
		'wait $cpid',
		'sz=$(fsize "$out")',
		'[ "$sz" -gt 0 ] || { rm -f "$out"; continue; }',
		'if verify "$out"; then',
		'return 0',
		'fi',
		'echo "checksum failed: $u"',
		'rm -f "$out"',
		'echo "failed 0 0" > "$PROG"',
		'exit 1',
		'done',
		'return 1',
		'}',
		'',
		'HAY=' + shellquote(RELEASE_FILE),
		'verify() {',
		'out="$1"',
		'[ -s "$HAY" ] || return 0',
		'h=$(sha256sum "$out" 2>/dev/null | awk \'{print $1}\')',
		'[ -n "$h" ] || return 0',
		'grep -qE "[a-fA-F0-9]{64}" "$HAY" 2>/dev/null || return 0',
		'grep -qi "$h" "$HAY" 2>/dev/null',
		'}',
		'dl "$URLS_MAIN" "$MAIN_OUT" main || { echo "main download failed"; echo "failed 0 0" > "$PROG"; exit 1; }',
		'',
		'if [ -n "$URL_LANG" ]; then',
		'dl "$URL_LANG" "$LANG_OUT" lang || rm -f "$LANG_OUT"',
		'fi',
		'',
		'echo "install 0 0" > "$PROG"',
		'if [ "$PM" = apk ]; then',
		'apk add --allow-untrusted "$MAIN_OUT" || { echo "main install failed"; echo "failed 0 0" > "$PROG"; exit 1; }',
		'[ -f "$LANG_OUT" ] && apk add --allow-untrusted "$LANG_OUT" || true',
		'else',
		'opkg install "$MAIN_OUT" || { echo "main install failed"; echo "failed 0 0" > "$PROG"; exit 1; }',
		'[ -f "$LANG_OUT" ] && opkg install "$LANG_OUT" || true',
		'fi',
		'',
		'rm -f "$MAIN_OUT" "$LANG_OUT"',
		'echo "done 0 0" > "$PROG"',
		'exit 0'
	];

	return join('\n', L) + '\n';
}

function spawn_logged(cmd) {
	let full = sprintf('( { ( %s ) 2>&1; echo $? >%s; } >%s 2>&1 ) </dev/null >/dev/null 2>&1 & echo $!',
		cmd, shellquote(RC_FILE), shellquote(LOG_FILE));

	let proc = popen(full, 'r');
	if (!proc)
		return null;

	let pid = trim(proc.read('line') ?? '');
	proc.close();
	return length(pid) ? +pid : null;
}

function api_update_start() {
	let st = read_state();

	if (task_running(st))
		return write_json_status(http, 409, 'Conflict',
			{ code: 1, message: tr('another installation is already running') });

	if (!detect_fetcher())
		return fail(http, 1, 'curl or wget is required');

	let pm = detect_package_manager();
	if (!pm)
		return fail(http, 1, 'no supported package manager found');

	let pref = read_mirror_pref();
	let sorted = [];
	for (let m in mirror_order(pref))
		push(sorted, m);

	let pref_main = [], pref_lang = [];
	let api_dump = '';

	for (let m in sorted) {
		let body = fetch_url(m.api, 3, 8);
		if (!body)
			continue;

		api_dump += body + '\n';
		let urls = asset_urls(body, pm);
		for (let u in urls.main)
			if (index(pref_main, u) < 0)
				push(pref_main, u);
		for (let u in urls.lang)
			if (index(pref_lang, u) < 0)
				push(pref_lang, u);
	}

	if (!length(pref_main))
		return fail(http, 1, pref == 'auto'
			? sprintf('no %s package found in release (package manager: %s)', pm.ext, pm.pm)
			: sprintf('no %s package found on mirror %s (package manager: %s)', pm.ext, pref, pm.pm));

	system(sprintf('rm -rf %s && mkdir -p %s && chmod 0700 %s',
		shellquote(WORK_DIR), shellquote(WORK_DIR), shellquote(WORK_DIR)));

	writefile(RELEASE_FILE, api_dump);
	writefile(SCRIPT, build_update_script(pref_main, pref_lang[0] ?? null, pm));

	let task_id = sprintf('update-%d', time());
	let pid = spawn_logged('sh ' + SCRIPT);

	let state = {
		task_id, pid,
		started: time(),
		done: false,
		success: false
	};
	writefile(STATE_FILE, sprintf('%J', state));

	ok(http, {
		task_id,
		mirrors: length(MIRRORS),
		urls: length(pref_main),
		pm: pm.pm,
		ext: pm.ext
	});
}

function tail_text(s, n) {
	s = '' + (s ?? '');
	return (length(s) > n) ? '...' + substr(s, length(s) - n) : s;
}

function api_update_status() {
	let want = http.formvalue('task_id');
	let st = read_state();

	if (!st || (want && st.task_id != want))
		return ok(http, { task_id: want, state: 'idle', done: true, success: false });

	let phase = 'main', got = 0, total = 0;

	let prog = trim(readfile(PROG_FILE) ?? '');
	if (length(prog)) {
		let m = match(prog, /^(main|lang|install|done|failed) ([0-9]+) ([0-9]+)$/);
		if (m) {
			phase = m[1];
			got = +m[2];
			total = +m[3];
		}
	}

	let rc = trim(readfile(RC_FILE) ?? '');
	let done = false, success = false;

	if (length(rc)) {
		done = true;
		success = (+rc == 0) && phase != 'failed';
		if (phase != 'done' && phase != 'failed')
			phase = success ? 'done' : 'failed';
	}
	else if (!task_running(st)) {
		done = true;
		success = false;
		if (phase != 'done')
			phase = 'failed';
	}

	if (done && success)
		phase = 'done';
	if (done && !success)
		phase = 'failed';

	ok(http, {
		task_id: st.task_id,
		phase,
		downloaded: got,
		total,
		done,
		success,
		log: tail_text(readfile(LOG_FILE) ?? '', 8000)
	});
}

return {
	api_update_check,
	api_update_start,
	api_update_status,

	detect_package_manager,
	all_tags, latest_tag, ver_cmp, asset_urls,
	build_update_script
};