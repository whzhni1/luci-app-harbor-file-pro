'use strict';

const _fs = require('fs');
const stat = _fs.stat, readfile = _fs.readfile, writefile = _fs.writefile,
      popen = _fs.popen;

const PACKAGE_NAME = 'luci-app-harbor-file-pro';
const FALLBACK_VERSION = '1.0.0';

const RUNTIME_DIR = '/tmp/harbor_file_pro';
const WORK_DIR = RUNTIME_DIR + '/update';
const PRISM_DIR = '/www/luci-static/resources/harbor_file_pro/prism';
const PRISM_WORK = RUNTIME_DIR + '/prism-update';
const PRISM_SOURCES = [
	{ id: 'npmmirror', name: 'npmmirror', url: 'https://registry.npmmirror.com/prismjs/%s/files/' },
	{ id: 'jsdelivr', name: 'jsDelivr', url: 'https://cdn.jsdelivr.net/npm/prismjs@%s/' },
	{ id: 'unpkg', name: 'UNPKG', url: 'https://unpkg.com/prismjs@%s/' }
];
const PRISM_COMPONENTS = [ 'core', 'markup', 'css', 'clike', 'javascript', 'bash', 'json', 'yaml', 'ini', 'nginx', 'lua' ];

const PRISM_COMPONENT_PLAN = "const fs = require('fs');\nconst data = json(fs.readfile(ARGV[0]));\nconst selected = {}, state = {}, order = [];\nfunction invalid() { die('Invalid Prism component manifest'); }\nfunction entry(id) {\n let valid = type(id) == 'string' ? match(id, /^[a-z][a-z0-9-]{0,63}$/) : null;\n if (!valid || valid[0] != id) invalid();\n let item = id == 'core' ? data.core?.core : data.languages?.[id];\n if (type(item) == 'string' && length(item)) return {};\n if (type(item) != 'object') invalid();\n return item;\n}\nfunction names(value) {\n if (value == null) return [];\n if (type(value) == 'string') return [value];\n if (type(value) != 'array' || length(value) > 32) invalid();\n for (let id in value) if (type(id) != 'string') invalid();\n return value;\n}\nfunction collect(id) {\n if (selected[id]) return;\n let item = entry(id);\n selected[id] = true;\n if (length(selected) > 32) invalid();\n for (let dep in names(item.require)) collect(dep);\n}\nfunction visit(id) {\n if (state[id] == 2) return;\n if (state[id] == 1) invalid();\n state[id] = 1;\n let item = entry(id);\n for (let key in ['require', 'optional', 'modify'])\n  for (let dep in names(item[key])) if (selected[dep]) visit(dep);\n state[id] = 2;\n push(order, id);\n}\nfor (let id in split(ARGV[1], ' ')) collect(id);\nfor (let id in split(ARGV[1], ' ')) visit(id);\nfor (let id in order) print(id + '\\n');\n";

const INSTALL_LOCK = RUNTIME_DIR + '/resource-install-lock';
const STATE_FILE = WORK_DIR + '/state.json';
const LOG_FILE   = WORK_DIR + '/log';
const RC_FILE    = WORK_DIR + '/rc';
const PROG_FILE  = WORK_DIR + '/progress';
const RELEASE_FILE = WORK_DIR + '/release.json';
const SCRIPT     = WORK_DIR + '/update.sh';
const TMP_MAIN   = WORK_DIR + '/main';
const TMP_LANG   = WORK_DIR + '/lang';

const MIRRORS = [
	{ id: 'gitee',  api: 'https://gitee.com/api/v5/repos/whzhni/luci-app-harbor-file-pro/releases' },
	{ id: 'github', api: 'https://api.github.com/repos/whzhni1/luci-app-harbor-file-pro/releases/latest' },
	{ id: 'gitlab', api: 'https://gitlab.com/api/v4/projects/whzhni%2Fluci-app-harbor-file-pro/releases' }
];

function ensure_runtime_dir() {
	let st = _fs.lstat(RUNTIME_DIR);
	if (!st) {
		_fs.mkdir(RUNTIME_DIR, 0o700);
		st = _fs.lstat(RUNTIME_DIR);
	}
	return st && st.type == 'directory' && _fs.chmod(RUNTIME_DIR, 0o700);
}

function tr(s) {
	try { return _(s) ?? s; }
	catch (e) { return s; }
}

function shellquote(s) {
	return "'" + replace('' + s, "'", "'\\''") + "'";
}

function write_json(http, obj) {
	if (http.header) http.header('Cache-Control', 'no-store');
	http.prepare_content('application/json; charset=UTF-8');
	http.write_json(obj);
}

function ok(http, data) {
	write_json(http, { code: 0, message: 'success', data });
}

function write_json_status(http, code, msg, obj) {
	if (http.header) http.header('Cache-Control', 'no-store');
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

function fetch_url(url, connect_timeout, max_time, max_bytes) {
	let cmd;
	if (detect_fetcher() == 'curl')
		cmd = sprintf('curl -sL %s --connect-timeout %d --max-time %d %s 2>/dev/null',
			max_bytes ? '-f --proto =https --proto-redir =https --max-filesize ' + max_bytes : '',
			connect_timeout, max_time, shellquote(url));
	else
		cmd = sprintf('wget -q -T %d -O - %s 2>/dev/null', max_time, shellquote(url));
	let p = popen(cmd, 'r');
	if (!p) return null;
	let body = p.read(max_bytes ? max_bytes + 1 : 'all');
	let rc = p.close();
	if (max_bytes && (length(body) > max_bytes || rc != 0)) return null;
	return body != null && length(body) ? body : null;
}

function detect_package_manager() {
	if (stat('/bin/apk') || stat('/usr/bin/apk'))
		return 'apk';
	if (stat('/bin/opkg') || stat('/usr/bin/opkg'))
		return 'opkg';
	return null;
}

function pkg_query(pm) {
	let pkg = shellquote(PACKAGE_NAME);
	let cmd = (pm == 'apk')
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

	if (pm == 'apk') {
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

function normalize_language(value) {
	if (type(value) != 'string')
		return '';
	let language = lc(replace(trim(value), /_/g, '-'));
	return length(language) <= 64 && match(language, /^[a-z]{2,8}(-[a-z0-9]{1,8})*$/) ? language : '';
}

function asset_filename(url) {
	let path = split(url, /[?#]/)[0];
	let parts = split(path, '/');
	return parts[length(parts) - 1];
}

function package_matches(name, prefix) {
	return substr(name, 0, length(prefix)) == prefix && match(substr(name, length(prefix)), /^[-_][0-9]/);
}

function collect_urls(v, ext, language, main, lang, seen) {
	let tv = type(v);

	if (tv == 'array') {
		for (let item in v)
			collect_urls(item, ext, language, main, lang, seen);
		return;
	}

	if (tv == 'object') {
		for (let k in v)
			collect_urls(v[k], ext, language, main, lang, seen);
		return;
	}

	if (tv != 'string' || !match(v, /^https?:\/\//) || index(seen, v) >= 0)
		return;

	let name = lc(asset_filename(v));
	if (substr(name, length(name) - length(ext)) != ext)
		return;

	push(seen, v);
	if (package_matches(name, PACKAGE_NAME))
		push(main, v);
	else if (length(language) && package_matches(name, 'luci-i18n-harbor-file-pro-' + language))
		push(lang, v);
}

function asset_urls(body, pm, language) {
	let ext = (pm == 'apk') ? '.apk' : '.ipk';
	let main = [], lang = [], seen = [];
	let r = latest_release(body);

	if (r)
		collect_urls(r.release, ext, normalize_language(language), main, lang, seen);

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

function read_state(path) {
	try {
		let v = json(readfile(path ?? STATE_FILE) ?? 'null');
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


function tail_text(s, n) {
	s = '' + (s ?? '');
	return (length(s) > n) ? '...' + substr(s, length(s) - n) : s;
}

function build_update_script(main_urls, lang_url, pm, details) {
	let fetch = detect_fetcher();
	let ext = pm == 'apk' ? '.apk' : '.ipk';
	let download, head;

	if (fetch == 'curl') {
		download = '"$FETCH" -fsSL --retry 2 --retry-delay 1 --connect-timeout 5 --max-time 120 -o "$part" "$u" >/dev/null';
		head = '"$FETCH" -sIL --connect-timeout 5 --max-time 8 "$1" 2>/dev/null';
	}
	else {
		download = '"$FETCH" -q -T 120 -O "$part" "$u" >/dev/null';
		head = ':';
	}

	let logs = [];
	for (let line in details?.logs ?? [])
		push(logs, "printf '%s\\n' " + shellquote(line));

	let L = [
		'#!/bin/sh',
		'FETCH=' + shellquote(fetch),
		'PM=' + shellquote(pm ?? 'opkg'),
		'INSTALL_LOCK=' + shellquote(INSTALL_LOCK),
		'PROG=' + shellquote(PROG_FILE),
		'MAIN_OUT=' + shellquote(TMP_MAIN + ext),
		'LANG_OUT=' + shellquote(TMP_LANG + ext),
		'URLS_MAIN=' + shellquote(join(' ', main_urls)),
		'URL_LANG=' + shellquote(lang_url ?? ''),
		'HAY=' + shellquote(RELEASE_FILE),
		'LANGUAGE=' + shellquote(normalize_language(details?.language)),
		join('\n', logs),
		'printf \'Package manager: %s\\nLanguage: %s\\n\' "$PM" "${LANGUAGE:-not set}"',
		'',
		'file_size() (',
		'if [ -f "$1" ]; then',
		'size=$(wc -c 2>/dev/null < "$1") || size=0',
		'else',
		'size=0',
		'fi',
		'printf \'%s\' "$size" | tr -dc \'0-9\'',
		')',
		'',
		'total_of() {',
		'(' + head + ') | ' + "awk 'tolower($1)==\"content-length:\" {v=$2} END {print v}' | tr -dc '0-9'",
		'}',
		'',
		'verify() (',
		'[ -s "$1" ] || return 1',
		'[ -s "$HAY" ] || return 0',
		'grep -qE \'[a-fA-F0-9]{64}\' "$HAY" 2>/dev/null || return 0',
		'h=$(sha256sum "$1" 2>/dev/null | awk \'{print $1}\')',
		'[ -n "$h" ] || { echo "cannot calculate package SHA256"; return 1; }',
		'grep -qi "$h" "$HAY" 2>/dev/null',
		')',
		'',
		'dl() (',
		'urls="$1"; dest="$2"; ph="$3"; part="$2.part"',
		'rm -f "$dest" "$part"',
		'for u in $urls; do',
		'name=${u%%\\?*}; name=${name%%\\#*}; name=${name##*/}',
		'printf \'File: %s\\nURL: %s\\n\' "$name" "$u"',
		'rm -f "$part"',
		'tot=$(total_of "$u")',
		'[ -n "$tot" ] || tot=0',
		'echo "$ph 0 $tot" > "$PROG"',
		download + ' &',
		'cpid=$!',
		'while kill -0 "$cpid" 2>/dev/null; do',
		'sleep 1',
		'got=$(file_size "$part")',
		'echo "$ph $got $tot" > "$PROG"',
		'done',
		'if wait "$cpid"; then rc=0; else rc=$?; fi',
		'if [ "$rc" -ne 0 ]; then',
		'echo "download failed (exit $rc): $u"',
		'elif [ ! -s "$part" ]; then',
		'echo "download returned an empty or missing package: $u"',
		'elif ! verify "$part"; then',
		'echo "checksum failed: $u"',
		'elif mv -f "$part" "$dest"; then',
		'got=$(file_size "$dest")',
		'echo "$ph $got $tot" > "$PROG"',
		'printf \'Download complete: %s\\n\' "$name"',
		'return 0',
		'else',
		'echo "cannot save downloaded package: $dest"',
		'fi',
		'rm -f "$part"',
		'done',
		'return 1',
		')',
		'',
		'failed() {',
		'echo "$1"',
		'echo "failed 0 0" > "$PROG"',
		'exit 1',
		'}',
		'',
		'install_package() {',
		'if [ "$PM" = apk ]; then',
		'apk add --allow-untrusted "$1"',
		'else',
		'opkg install "$1"',
		'fi',
		'}',
		'',
		'rm -f "$LANG_OUT" "$LANG_OUT.part"',
		'if [ -z "$URL_LANG" ]; then',
		'printf \'No matching language package for %s; skipping\\n\' "${LANGUAGE:-not set}"',
		'fi',
		'dl "$URLS_MAIN" "$MAIN_OUT" main || failed "main download failed"',
		'if [ -n "$URL_LANG" ]; then',
		'if ! dl "$URL_LANG" "$LANG_OUT" lang; then',
		'echo "language package download failed; skipping optional language package"',
		'rm -f "$LANG_OUT"',
		'fi',
		'fi',
		'',
		'[ -s "$MAIN_OUT" ] || failed "main package is missing before installation"',
		'echo "install 0 0" > "$PROG"',
		'tries=0',
		'while ! mkdir -m 700 "$INSTALL_LOCK" 2>/dev/null; do',
		'tries=$((tries + 1))',
		'[ "$tries" -lt 30 ] || failed "Another resource installation is running"',
		'sleep 1',
		'done',
		'trap \'rmdir "$INSTALL_LOCK" 2>/dev/null || :\' 0',
		'echo "Installing main package"',
		'install_package "$MAIN_OUT" || failed "main install failed"',
		'if [ -s "$LANG_OUT" ]; then',
		'echo "Installing language package"',
		'install_package "$LANG_OUT" || echo "language package install failed"',
		'fi',
		'',
		'rm -f "$MAIN_OUT" "$LANG_OUT"',
		'echo "done 0 0" > "$PROG"',
		'echo "Update complete"',
		'exit 0'
	];

	return join('\n', L) + '\n';
}

function spawn_logged(cmd, log_file, rc_file, cleanup) {
	let full = sprintf('( { ( %s ) 2>&1; echo $? >%s; %s; } >%s 2>&1 ) </dev/null >/dev/null 2>&1 & echo $!',
		cmd, shellquote(rc_file ?? RC_FILE), cleanup ?? ':', shellquote(log_file ?? LOG_FILE));

	let proc = popen(full, 'r');
	if (!proc)
		return null;

	let pid = trim(proc.read('line') ?? '');
	proc.close();
	return length(pid) ? +pid : null;
}

function prism_version(value) {
	if (type(value) != 'string' || length(value) >= 40) return null;
	let parsed = match(value, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
	return parsed && parsed[0] == value ? value : null;
}

function prism_current() {
	let fallback = { current: '1.30.0', bundle: 'prism/builtin/prism.js' };
	try {
		let builtin = json(readfile(PRISM_DIR + '/builtin/version.json') ?? 'null');
		if (prism_version(builtin?.version)) fallback.current = builtin.version;
		let active = json(readfile(PRISM_DIR + '/active.json') ?? 'null');
		if (!prism_version(active?.version) || type(active?.sha256) != 'string' || !match(active.sha256, /^[a-f0-9]{64}$/)) return fallback;
		let directory = 'releases/' + active.version + '-' + substr(active.sha256, 0, 16);
		if (_fs.lstat(PRISM_DIR + '/' + directory)?.type != 'directory' || _fs.lstat(PRISM_DIR + '/' + directory + '/prism.js')?.type != 'file') return fallback;
		return { current: active.version, bundle: 'prism/' + directory + '/prism.js' };
	} catch (e) { return fallback; }
}

function prism_source(id) {
	if (id == null) id = PRISM_SOURCES[0].id;
	if (type(id) != 'string') return null;
	for (let source in PRISM_SOURCES) if (source.id == id) return source;
	return null;
}

function prism_dependencies() {
	let tools = { fetcher: detect_fetcher(), missing: [] };
	if (!tools.fetcher) push(tools.missing, 'curl');
	for (let name in [ 'sha256sum', 'ucode' ]) {
		tools[name] = system('command -v ' + name + ' >/dev/null 2>&1') == 0;
		if (!tools[name]) push(tools.missing, name);
	}
	tools.can_install = system('command -v opkg >/dev/null 2>&1 || command -v apk >/dev/null 2>&1') == 0;
	return tools;
}

function prism_missing_notice(tools) {
	return length(tools.missing) ? sprintf(tr('Missing Prism update tools: %s'), join(', ', tools.missing)) : '';
}

function prism_release(version, source) {
	if (version != 'latest' && !prism_version(version)) return null;
	if (!source) return null;
	let body = fetch_url(sprintf(source.url, version) + 'package.json', 5, 20, 262144);
	try {
		let data = json(body ?? 'null');
		if (data?.name != 'prismjs' || !prism_version(data?.version) || (version != 'latest' && data.version != version)) return null;
		return { version: data.version, source: source.id, url: sprintf(source.url, data.version) };
	} catch (e) { return null; }
}

function prism_task() {
	let state = read_state(PRISM_WORK + '/state.json');
	if (!state) return null;
	let rc = trim(readfile(PRISM_WORK + '/rc') ?? '');
	let done = length(rc) > 0 || !task_running(state);
	return {
		task_id: state.task_id,
		done,
		success: done && rc == '0',
		source: state.source,
		version: state.version,
		phase: trim(readfile(PRISM_WORK + '/progress') ?? 'preparing'),
		log: tail_text(readfile(PRISM_WORK + '/log') ?? '', 6000)
	};
}

function api_prism_status() {
	let current = prism_current();
	current.task = prism_task();
	current.tools = prism_dependencies();
	current.notice = prism_missing_notice(current.tools);
	current.can_update = !length(current.tools.missing);
	return ok(http, current);
}

function api_prism_check() {
	let current = prism_current();
	current.tools = prism_dependencies();
	if (length(current.tools.missing)) {
		current.can_update = false;
		current.has_update = false;
		current.notice = prism_missing_notice(current.tools);
		return ok(http, current);
	}
	let source = prism_source(http.formvalue('source'));
	if (!source) return fail(http, 1, tr('Invalid update source'));
	let release = prism_release('latest', source);
	if (!release) return fail(http, 1, tr('Version check failed'));
	let tools = !length(current.tools.missing);
	current.latest = release.version;
	current.can_update = !!tools;
	current.source = source.id;
	current.has_update = ver_cmp(release.version, current.current) > 0;
	current.notice = !tools ? prism_missing_notice(current.tools) : '';
	return ok(http, current);
}

function prism_runtime() {
	if (!ensure_runtime_dir()) return false;
	let st = _fs.lstat(PRISM_WORK);
	if (!st) {
		_fs.mkdir(PRISM_WORK, 0o700);
		st = _fs.lstat(PRISM_WORK);
	}
	return st?.type == 'directory' && _fs.chmod(PRISM_WORK, 0o700);
}

function build_prism_script(release, job) {
	return join('\n', [
		'#!/bin/sh',
		'ROOT=' + shellquote(PRISM_DIR),
		'WORK=' + shellquote(PRISM_WORK),
		'SOURCE=' + shellquote(release.source),
		'INSTALL_LOCK=' + shellquote(INSTALL_LOCK),
		'JOB=' + shellquote(job),
		'VERSION=' + shellquote(release.version),
		'URL=' + shellquote(release.url),
		'FETCH=' + shellquote(detect_fetcher()),
		'COMPONENTS=' + shellquote(join(' ', PRISM_COMPONENTS)),
		"set -eu",
		"umask 077",
		"created=0",
		"committed=0",
		"locked=0",
		"pointer=",
		"release=",
		"cleanup() {",
		"    code=$?",
		"    trap - 0",
		"    if [ \"$committed\" -eq 0 ] && [ \"$created\" -eq 1 ]; then rm -rf \"$release\"; fi",
		"    if [ -n \"$pointer\" ]; then rm -f \"$pointer\"; fi",
		"    if [ \"$locked\" -eq 1 ]; then rmdir \"$INSTALL_LOCK\" 2>/dev/null || :; fi",
		"    rm -rf \"$JOB\"",
		"    exit \"$code\"",
		"}",
		"trap cleanup 0",
		"trap 'exit 1' 1 2 15",
		"printf 'Prism version: %s\\nAPI: %s\\n' \"$VERSION\" \"$URL\"",
		"printf 'download' > \"$WORK/progress\"",
		"end=$(( $(date +%s) + 300 ))",
		"budget=8388608",
		"ulimit -f 4096",
		"fetch_part() {",
		"    output=\"$1\"",
		"    remaining=$(( end - $(date +%s) ))",
		"    [ \"$remaining\" -gt 0 ] || { echo 'Prism download timeout'; return 1; }",
		"    [ \"$remaining\" -le 20 ] || remaining=20",
		"    if [ \"$FETCH\" = curl ]; then",
		"        curl -fsSL --proto '=https' --proto-redir '=https' --connect-timeout 5 --max-time \"$remaining\" --max-filesize 262144 -H 'Cache-Control: no-cache' -o \"$output\" \"$URL$file\" || return 1",
		"    else",
		"        (ulimit -f 256; wget -q -T \"$remaining\" -O \"$output\" \"$URL$file\") || return 1",
		"    fi",
		"    bytes=$(wc -c < \"$output\")",
		"    [ \"$bytes\" -gt 0 ] && [ \"$bytes\" -le 262144 ] || return 1",
		"    budget=$(( budget - bytes ))",
		"    [ \"$budget\" -ge 0 ]",
		"}",
		"verified_file() {",
		"    file=\"$1\"",
		"    printf 'File: %s\\n' \"$file\"",
		"    fetch_part \"$JOB/part-a\" || return 1",
		"    fetch_part \"$JOB/part-b\" || return 1",
		"    a=$(sha256sum \"$JOB/part-a\") || return 1",
		"    b=$(sha256sum \"$JOB/part-b\") || return 1",
		"    a=${a%% *}; b=${b%% *}",
		"    [ \"${#a}\" -eq 64 ] && [ \"${#b}\" -eq 64 ] && [ \"$a\" = \"$b\" ] || { echo 'SHA256 downloads differ'; return 1; }",
		"    case \"$a\" in *[!0-9a-f]*) return 1;; esac",
		"    mv \"$JOB/part-a\" \"$JOB/part\"",
		"    rm -f \"$JOB/part-b\"",
		"}",
		"verified_file package.json",
		"mv \"$JOB/part\" \"$JOB/package.json\"",
		"ucode -e 'let p = json(require(\"fs\").readfile(ARGV[0])); exit(p.name == \"prismjs\" && p.version == ARGV[1] ? 0 : 1);' \"$JOB/package.json\" \"$VERSION\"",
		"verified_file components.json",
		"mv \"$JOB/part\" \"$JOB/components.json\"",
		'ucode -e ' + shellquote(PRISM_COMPONENT_PLAN) + ' "$JOB/components.json" "$COMPONENTS" > "$JOB/components"',
		"printf 'verify' > \"$WORK/progress\"",
		": > \"$JOB/prism.js\"",
		"while IFS= read -r component; do",
		"    verified_file \"components/prism-$component.min.js\"",
		"    cat \"$JOB/part\" >> \"$JOB/prism.js\"",
		"    printf '\\n' >> \"$JOB/prism.js\"",
		"    [ \"$(wc -c < \"$JOB/prism.js\")\" -le 1048576 ]",
		"done < \"$JOB/components\"",
		"verified_file LICENSE",
		"mv \"$JOB/part\" \"$JOB/LICENSE\"",
		"hash=$(sha256sum \"$JOB/prism.js\" | awk '{print $1}')",
		"prefix=$(printf '%s' \"$hash\" | cut -c1-16)",
		"name=\"$VERSION-$prefix\"",
		"release=\"$ROOT/releases/$name\"",
		"printf 'publish' > \"$WORK/progress\"",
		"tries=0",
		"while ! mkdir -m 700 \"$INSTALL_LOCK\" 2>/dev/null; do",
		"    tries=$((tries + 1))",
		"    [ \"$tries\" -lt 30 ] || { echo 'Another resource installation is running'; exit 1; }",
		"    sleep 1",
		"done",
		"locked=1",
		"[ -d \"$ROOT\" ] && [ ! -L \"$ROOT\" ] || exit 1",
		"if [ ! -e \"$ROOT/releases\" ]; then mkdir -m 755 \"$ROOT/releases\"; fi",
		"[ -d \"$ROOT/releases\" ] && [ ! -L \"$ROOT/releases\" ] || exit 1",
		"if [ -e \"$release\" ] || [ -L \"$release\" ]; then",
		"    [ -d \"$release\" ] && [ ! -L \"$release\" ] && [ -f \"$release/prism.js\" ] && [ ! -L \"$release/prism.js\" ] || exit 1",
		"    [ \"$(sha256sum \"$release/prism.js\" | awk '{print $1}')\" = \"$hash\" ]",
		"else",
		"    mkdir -m 755 \"$release\"",
		"    created=1",
		"    cp \"$JOB/prism.js\" \"$release/prism.js\"",
		"    cp \"$JOB/LICENSE\" \"$release/LICENSE\"",
		"    chmod 644 \"$release/prism.js\" \"$release/LICENSE\"",
		"fi",
		"pointer=$(mktemp \"$ROOT/.active.XXXXXX\")",
		"printf '{\"version\":\"%s\",\"sha256\":\"%s\"}\\n' \"$VERSION\" \"$hash\" > \"$pointer\"",
		"chmod 644 \"$pointer\"",
		"[ ! -L \"$ROOT/active.json\" ] && [ ! -d \"$ROOT/active.json\" ] || exit 1",
		"mv -f \"$pointer\" \"$ROOT/active.json\"",
		"pointer=",
		"committed=1",
		"printf 'done' > \"$WORK/progress\"",
		"echo 'Prism resources verified and published; refresh the page to use them'"
	]) + '\n';
}


function api_prism_start() {
	if (http.getenv('REQUEST_METHOD') != 'POST') return write_json_status(http, 405, 'Method Not Allowed', { code: 1, message: 'POST required' });
	let source = prism_source(http.formvalue('source'));
	if (!source) return fail(http, 1, tr('Invalid update source'));
	let version = prism_version(http.formvalue('version'));
	if (!version)
		return fail(http, 1, tr('Invalid Prism update version'));
	let tools = prism_dependencies();
	if (length(tools.missing)) return fail(http, 1, prism_missing_notice(tools));
	if (!prism_runtime()) return fail(http, 1, tr('Cannot create runtime directory'));
	if (task_running(read_state()) || !_fs.mkdir(PRISM_WORK + '/lock', 0o700))
		return write_json_status(http, 409, 'Conflict', { code: 1, message: tr('Another update is running. Please retry later.') });
	let task_id = sprintf('prism-%d-', time());
	let random = _fs.open('/dev/urandom', 'r');
	let bytes = random?.read(8);
	if (random) random.close();
	if (length(bytes) != 8) { _fs.rmdir(PRISM_WORK + '/lock'); return fail(http, 1, tr('Cannot start update task')); }
	for (let i = 0; i < 8; i++) task_id += sprintf('%02x', ord(bytes, i));
	let release = prism_release(version, source);
	if (!release) { _fs.rmdir(PRISM_WORK + '/lock'); return fail(http, 1, tr('Version check failed')); }
	let job = PRISM_WORK + '/' + task_id;
	if (!_fs.mkdir(job, 0o700)) { _fs.rmdir(PRISM_WORK + '/lock'); return fail(http, 1, tr('Cannot prepare update directory')); }
	_fs.unlink(PRISM_WORK + '/rc');
	let script = job + '/update.sh';
	if (writefile(PRISM_WORK + '/progress', 'preparing') == null || writefile(script, build_prism_script(release, job)) == null) {
		_fs.unlink(script); _fs.rmdir(job); _fs.rmdir(PRISM_WORK + '/lock');
		return fail(http, 1, tr('Cannot write update files'));
	}
	let state = { task_id, version, source: source.id, done: false, started: time() };
	if (writefile(PRISM_WORK + '/state.json', sprintf('%J', state)) == null) {
		_fs.unlink(script); _fs.rmdir(job); _fs.rmdir(PRISM_WORK + '/lock');
		return fail(http, 1, tr('Cannot write update files'));
	}
	let pid = spawn_logged('sh ' + shellquote(script), PRISM_WORK + '/log', PRISM_WORK + '/rc', 'rmdir ' + shellquote(PRISM_WORK + '/lock'));
	if (!pid) {
		writefile(PRISM_WORK + '/rc', '1');
		_fs.unlink(script); _fs.rmdir(job); _fs.rmdir(PRISM_WORK + '/lock');
		return fail(http, 1, tr('Cannot start update task'));
	}
	state.pid = pid;
	writefile(PRISM_WORK + '/state.json', sprintf('%J', state));
	return ok(http, { task_id });
}


function api_update_check() {
	let component = http.formvalue('component');
	if (component == 'prism') return api_prism_check();
	if (component != null && component != 'package') return fail(http, 1, tr('Invalid update component'));
	if (!detect_fetcher())
		return ok(http, {
			current: installed_version(),
			fetcher: false
		});

	let pm = detect_package_manager();
	let current = installed_version(pm);
	let language = normalize_language(http.formvalue('language'));

	for (let m in mirror_order(read_mirror_pref())) {
		let body = fetch_url(m.api, 3, 8);
		if (!body)
			continue;

		let latest = latest_tag(body);
		if (!latest)
			continue;

		let urls = asset_urls(body, pm, language);

		return ok(http, {
			current,
			latest,
			has_update: ver_cmp(latest, current) > 0,
			mirror: m.id,
			main_url: urls.main[0] ?? null,
			lang_url: urls.lang[0] ?? null,
			language,
			fetcher: true,
			pm
		});
	}

	return ok(http, {
		current,
		latest: null,
		has_update: false,
		fetcher: true,
		pm
	});
}

function api_update_start() {
	let component = http.formvalue('component');
	if (component == 'prism') return api_prism_start();
	if (component != null && component != 'package') return fail(http, 1, tr('Invalid update component'));
	if (_fs.lstat(PRISM_WORK + '/lock')) return fail(http, 1, tr('Another update is running. Please retry later.'));
	let st = read_state();

	if (task_running(st))
		return write_json_status(http, 409, 'Conflict',
			{ code: 1, message: tr('Another installation is already running') });

	if (!detect_fetcher())
		return fail(http, 1, 'curl or wget is required');

	let pm = detect_package_manager();
	if (!pm)
		return fail(http, 1, 'no supported package manager found');

	let pref = read_mirror_pref();
	let language = normalize_language(http.formvalue('language'));
	let logs = [];
	let sorted = [];
	for (let m in mirror_order(pref))
		push(sorted, m);

	let pref_main = [], pref_lang = [];
	let api_dump = '';

	for (let m in sorted) {
		push(logs, 'API: ' + m.api);
		let body = fetch_url(m.api, 3, 8);
		if (!body) {
			push(logs, 'API unavailable: ' + m.id);
			continue;
		}
		let tag = latest_tag(body);
		push(logs, tag ? 'Release: ' + tag + ' (' + m.id + ')' : 'No release found: ' + m.id);

		api_dump += body + '\n';
		let urls = asset_urls(body, pm, language);
		for (let u in urls.main)
			if (index(pref_main, u) < 0)
				push(pref_main, u);
		for (let u in urls.lang)
			if (index(pref_lang, u) < 0)
				push(pref_lang, u);
	}

	if (!length(pref_main))
		return fail(http, 1, pref == 'auto' ? 'no release package found'
			: sprintf('no release package found on mirror %s', pref));

	if (!ensure_runtime_dir())
		return fail(http, 1, tr('Cannot create runtime directory'));

	if (task_running(read_state()))
		return write_json_status(http, 409, 'Conflict',
			{ code: 1, message: tr('Another installation is already running') });

	if (system(sprintf('rm -rf %s && mkdir -p %s && chmod 0700 %s',
		shellquote(WORK_DIR), shellquote(WORK_DIR), shellquote(WORK_DIR))) != 0)
		return fail(http, 1, tr('Cannot prepare update directory'));

	if (writefile(RELEASE_FILE, api_dump) == null ||
		writefile(SCRIPT, build_update_script(pref_main, pref_lang[0] ?? null, pm, { language, logs })) == null)
		return fail(http, 1, tr('Cannot write update files'));

	let task_id = sprintf('update-%d', time());
	let pid = spawn_logged('sh ' + shellquote(SCRIPT));
	if (!pid)
		return fail(http, 1, tr('Cannot start update task'));

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
		urls: length(pref_main)
	});
}

function api_update_status() {
	let component = http.formvalue('component');
	if (component == 'prism') return api_prism_status();
	if (component != null && component != 'package') return fail(http, 1, tr('Invalid update component'));
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

	all_tags, latest_tag, ver_cmp, asset_urls,
	build_update_script
};
