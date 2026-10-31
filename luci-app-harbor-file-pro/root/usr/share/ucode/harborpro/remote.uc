'use strict';

const fs = require('fs');
const cursor = require('uci').cursor;
const CONFIG = 'harbor_file_pro';
const ROOT = '/tmp/harbor_file_pro/remote';
let H;

function quote(s) { return "'" + replace('' + s, "'", "'\\''") + "'"; }
function error(message, data) { die(sprintf('%J', { message, data })); }
function read_json(path) { try { return json(fs.readfile(path)); } catch (e) { return null; } }
function save_json(path, value) {
	if (!fs.writefile(path, sprintf('%J', value))) error('Cannot save task state');
	fs.chmod(path, 0o600);
}
function private_dir(path) {
	let st = fs.lstat(path);
	if (!st) { fs.mkdir(path, 0o700); st = fs.lstat(path); }
	if (!st || st.type != 'directory' || st.uid != fs.stat('/proc/self').uid || !fs.chmod(path, 0o700)) error('Unsafe runtime directory');
}
function token() {
	let f = fs.open('/dev/urandom', 'r');
	let bytes = f ? f.read(16) : null;
	if (f) f.close();
	if (length(bytes) != 16) error('Cannot create task ID');
	let out = '';
	for (let i = 0; i < 16; i++) out += sprintf('%02x', ord(bytes, i));
	return out;
}
function workspace() {
	if (!H.ensure_runtime_dir()) error('Unsafe runtime directory');
	private_dir(fs.dirname(ROOT));
	private_dir(ROOT);
	let path = ROOT + '/' + token();
	private_dir(path);
	return path;
}
function path_value(value) {
	if (type(value) != 'string' || index(value, '\x00') >= 0) error('Invalid path');
	let path = H.normalize_path(value);
	if (!path || length(path) > 4096) error('Invalid path');
	return path;
}
function array_value(value) {
	if (type(value) == 'string') { try { value = json(value); } catch (e) { error('Invalid selection'); } }
	if (type(value) != 'array' || length(value) > 4096) error('Invalid selection');
	return value;
}
function devices(secret) {
	let u = cursor(), result = [];
	u.load(CONFIG);
	u.foreach(CONFIG, 'remote_device', (s) => {
		let d = { id: s['.name'], name: s.name, host: s.host, port: +(s.port ?? 22), username: s.username, revision: s.revision ?? '', trusted: !!length(s.host_key ?? '') };
		if (secret) { d.password = s.password ?? ''; d.host_key = s.host_key ?? ''; }
		push(result, d);
	});
	return result;
}
function device(id) {
	if (id == '' || id == null) return null;
	for (let d in devices(true)) if (d.id == id) return d;
	error('Device not found');
}
function checked_device(id, revision) {
	let d = device(id);
	if (d && revision != null && revision != d.revision) error('Device settings changed; reopen the device');
	return d;
}
function update_device(p) {
	let d = { name: p.name, host: p.host, port: p.port, username: p.username, password: p.password ?? '' };
	if (type(d.host) == 'string') {
		d.host = trim(d.host);
		if (substr(d.host, 0, 1) == '[' && substr(d.host, -1) == ']') d.host = substr(d.host, 1, length(d.host) - 2);
	}
	if (type(d.name) != 'string' || !length(trim(d.name)) || length(d.name) > 128) error('Invalid device name');
	if (type(d.host) != 'string' || !match(d.host, /^[A-Za-z0-9:][A-Za-z0-9.:%_-]*$/) || length(d.host) > 253) error('Invalid IP address or domain name');
	if (type(d.username) != 'string' || !match(d.username, /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/) || length(d.username) > 64) error('Invalid username');
	if (!match('' + d.port, /^[0-9]+$/) || +d.port < 1 || +d.port > 65535) error('Invalid port');
	if (type(d.password) != 'string' || !length(trim(d.password)) || length(d.password) > 1024 || (index(d.password, '\x00') >= 0 || index(d.password, '\r') >= 0 || index(d.password, '\n') >= 0)) error('Invalid password: use 1–1024 bytes, not only whitespace, with no line breaks or NUL characters');
	H.read_preferences();
	fs.chmod('/etc/config/harbor_file_pro', 0o600);
	let old = p.id ? device(p.id) : null;
	let u = cursor(); u.load(CONFIG);
	let id = old ? old.id : u.add(CONFIG, 'remote_device');
	if (!id) error('Cannot save device');
	for (let key, value in d) if (!u.set(CONFIG, id, key, '' + value)) error('Cannot save device');
	if (old && (old.host != d.host || old.port != +d.port)) u.delete(CONFIG, id, 'host_key');
	if (!old || !old.revision || old.host != d.host || old.port != +d.port || old.username != d.username)
		if (!u.set(CONFIG, id, 'revision', token())) error('Cannot save device');
	if (!u.save(CONFIG) || !u.commit(CONFIG)) error('Cannot save device');
	fs.chmod('/etc/config/harbor_file_pro', 0o600);
	return { id };
}
function cleanup(dir) {
	for (let name in ['password', 'known_hosts', 'config', 'host-key']) fs.unlink(dir + '/' + name);
	fs.unlink(dir + '/.ssh/known_hosts');
	fs.rmdir(dir + '/.ssh');
}
function remove_query(dir) {
	cleanup(dir);
	fs.unlink(dir + '/error');
	fs.rmdir(dir);
}
function shell(command, dir, timeout) {
	let proc = fs.popen((timeout ? 'timeout ' + timeout + ' ' : '') + 'sh -c ' + quote(command) + ' 2>' + quote(dir + '/error'), 'r');
	if (!proc) error('Cannot start SSH');
	let output = proc.read(16777216) ?? '';
	let rc = proc.close();
	if (rc != 0 || length(output) >= 16777216) {
		let detail = fs.readfile(dir + '/error') ?? '';
		error(length(detail) ? substr(detail, -4096) : 'SSH command failed');
	}
	return output;
}
function client() {
	if (!H.command_exists('ssh')) error('SSH client is not installed');
	let proc = fs.popen('ssh -V 2>&1', 'r');
	let version = proc ? proc.read('all') : '';
	if (proc) proc.close();
	if (index(lc(version), 'dropbear') >= 0) return 'dropbear';
	if (index(version, 'OpenSSH') >= 0) return 'openssh';
	error('Unsupported SSH client');
}
function ssh_command(d, dir, script, probe) {
	script = 'PATH="$PATH:/usr/sbin:/usr/bin:/sbin:/bin"\nexport PATH\n' + script;
	if (!d) return 'sh -c ' + quote(script);
	private_dir(dir);
	private_dir(dir + '/.ssh');
	let kind = client();
	let keyfile = dir + '/.ssh/known_hosts';
	if (fs.writefile(keyfile, probe ? '' : d.host_key) == null) error('Cannot save host key');
	fs.chmod(keyfile, 0o600);
	let opts = kind == 'dropbear'
		? '-T -K 15 -I 120 ' + (probe ? '-y -o BatchMode=yes' : '-o StrictHostKeyChecking=yes')
		: '-F /dev/null -T -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o GlobalKnownHostsFile=/dev/null -o UserKnownHostsFile=' + quote(keyfile) + ' -o UpdateHostKeys=no -o PubkeyAuthentication=no ' +
			(probe ? '-o StrictHostKeyChecking=accept-new -o BatchMode=yes' : '-o StrictHostKeyChecking=yes -o NumberOfPasswordPrompts=1 -o PreferredAuthentications=password,keyboard-interactive');
	let auth = '';
	if (!probe) {
		if (!H.command_exists('sshpass')) error('sshpass is not installed');
		if (!fs.writefile(dir + '/password', d.password + '\n')) error('Cannot prepare authentication');
		fs.chmod(dir + '/password', 0o600);
		auth = 'sshpass -f ' + quote(dir + '/password') + ' ';
	}
	return 'unset SSH_AUTH_SOCK SSH_AGENT_PID; HOME=' + quote(dir) + ' ' + auth + 'ssh ' + opts + ' -p ' + d.port + ' -l ' + quote(d.username) + ' ' + quote(d.host) + ' ' + quote(script);
}
function trusted(d) {
	if (!d || d.host_key) return;
	let dir = workspace();
	try { shell(ssh_command(d, dir, ':', true), dir, 15); } catch (e) {}
	let key = fs.readfile(dir + '/.ssh/known_hosts') ?? '';
	let diagnostic = fs.readfile(dir + '/error') ?? '';
	cleanup(dir);
	let parts = split(trim(key), /\s+/);
	if (length(parts) != 3 || !match(parts[2], /^[A-Za-z0-9+\/=]+$/)) { remove_query(dir); error(length(diagnostic) ? substr(diagnostic, -2048) : 'Cannot read SSH host key'); }
	let digest;
	try {
		let raw = b64dec(parts[2]);
		if (!length(raw) || !fs.writefile(dir + '/host-key', raw) || !fs.chmod(dir + '/host-key', 0o600)) error('Cannot read SSH host key');
		digest = trim(shell('sha256sum < ' + quote(dir + '/host-key'), dir, 5));
	}
	catch (e) { remove_query(dir); die(e); }
	remove_query(dir);
	if (!match(digest, /^[a-f0-9]{64}\s/)) error('Cannot read SSH host key');
	let fingerprint = '';
	for (let i = 0; i < 64; i += 2) fingerprint += chr(int(substr(digest, i, 2), 16));
	let challenge = token();
	save_json(ROOT + '/trust-' + challenge, { id: d.id, host: d.host, port: d.port, key, expires: time() + 300 });
	error('Confirm SSH host key fingerprint', { challenge, device_id: d.id, name: d.name, host: d.host, port: d.port, fingerprint: 'SHA256:' + replace(b64enc(fingerprint), '=', '') });
}
function run(d, script) {
	trusted(d);
	let dir = workspace(), output;
	try { output = shell(ssh_command(d, dir, script, false), dir, 25); }
	catch (e) { remove_query(dir); die(e); }
	remove_query(dir);
	return output;
}
const STAT_DETECT = "stat_kind=missing\nif command -v stat >/dev/null 2>&1 && stat -c '%s %Y %a' / >/dev/null 2>&1; then\n stat_kind=command\nelif busybox stat -c '%s %Y %a' / >/dev/null 2>&1; then\n stat_kind=busybox\nfi\n";
const STAT_SUPPORT = STAT_DETECT + "case \"$stat_kind\" in\n busybox) stat() { busybox stat \"$@\"; };;\n missing) printf '%s\\n' 'stat is required on this device; install coreutils-stat on this device and reconnect' >&2; exit 127;;\nesac\n";
const LIST_SCRIPT = 'set -e\np=$1\ncd -P "$p"\nprintf "%s\\0" "$PWD"\ndf -Pk . | tail -n 1\nif command -v pv >/dev/null 2>&1; then printf "HF_PV=1\\n"; fi\nprintf "\\0"\n[ "$2" != capacity ] || exit 0\n' + STAT_SUPPORT + 'for f in ./* ./.[!.]* ./..?*; do\n [ -e "$f" ] || [ -L "$f" ] || continue\n k=file\n if [ -L "$f" ]; then k=symlink; [ ! -d "$f" ] || k=directory_link; elif [ -d "$f" ]; then k=directory; elif [ ! -f "$f" ]; then k=special; fi\n printf "%s\\0%s\\0" "${f#./}" "$k"\n stat -c "%s %Y %a" "$f"\n printf "\\0"\n if [ -L "$f" ]; then readlink -n "$f"; fi\n printf "\\0"\ndone';
function listing(d, path, capacity) {
	path = path_value(path);
	let raw;
	try { raw = run(d, 'sh -c ' + quote(LIST_SCRIPT) + ' sh ' + quote(path) + ' ' + quote(capacity ? 'capacity' : 'list')); }
	catch (e) {
		if (index('' + e, 'stat is required on this device; install coreutils-stat') >= 0)
			error('coreutils-stat is required to open this device', { stat_missing: true, device_id: d?.id ?? '', device_revision: d?.revision ?? '' });
		die(e);
	}
	let fields = split(raw, '\x00');
	if (length(fields) < 3 || (length(fields) - 3) % 4 != 0) error('Invalid remote directory response');
	let physical = path_value(fields[0]);
	let space = split(trim(fields[1]), /\s+/);
	let items = [];
	for (let i = 2; i + 3 < length(fields); i += 4) {
		let name = fields[i], meta = split(trim(fields[i + 2]), /\s+/), kind = fields[i + 1];
		if (!H.valid_component(name) || length(meta) != 3 || !match(meta[0], /^[0-9]+$/) || !match(meta[1], /^-?[0-9]+$/) || !match(meta[2], /^[0-7]+$/)) error('Invalid remote directory response');
		let full = H.join_path(path, name), is_link = kind == 'symlink' || kind == 'directory_link';
		push(items, { name, path: full, type: kind == 'directory_link' ? 'directory' : kind, size: +meta[0], mtime: +meta[1], mode: meta[2],
			is_symlink: is_link, link_target: is_link ? { raw: fields[i + 3] } : null,
			preview: 'none', ext: H.file_extension(name), hidden: substr(name, 0, 1) == '.' });
	}
	H.sort_directory_items(items);
	return { path, physical, transfer_meter: index(fields[1], '\nHF_PV=1') >= 0, parent: H.parent_path(path), items, available_bytes: (+space[3] || 0) * 1024,
		total_bytes: (+space[1] || 0) * 1024, used_bytes: (+space[2] || 0) * 1024,
		operation_space_margin: 16777216, has_operation_space: (+space[3] || 0) * 1024 >= 16777216 };
}
function parameters(http) {
	let p = {};
	for (let k in ['id', 'name', 'host', 'port', 'username', 'password', 'challenge', 'device_id', 'device_revision', 'source_device', 'target_device', 'source_revision', 'target_revision', 'path', 'sources', 'target_dir', 'tree_path', 'suggest_rename', 'rename_map', 'exclude_paths', 'conflict_action', 'preserve_permissions', 'task_id', 'operation', 'rpc_action', 'rpc_data']) p[k] = http.formvalue(k);
	return p;
}
function same_device(a, b) {
	return (!a && !b) || (a && b && lc(a.host) == lc(b.host) && a.port == b.port && a.username == b.username);
}
function plan(p) {
	if (p.operation && p.operation != 'copy' && p.operation != 'move') error('Invalid transfer operation');
	let source = checked_device(p.source_device, p.source_revision), target = checked_device(p.target_device, p.target_revision);
	if (!source && !target) error('A remote device is required');
	trusted(source); trusted(target);
	let dest = path_value(p.target_dir), paths = map(array_value(p.sources), path_value);
	if (!length(paths) || length(paths) > 4096) error('Invalid selection');
	let parent = H.parent_path(paths[0]);
	let selected_paths = {};
	for (let path in paths) {
		if (path == '/' || H.parent_path(path) != parent || selected_paths[path]) error('Select files from one directory');
		selected_paths[path] = true;
	}
	let direct = source && target && source.id == target.id && source.revision == target.revision;
	let src = listing(source, parent), dst = direct && parent == dest ? src : listing(target, dest), items = [], conflicts = [], names = {}, suggestions = {};
	if (!dst.has_operation_space) error('Not enough free space');
	if (!H.read_preferences().allow_system_operations && (H.is_system_path(dest) || H.is_system_path(dst.physical))) error('System folder operations are disabled');
	let renames = {};
	if (p.rename_map) { try { renames = json(p.rename_map); } catch (e) { error('Invalid name'); } }
	if (type(renames) != 'object') error('Invalid name');
	let used = {}, reserved = {};
	for (let item in dst.items) { used[item.name] = true; reserved[item.name] = true; }
	for (let path in paths) reserved[renames[path] ?? fs.basename(path)] = true;
	for (let path in paths) {
		let item;
		for (let candidate in src.items) if (candidate.path == path) { item = candidate; break; }
		if (!item || item.type == 'special') error('Source not found or unsupported file type');
		let name = renames[path] ?? item.name;
		if (!H.valid_component(name) || length(name) > 255 || names[name]) error('Invalid or duplicate target name');
		names[name] = true;
		let same = same_device(source, target);
		let physical_source = H.join_path(src.physical, item.name);
		if (p.operation == 'move' && ((!H.read_preferences().allow_system_operations && (H.is_system_path(item.path) || H.is_system_path(physical_source))) || H.is_descendant(physical_source, ROOT))) error('Source directory cannot be moved');
		if (same && ((item.type == 'directory' && !item.is_symlink && H.is_descendant(physical_source, dst.physical)) || H.join_path(dst.physical, name) == physical_source && !p.suggest_rename)) {
			if (!(p.conflict_action == 'rename' && name != item.name) && !used[name]) error('Cannot transfer a directory into itself');
			if (item.type == 'directory' && !item.is_symlink && H.is_descendant(physical_source, dst.physical)) error('Cannot transfer a directory into itself');
		}
		if (used[name]) {
			if (p.rename_map) error('Target already exists');
			push(conflicts, { path: item.path, name: item.name, type: item.is_symlink ? 'symlink' : item.type });
			let n = 1, candidate;
			let dot = item.type == 'directory' && !item.is_symlink ? -1 : rindex(item.name, '.');
			let base = dot > 0 ? substr(item.name, 0, dot) : item.name;
			let suffix = dot > 0 ? substr(item.name, dot) : '';
			candidate = base + ' (' + n++ + ')' + suffix;
			while (reserved[candidate] || names[candidate]) candidate = base + ' (' + n++ + ')' + suffix;
			suggestions[path] = candidate; reserved[candidate] = true;
		}
		item.target_name = name;
		push(items, item);
	}
	return { source, target, parent, dest, items, conflicts, rename_names: suggestions, physical_source: src.physical, physical_target: dst.physical, direct: direct && src.transfer_meter };
}
function exclude_pattern(path) {
	let out = '';
	for (let i = 0; i < length(path); i++) {
		let c = substr(path, i, 1);
		out += (index('\\*?[]', c) >= 0 ? '\\' : '') + c;
	}
	return out;
}
const MERGE_SCRIPT = "directory_info() {\n rel=\"./${1#\"$stage/data/\"}\"\n key=$(printf %s \"$rel\" | sha256sum) || return 1\n key=${key%% *}\n read -r stamp mode <\"$stage/modes/$key\"\n}\nrestore_directories() (\n s=$1\n for f in \"$s\"/* \"$s\"/.[!.]* \"$s\"/..?*; do\n  if [ -d \"$f\" ] && [ ! -L \"$f\" ]; then restore_directories \"$f\" || exit 1; fi\n done\n directory_info \"$s\" || exit 1\n touch -d \"@$stamp\" \"$s\" && chmod \"$mode\" \"$s\"\n)\nmerge() (\n s=$1; d=$2\n if [ -d \"$s\" ] && [ ! -L \"$s\" ]; then\n  if [ -e \"$d\" ] || [ -L \"$d\" ]; then\n   [ -d \"$d\" ] && [ ! -L \"$d\" ] || { echo \"File and directory types conflict: $d\" >&2; exit 1; }\n   for f in \"$s\"/* \"$s\"/.[!.]* \"$s\"/..?*; do\n    [ -e \"$f\" ] || [ -L \"$f\" ] || continue\n    merge \"$f\" \"$d/${f##*/}\" || exit 1\n   done\n   directory_info \"$s\" || exit 1\n   touch -d \"@$stamp\" \"$d\" && chmod \"$mode\" \"$d\" && rmdir \"$s\" || exit 1\n  else restore_directories \"$s\" && directory_info \"$s\" && chmod u+rwx \"$s\" && mv -T \"$s\" \"$d\" && chmod \"$mode\" \"$d\" || exit 1; fi\n else\n  if [ -d \"$d\" ] && [ ! -L \"$d\" ]; then echo \"File and directory types conflict: $d\" >&2; exit 1; fi\n  if [ \"$preserve\" = 1 ] && [ -f \"$d\" ] && [ ! -L \"$d\" ] && [ ! -L \"$s\" ]; then chmod \"$(stat -c %a \"$d\")\" \"$s\" || exit 1; fi\n  mv -fT \"$s\" \"$d\" || exit 1\n fi\n)\n";
const PATH_CODEC = "LC_ALL=C\nexport LC_ALL\nencode() (\n codec_rest=$1\n while [ -n \"$codec_rest\" ]; do\n  codec_tail=${codec_rest#?}\n  printf '%02x' \"'${codec_rest%\"$codec_tail\"}\" || exit 1\n  codec_rest=$codec_tail\n done\n)\ndecode() {\n case \"$1\" in ''|*[!0-9a-f]*) return 1;; esac\n [ $((${#1} % 2)) = 0 ] || return 1\n codec_rest=$1\n codec_escaped=\n while [ -n \"$codec_rest\" ]; do\n  codec_tail=${codec_rest#??}\n  codec_pair=${codec_rest%\"$codec_tail\"}\n  [ \"$codec_pair\" != 00 ] || return 1\n  codec_value=$((0x$codec_pair))\n  codec_escaped=$codec_escaped\\\\0$((codec_value / 64))$((codec_value / 8 % 8))$((codec_value % 8))\n  codec_rest=$codec_tail\n done\n decoded=$(printf '%b.' \"$codec_escaped\") || return 1\n decoded=${decoded%.}\n}\n";
const MOVE_SCAN = "set -e\nLC_ALL=C\nTZ=UTC\nexport LC_ALL TZ\nroot=$1\nphysical=$2\nshift 2\ncd -P \"$root\"\n[ \"$PWD\" = \"$physical\" ] || exit 1\nmount_points=$(while read -r mount_id parent_id device mount_root mount_path rest; do\n decoded=$(printf '%b.' \"$mount_path\")\n encode \"${decoded%.}\"\n printf '\\n'\ndone < /proc/self/mountinfo)\nis_mount() {\n case \"\n$mount_points\n\" in *\"\n$(encode \"$physical/${1#./}\")\n\"*) return 0;; esac\n return 1\n}\nidentity() { stat -c '%d:%i:%s:%a:%u:%g:%y|%h:%z' \"$1\"; }\nprobe() (\n p=$1\n parent=${p%/*}\n name=${p##*/}\n expected_parent=$physical\n [ \"$parent\" = . ] || expected_parent=$physical/${parent#./}\n cd -P \"$parent\" || exit 1\n [ \"$PWD\" = \"$expected_parent\" ] || exit 1\n p=./$name\n before=$(identity \"$p\") || exit 1\n if [ -L \"$p\" ]; then\n  kind=l\n  link=$(readlink -n \"$p\" && printf .) || exit 1\n  digest=$(encode \"${link%.}\")\n elif [ -d \"$p\" ]; then\n  kind=d\n  digest=-\n elif [ -f \"$p\" ]; then\n  kind=f\n  digest=$(sha256sum < \"$p\") || exit 1\n  digest=${digest%% *}\n  [ \"${#digest}\" = 64 ] || exit 1\n  case \"$digest\" in *[!0-9a-f]*) exit 1;; esac\n else\n  printf 'Unsupported or missing source: %s\\n' \"$p\" >&2\n  exit 1\n fi\n after=$(identity \"$p\") || exit 1\n [ \"$before\" = \"$after\" ] || { printf 'Source changed while hashing: %s\\n' \"$p\" >&2; exit 1; }\n printf '%s %s %s' \"$kind\" \"$(encode \"$before\")\" \"$digest\"\n)\nwalk() (\n p=$1\n key=$2\n excluded \"$p\" && exit 0\n is_mount \"$p\" && { printf 'Mount point cannot be moved: %s\\n' \"$p\" >&2; exit 1; }\n if [ -d \"$p\" ] && [ ! -L \"$p\" ]; then\n  for f in \"$p\"/* \"$p\"/.[!.]* \"$p\"/..?*; do\n   [ -e \"$f\" ] || [ -L \"$f\" ] || continue\n   walk \"$f\" \"$key/${f##*/}\" || exit 1\n  done\n fi\n details=$(probe \"$p\") || exit 1\n printf '%s %s %s\\n' \"$(encode \"$key\")\" \"$details\" \"$(encode \"$p\")\"\n)\nboot=$(cat /proc/sys/kernel/random/boot_id)\n[ -n \"$boot\" ] || exit 1\nprintf 'H %s %s %s\\n' \"$boot\" \"$(stat -c '%d:%i' .)\" \"$(encode \"$PWD\")\"\nn=0\nfor p do\n walk \"./$p\" \"$n\" || exit 1\n n=$((n + 1))\ndone\n";
const MOVE_COMMON = "set -e\nLC_ALL=C\nTZ=UTC\nexport LC_ALL TZ\nroot=$1\nphysical=$2\nshift 2\ncd -P \"$root\"\n[ \"$PWD\" = \"$physical\" ] || exit 1\nmount_points=$(while read -r mount_id parent_id device mount_root mount_path rest; do\n decoded=$(printf '%b.' \"$mount_path\")\n encode \"${decoded%.}\"\n printf '\\n'\ndone < /proc/self/mountinfo)\nis_mount() {\n case \"\n$mount_points\n\" in *\"\n$(encode \"$physical/${1#./}\")\n\"*) return 0;; esac\n return 1\n}\nidentity() { stat -c '%d:%i:%s:%a:%u:%g:%y|%h:%z' \"$1\"; }\nprobe() (\n p=$1\n parent=${p%/*}\n name=${p##*/}\n expected_parent=$physical\n [ \"$parent\" = . ] || expected_parent=$physical/${parent#./}\n cd -P \"$parent\" || exit 1\n [ \"$PWD\" = \"$expected_parent\" ] || exit 1\n p=./$name\n before=$(identity \"$p\") || exit 1\n if [ -L \"$p\" ]; then\n  kind=l\n  link=$(readlink -n \"$p\" && printf .) || exit 1\n  digest=$(encode \"${link%.}\")\n elif [ -d \"$p\" ]; then\n  kind=d\n  digest=-\n elif [ -f \"$p\" ]; then\n  kind=f\n  digest=$(sha256sum < \"$p\") || exit 1\n  digest=${digest%% *}\n  [ \"${#digest}\" = 64 ] || exit 1\n  case \"$digest\" in *[!0-9a-f]*) exit 1;; esac\n else\n  printf 'Unsupported or missing source: %s\\n' \"$p\" >&2\n  exit 1\n fi\n after=$(identity \"$p\") || exit 1\n [ \"$before\" = \"$after\" ] || { printf 'Source changed while hashing: %s\\n' \"$p\" >&2; exit 1; }\n printf '%s %s %s' \"$kind\" \"$(encode \"$before\")\" \"$digest\"\n)\nwalk() (\n p=$1\n key=$2\n excluded \"$p\" && exit 0\n is_mount \"$p\" && { printf 'Mount point cannot be moved: %s\\n' \"$p\" >&2; exit 1; }\n if [ -d \"$p\" ] && [ ! -L \"$p\" ]; then\n  for f in \"$p\"/* \"$p\"/.[!.]* \"$p\"/..?*; do\n   [ -e \"$f\" ] || [ -L \"$f\" ] || continue\n   walk \"$f\" \"$key/${f##*/}\" || exit 1\n  done\n fi\n details=$(probe \"$p\") || exit 1\n printf '%s %s %s\\n' \"$(encode \"$key\")\" \"$details\" \"$(encode \"$p\")\"\n)\n";
const MOVE_TARGET = "boot=$(cat /proc/sys/kernel/random/boot_id)\n[ -n \"$boot\" ] || exit 1\nprintf 'H %s %s %s\\n' \"$boot\" \"$(stat -c '%d:%i' .)\" \"$(encode \"$PWD\")\"\nread -r header rest\n[ \"$header\" = H ] || exit 1\nwhile read -r key kind meta digest original extra; do\n [ -z \"$extra\" ] && [ -n \"$original\" ] || exit 1\n decode \"$key\" || exit 1\n index=${decoded%%/*}\n suffix=${decoded#\"$index\"}\n n=0\n found=0\n for name do\n  if [ \"$n\" = \"$index\" ]; then p=./$name$suffix; found=1; break; fi\n  n=$((n + 1))\n done\n [ \"$found\" = 1 ] || exit 1\n details=$(probe \"$p\") || exit 1\n printf '%s %s %s\\n' \"$key\" \"$details\" \"$(encode \"$p\")\"\ndone\n";
const MOVE_DELETE = "check_entry() (\n key=$1\n kind=$2\n meta=$3\n digest=$4\n decode \"$5\" || exit 1\n p=$decoded\n if is_mount \"$p\"; then printf 'Mount point retained: %s\\n' \"$p\" >&2; exit 1; fi\n parent=${p%/*}\n name=${p##*/}\n expected_parent=$physical\n [ \"$parent\" = . ] || expected_parent=$physical/${parent#./}\n cd -P \"$parent\" || exit 1\n [ \"$PWD\" = \"$expected_parent\" ] || exit 1\n physical=$PWD\n if [ \"$kind\" != d ] || ! keep_directory \"$p\"; then\n  [ -w . ] && [ -x . ] || { printf 'Source parent is not writable: %s\\n' \"$p\" >&2; exit 1; }\n fi\n actual=$(probe \"./$name\") || exit 1\n [ \"$actual\" = \"$kind $meta $digest\" ] || { printf 'Source changed; retained: %s\\n' \"$p\" >&2; exit 1; }\n)\ndelete_entry() (\n key=$1\n kind=$2\n meta=$3\n digest=$4\n encoded=$5\n decode \"$encoded\" || exit 1\n p=$decoded\n parent=${p%/*}\n name=${p##*/}\n if [ \"$kind\" = d ] && keep_directory \"$p\"; then\n  printf 'K %s %s\\n' \"$key\" \"$encoded\"\n  exit 0\n fi\n expected_parent=$physical\n [ \"$parent\" = . ] || expected_parent=$physical/${parent#./}\n cd -P \"$parent\" || exit 1\n [ \"$PWD\" = \"$expected_parent\" ] || exit 1\n physical=$PWD\n if [ \"$kind\" = d ]; then\n  [ -d \"./$name\" ] && [ ! -L \"./$name\" ] || exit 1\n  decode \"$meta\" || exit 1\n  device=${decoded%%:*}\n  rest=${decoded#*:}\n  inode=${rest%%:*}\n  [ \"$(stat -c '%d:%i' \"./$name\")\" = \"$device:$inode\" ] || exit 1\n  rmdir \"./$name\" || { printf 'Directory retained: %s\\n' \"$p\" >&2; exit 1; }\n else\n  actual=$(probe \"./$name\") || exit 1\n  actual_kind=${actual%% *}\n  rest=${actual#* }\n  actual_meta=${rest%% *}\n  actual_digest=${rest#* }\n  decode \"$meta\" || exit 1\n  expected_stable=${decoded%%|*}\n  decode \"$actual_meta\" || exit 1\n  [ \"$actual_kind\" = \"$kind\" ] && [ \"$actual_digest\" = \"$digest\" ] && [ \"${decoded%%|*}\" = \"$expected_stable\" ] || { printf 'Source changed; retained: %s\\n' \"$p\" >&2; exit 1; }\n  rm \"./$name\" || exit 1\n fi\n printf 'D %s %s\\n' \"$key\" \"$encoded\"\n)\nreport_roots() {\n n=0\n for p do\n  if [ -e \"./$p\" ] || [ -L \"./$p\" ]; then result=retained; else result=deleted; fi\n  printf 'R %s %s\\n' \"$n\" \"$result\"\n  n=$((n + 1))\n done\n}\nexpected=$(cat) || exit 1\n[ -n \"$expected\" ] || exit 1\nprintf '%s\\n' \"$expected\" | while read -r key kind meta digest path extra; do\n [ -z \"$extra\" ] && [ -n \"$path\" ] || exit 1\n check_entry \"$key\" \"$kind\" \"$meta\" \"$digest\" \"$path\" || exit 1\ndone || { printf 'RETAINED\\n'; printf 'Batch changed before deletion; source retained\\n' >&2; exit 1; }\nprintf 'BEGIN\\n'\nrc=0\nprintf '%s\\n' \"$expected\" | while read -r key kind meta digest path; do\n delete_entry \"$key\" \"$kind\" \"$meta\" \"$digest\" \"$path\" || exit 1\ndone || rc=1\nreport_roots \"$@\"\nexit \"$rc\"\n";
const MOVE_VERIFY = "const fs = require('fs');\nconst dir = ARGV[0];\nfunction read(name) {\n let st = fs.stat(dir + '/' + name);\n if (!st || st.size > 4194304) die('Verification manifest is missing or too large; source retained');\n let text = fs.readfile(dir + '/' + name);\n let lines = split(trim(text ?? ''), '\\n');\n let header = split(shift(lines), ' ');\n if (length(header) != 4 || header[0] != 'H') die('Invalid verification manifest; source retained');\n let entries = {};\n for (let line in lines) {\n  let fields = split(line, ' ');\n  if (length(fields) != 5 || !match(fields[0], /^([0-9a-f]{2})+$/) || !match(fields[2], /^([0-9a-f]{2})+$/) || !match(fields[4], /^([0-9a-f]{2})+$/) || !match(fields[1], /^[dfl]$/) || entries[fields[0]]) die('Invalid verification entry; source retained');\n  let path = hexdec(fields[4]);\n  if (substr(path, 0, 2) != './' || index(path, '\\x00') >= 0) die('Invalid verification path; source retained');\n  for (let part in split(substr(path, 2), '/')) if (!length(part) || part == '.' || part == '..') die('Invalid verification path; source retained');\n  entries[fields[0]] = fields;\n }\n return { header, entries, lines };\n}\nlet before = read('source.before');\nif (ARGV[1] == 'prepare') {\n if (!length(keys(before.entries))) die('No selected source entries');\n exit(0);\n}\nlet after = read('source.after'), target = read('target.after');\nif (join(' ', before.header) != join(' ', after.header) || length(keys(before.entries)) != length(keys(after.entries))) die('Source changed; entire batch retained');\nfor (let key, entry in before.entries) {\n let current = after.entries[key], copied = target.entries[key];\n if (!current || join(' ', current) != join(' ', entry)) die('Source changed; entire batch retained: ' + hexdec(entry[4]));\n if (!copied || copied[1] != entry[1] || (entry[1] != 'd' && copied[3] != entry[3])) die('SHA256 or structure verification failed; entire batch retained: ' + hexdec(entry[4]));\n if (before.header[1] == target.header[1]) {\n  let source_id = split(hexdec(entry[2]), ':'), target_id = split(hexdec(copied[2]), ':');\n  if (source_id[0] == target_id[0] && source_id[1] == target_id[1]) die('Source and destination refer to the same object; source retained');\n }\n}\nif (!fs.writefile(dir + '/delete.list', join('\\n', before.lines) + '\\n')) die('Cannot prepare verified deletion; source retained');\nprint('Entire batch SHA256, structure and source stability checks passed\\n');\n";
function move_commands(q, excluded, dir) {
	let source_names = join(' ', map(q.items, (item) => quote(item.name)));
	let target_names = join(' ', map(q.items, (item) => quote(item.target_name)));
	let source_boot = trim(run(q.source, 'cat /proc/sys/kernel/random/boot_id'));
	let target_boot = trim(run(q.target, 'cat /proc/sys/kernel/random/boot_id'));
	if (!match(source_boot, /^[a-f0-9-]{36}$/) || !match(target_boot, /^[a-f0-9-]{36}$/)) error('Cannot identify transfer endpoints safely');
	if (source_boot == target_boot) {
		let source_ids = split(trim(run(q.source, 'cd ' + quote(q.physical_source) + ' && stat -c ' + quote('%d:%i') + ' ' + join(' ', map(q.items, (item) => quote('./' + item.name))))), '\n');
		let script = 'set -e\ncd -P "$1"\nshift\nfor p do [ ! -e "./$p" ] && [ ! -L "./$p" ] || stat -c "%d:%i" "./$p"; done\nwhile :; do stat -c "%d:%i" .; [ "$PWD" != / ] || break; cd -P ..; done';
		let target_ids = split(trim(run(q.target, 'sh -c ' + quote(script) + ' sh ' + quote(q.physical_target) + ' ' + target_names)), '\n');
		for (let id in source_ids) if (index(target_ids, id) >= 0) error('Source and destination overlap; move refused');
	}
	let excludes = 'excluded() {\n';
	for (let path in excluded) {
		let rel = './' + substr(path, length(q.parent) + (q.parent == '/' ? 0 : 1));
		excludes += 'case "$1" in ' + quote(rel) + '|' + quote(rel) + '/*) return 0;; esac\n';
	}
	excludes += 'return 1\n}\n';
	let keep = 'keep_directory() {\n';
	for (let path in excluded) {
		let parent = H.parent_path(path);
		while (parent != q.parent && H.is_descendant(q.parent, parent)) {
			keep += '[ "$1" != ' + quote('./' + substr(parent, length(q.parent) + (q.parent == '/' ? 0 : 1))) + ' ] || return 0\n';
			parent = H.parent_path(parent);
		}
	}
	keep += 'return 1\n}\n';
	let source = STAT_SUPPORT + PATH_CODEC + excludes + MOVE_SCAN;
	let target = STAT_SUPPORT + PATH_CODEC + 'excluded() { return 1; }\n' + MOVE_COMMON + MOVE_TARGET;
	let remove = STAT_SUPPORT + PATH_CODEC + excludes + keep + MOVE_COMMON + MOVE_DELETE;
	if (!fs.writefile(dir + '/verify.uc', MOVE_VERIFY)) error('Cannot prepare verification');
	return {
		source: ssh_command(q.source, dir + '/source', 'sh -c ' + quote(source) + ' sh ' + quote(q.parent) + ' ' + quote(q.physical_source) + ' ' + source_names, false),
		target: ssh_command(q.target, dir + '/target', 'sh -c ' + quote(target) + ' sh ' + quote(q.dest) + ' ' + quote(q.physical_target) + ' ' + target_names, false),
		remove: ssh_command(q.source, dir + '/source', 'sh -c ' + quote(remove) + ' sh ' + quote(q.parent) + ' ' + quote(q.physical_source) + ' ' + source_names, false)
	};
}
function process_state(pid) {
	let raw = fs.readfile('/proc/' + pid + '/stat');
	if (!raw) return null;
	let fields = split(trim(substr(raw, rindex(raw, ')') + 1)), /\s+/);
	return { state: fields[0], start: fields[19] };
}
function launch_task(dir, script, task) {
	if (!fs.writefile(dir + '/worker', script)) { cleanup(dir + '/source'); cleanup(dir + '/target'); error('Cannot create transfer task'); }
	fs.chmod(dir + '/worker', 0o700);
	save_json(dir + '/state', task);
	let proc = fs.popen('sh ' + quote(dir + '/worker') + ' >' + quote(dir + '/log') + ' 2>&1 </dev/null & echo $!', 'r');
	task.pid = proc ? +trim(proc.read('all') ?? '') : 0;
	if (proc) proc.close();
	if (!task.pid) { cleanup(dir + '/source'); cleanup(dir + '/target'); error('Cannot start transfer'); }
	task.process_start = process_state(task.pid)?.start;
	save_json(dir + '/state', task);
	return task;
}
function transfer_pipeline(source, target, meter_output) {
	return '{ ' + source + '; echo $? > source.rc; } | { pv -f -n -b -t -i 1 ' + meter_output + '; echo $? > meter.rc; } | { ' + target + '; echo $? > target.rc; }\nfor f in source.rc meter.rc target.rc; do [ "$(cat "$f" 2>/dev/null)" = 0 ] || exit 1; done\n';
}
function start(p) {
	if (!H.command_exists('pv')) error('pv is not installed');
	let q = plan(p);
	let action = p.conflict_action ?? 'error';
	if (action != 'overwrite' && action != 'error' && action != 'rename' && action != 'skip') error('Invalid conflict action');
	if (length(q.conflicts) && action == 'error') error('Target already exists');
	let excluded = p.exclude_paths ? map(array_value(p.exclude_paths), path_value) : [];
	for (let path in excluded) {
		let inside = false;
		for (let item in q.items) if (H.is_descendant(item.path, path)) inside = true;
		if (!inside) error('Invalid excluded path');
	}
	if (action == 'skip') q.items = filter(q.items, (item) => !length(filter(q.conflicts, (c) => c.path == item.path)));
	if (!length(q.items)) return { operation: p.operation ?? 'copy', source_results: [], done: true, success: true, bytes: 0, elapsed: 0 };
	if (same_device(q.source, q.target) && q.physical_source == q.physical_target)
		for (let item in q.items) if (item.name == item.target_name) error('Cannot transfer a directory into itself');
	let dir = workspace(), id = fs.basename(dir), stage_name = '.harbor-transfer-' + id;
	let selection = join(' ', map(q.items, (item) => quote('./' + item.name)));
	let relative_excludes = map(excluded, (path) => './' + substr(path, length(q.parent) + (q.parent == '/' ? 0 : 1)));
	let metadata = STAT_SUPPORT + PATH_CODEC + 'for d do\n stamp=$(stat -c "%Y %a" "$d") || exit 1\n encoded=$(encode "$d") || exit 1\n printf "%s %s\\n" "$stamp" "$encoded"\ndone';
	let prune = ' -name ' + quote(stage_name) + ' -o -name ' + quote(id);
	for (let path in relative_excludes) prune += ' -o -path ' + quote(exclude_pattern(path));
	let patterns = [ stage_name, id ];
	for (let path in relative_excludes) push(patterns, exclude_pattern(path));
	let line_exclusion = length(filter(relative_excludes, (path) => index(path, '\n') >= 0)) > 0;
	let create = 'tar -cf -';
	let preflight = '';
	if (line_exclusion) {
		preflight = 'tar --exclude=harbor-capability-check -cf /dev/null -C /proc version 2>/dev/null || { printf "%s\\n" ' + quote(H.tr('This tar cannot safely exclude paths containing line breaks; change the selection or use tar with long-option support')) + ' >&2; exit 1; }\n';
		for (let pattern in patterns) create += ' --exclude=' + quote(pattern);
		create += ' ' + selection;
	}
	else {
		let delimiter = 'HF_EXCLUDE_' + id;
		create += ' -X /proc/self/fd/3 ' + selection + ' 3<<' + quote(delimiter) + '\n' + join('\n', patterns) + '\n' + delimiter;
	}
	let source_script = 'set -e\n' + STAT_SUPPORT + preflight + 'cd ' + quote(q.parent) + '\nprintf "HFREMOTE2\\n"\nfind ' + selection + ' \\( ' + prune + ' \\) -prune -o \\( ! -type d ! -type f ! -type l \\) -exec sh -c ' + quote('echo "Unsupported file type" >&2; exit 1') + ' sh {} + -o -type d -exec sh -c ' + quote(metadata) + ' sh {} +\nprintf "END\\n"\n' + create;

	let target_script = "set -e\n" + STAT_SUPPORT + PATH_CODEC + "umask 077\ncd -P " + quote(q.dest) + "\n[ \"$PWD\" = " + quote(q.physical_target) + " ] || exit 1\nstage=" + quote("./" + stage_name) + "\nmkdir -m 700 \"$stage\"\nunlock_directories() (\n chmod u+rwx \"$1\" || exit 1\n for f in \"$1\"/* \"$1\"/.[!.]* \"$1\"/..?*; do\n  if [ -d \"$f\" ] && [ ! -L \"$f\" ]; then unlock_directories \"$f\" || exit 1; fi\n done\n)\ntrap 'unlock_directories \"$stage\"; rm -rf \"$stage\"' EXIT HUP INT TERM\nIFS= read -r marker\n[ \"$marker\" = HFREMOTE2 ] || exit 1\nmeta=\"$stage/metadata\"\nmkdir -m 700 \"$stage/data\" \"$stage/modes\"\n: >\"$meta\"\nwhile IFS= read -r line; do\n [ \"$line\" != END ] || break\n printf \"%s\\n\" \"$line\" >>\"$meta\"\ndone\n[ \"$line\" = END ] || exit 1\nwhile read -r stamp mode encoded; do\n case \"$stamp\" in \"\"|*[!0-9-]*) exit 1;; esac\n case \"$mode\" in \"\"|*[!0-7]*) exit 1;; esac\n [ \"${#mode}\" -le 4 ] || exit 1\n decode \"$encoded\" || exit 1\n path=$decoded\n case \"$path\" in ./*) ;; *) exit 1;; esac\n case \"/${path#./}/\" in *\"/../\"*|*\"/./\"*) exit 1;; esac\n mkdir -p \"$stage/data/$path\"\n key=$(printf %s \"$path\" | sha256sum)\n key=${key%% *}\n printf \"%s %s\\n\" \"$stamp\" \"$mode\" >\"$stage/modes/$key\"\ndone <\"$meta\"\numask 000\ntar -xf - -o -C \"$stage/data\"\numask 077\nunlock_directories \"$stage/data\"\npreserve=" + (p.preserve_permissions == "0" ? "0" : "1") + "\n" + MERGE_SCRIPT;
	for (let item in q.items) {
		let target_path = './' + item.target_name;
		if (action != 'overwrite') target_script += '[ ! -e ' + quote(target_path) + ' ] && [ ! -L ' + quote(target_path) + ' ] || { echo "Target already exists" >&2; exit 1; }\n';
		target_script += 'merge "$stage/data"/' + quote(item.name) + ' ' + quote(target_path) + '\n';
	}
	if (length(source_script) + length(target_script) > 60000) error('Too many selected paths; transfer them in smaller batches');
	private_dir(dir + '/source'); private_dir(dir + '/target');
	let transfer;
	if (q.direct) {
		let work = '/tmp/harbor_file_pro/transfer-' + id;
		let direct_script = 'set -e\numask 077\nroot=/tmp/harbor_file_pro\n[ ! -L "$root" ] || exit 1\nif [ -e "$root" ]; then [ -d "$root" ] && [ -O "$root" ] || exit 1; else mkdir -m 700 "$root"; fi\nwork=' + quote(work) + '\nmkdir -m 700 "$work"\ntrap \'rm -rf "$work"\' EXIT HUP INT TERM\ncd "$work"\nset +e\n' + transfer_pipeline('sh -c ' + quote(source_script), 'sh -c ' + quote(target_script), '2>&3');
		transfer = ssh_command(q.source, dir + '/source', 'exec 3>&1\n' + direct_script, false) + ' >progress || finish 1\n';
	}
	else {
		let source_command = ssh_command(q.source, dir + '/source', source_script, false);
		let target_command = ssh_command(q.target, dir + '/target', target_script, false);
		transfer = '(\n' + transfer_pipeline(source_command, target_command, '2>progress') + ') || finish 1\n';
	}
	let move = null;
	try { if (p.operation == 'move') move = move_commands(q, excluded, dir); }
	catch (e) { cleanup(dir + '/source'); cleanup(dir + '/target'); die(e); }
	let script = 'umask 077\ncd ' + quote(dir) + '\ntrap \'rm -f source/password target/password\' EXIT HUP INT TERM\n' +
		'finish() { printf "%s\\n" "$1" > result.tmp; mv result.tmp result; exit "$1"; }\n';
	if (move) script += 'trap \'rm -f source/password target/password source.before source.after target.after delete.list verify.uc\' EXIT HUP INT TERM\necho hashing > phase\n(ulimit -f 8192 && ' + move.source + ' > source.before) || finish 1\nucode verify.uc ' + quote(dir) + ' prepare || finish 1\n';
	script += 'echo copying > phase\n' + transfer;
	if (move) script += 'echo verifying > phase\n(ulimit -f 8192 && ' + move.source + ' > source.after) || finish 1\n(ulimit -f 8192 && ' + move.target + ' < source.before > target.after) || finish 1\nucode verify.uc ' + quote(dir) + ' || finish 1\necho deleting > phase\n' + move.remove + ' < delete.list > delete.log || finish 1\n';
	script += 'echo complete > phase\nfinish 0\n';
	return launch_task(dir, script, { task_id: id, transport: q.direct ? 'remote-local' : 'relay', path_encoding: 'hex', operation: move ? 'move' : 'copy', source_items: move ? map(q.items, (item) => ({ path: item.path, name: item.name })) : null, started: time(), source_device: p.source_device ?? '', target_device: p.target_device ?? '', target_dir: q.dest, done: false });
}
const REMOTE_STAT_INSTALL = "set -e\n" + STAT_DETECT + "[ \"$stat_kind\" = missing ] || { echo 'stat is already available'; exit 0; }\n[ \"$(id -u)\" = 0 ] || { echo 'Remote installation requires a root SSH account' >&2; exit 1; }\nroot=/tmp/harbor_file_pro\n[ ! -L \"$root\" ] || exit 1\nif [ -e \"$root\" ]; then [ -d \"$root\" ] && [ -O \"$root\" ] || exit 1; else mkdir -m 700 \"$root\"; fi\nchmod 700 \"$root\"\nlock=\"$root/stat-install.lock\"\nmkdir -m 700 \"$lock\" || { echo 'Another stat installation is running; check the remote device' >&2; exit 1; }\ntrap 'rmdir \"$lock\"' EXIT HUP INT TERM\nif command -v apk >/dev/null 2>&1; then\n apk update\n apk add coreutils-stat\nelif command -v opkg >/dev/null 2>&1; then\n opkg update\n opkg install coreutils-stat\nelse\n echo 'Remote device has neither opkg nor apk' >&2\n exit 1\nfi\n" + STAT_SUPPORT + "stat -c '%s %Y %a' / >/dev/null\necho 'stat is available'\n";

function tool_info(d) {
	let script = STAT_DETECT + 'printf "%s\\n" "$stat_kind"\nif command -v apk >/dev/null 2>&1; then echo apk; elif command -v opkg >/dev/null 2>&1; then echo opkg; else echo none; fi\nid -u';
	let lines = split(trim(run(d, 'sh -c ' + quote(script))), '\n');
	if (length(lines) != 3 || !match(lines[0], /^(command|busybox|missing)$/) || !match(lines[1], /^(apk|opkg|none)$/) || !match(lines[2], /^[0-9]+$/)) error('Invalid remote tool response');
	return { stat: lines[0] != 'missing', stat_provider: lines[0], installer: lines[1], can_install: lines[1] != 'none' && lines[2] == '0', root: lines[2] == '0', device_revision: d?.revision ?? '' };
}
function install_stat(p) {
	if (type(p.device_revision) != 'string') error('Device settings changed; reopen the device');
	let d = checked_device(p.device_id, p.device_revision);
	if (!d) error('Device not found');
	let info = tool_info(d);
	if (info.stat) return { done: true, success: true, package_name: 'coreutils-stat', message: H.tr('stat is already available') };
	if (!info.root) error('Remote installation requires a root SSH account');
	if (info.installer == 'none') error('Remote device has neither opkg nor apk');
	let dir = workspace(), id = fs.basename(dir);
	private_dir(dir + '/target');
	let remote_script = REMOTE_STAT_INSTALL;
	let command;
	try { command = ssh_command(d, dir + '/target', remote_script, false); }
	catch (e) { cleanup(dir + '/target'); die(e); }
	let script = 'umask 077\ncd ' + quote(dir) + '\ntrap \'rm -f target/password\' EXIT HUP INT TERM\ntimeout 900 sh -c ' + quote(command) + '\nrc=$?\nprintf "%s\\n" "$rc" > result.tmp\nmv result.tmp result\nexit "$rc"\n';
	return launch_task(dir, script, { task_id: id, kind: 'install', started: time(), done: false, device_id: d.id, device_revision: d.revision, package_name: 'coreutils-stat', package_type: info.installer == 'apk' ? 'apk' : 'ipk', installer: info.installer, path: d.name + ' (' + d.host + ':' + d.port + ')' });
}

function tail(path, limit) {
	let f = fs.open(path, 'r');
	if (!f) return '';
	let st = fs.stat(path);
	if (st.size > limit) f.seek(-limit, 2);
	let text = f.read('all') ?? ''; f.close();
	return text;
}
const AGENT_CONTEXT = "const fs = require('fs');\nlet context = { request: null };\nlet handler;\nlet consumed = false;\ncontext.http = {\n formvalue: function(key) {\n  if (key == '__harbor_parse__' && handler && !consumed) {\n   consumed = true;\n   let remaining = +(context.request.env.CONTENT_LENGTH ?? 0);\n   while (remaining > 0) {\n    let chunk = fs.stdin.read(min(65536, remaining));\n    if (!length(chunk)) die('Incomplete upload');\n    remaining -= length(chunk);\n    handler({ name: 'content', file: context.request.params.filename ?? 'content.bin' }, chunk, false);\n   }\n   handler({ name: 'content', file: context.request.params.filename ?? 'content.bin' }, '', true);\n  }\n  return context.request.params[key];\n },\n getenv: function(key) { return context.request.env[key]; },\n setfilehandler: function(fn) { handler = fn; },\n status: function() {},\n prepare_content: function() {},\n write_json: function(value) { print(sprintf('%J', value)); }\n};\nreturn context;\n";
const AGENT_TOOLS = "command -v ucode >/dev/null 2>&1 && ucode -e 'require(\"fs\"); require(\"uci\"); print(hexdec(\"6f6b\"));' 2>/dev/null";
const AGENT_APIS = [ 'list', 'detect_type', 'read_text', 'save_text', 'save_editor_upload', 'create_directory', 'create_file', 'rename', 'delete', 'batch_delete', 'chmod', 'upload_check', 'upload', 'archive_create_start', 'archive_extract_start', 'archive_status', 'thumbnail_generate_start', 'thumbnail_generate_status', 'package_install_start', 'package_install_status', 'tool_install_start', 'terminal_info' ];
const AGENT_MODES = [ 'download', 'inline', 'slice', 'patch', 'splice', 'search', 'replace_all', 'stage_commit', 'stage_discard', 'replace_progress', 'sha256', 'thumbnail' ];
function agent_device(p) {
 if (type(p.device_revision) != 'string' || !length(p.device_id ?? '')) error('Device settings changed; reopen the device');
 return checked_device(p.device_id, p.device_revision);
}
function agent_root() { return '/tmp/harbor_file_pro/file-agent'; }
function agent_setup_script() {
 return 'set -e\numask 077\nfor dir in /tmp/harbor_file_pro ' + quote(agent_root()) + '; do\n [ ! -L "$dir" ] || exit 1\n if [ -e "$dir" ]; then [ -d "$dir" ] && [ -O "$dir" ] || exit 1; else mkdir -m 700 "$dir"; fi\n chmod 700 "$dir"\ndone\n';
}
function authorize_remote(http, action, p) {
 let sid = http.formvalue('sessionid');
 if (!match(sid ?? '', /^[a-fA-F0-9]{32}$/) || sid == '00000000000000000000000000000000') error('Remote file access denied');
 let writing = index(['get', 'save', 'delete', 'trust', 'start', 'install_stat', 'agent_install'], action) >= 0 || (action == 'rpc' && index(['list', 'detect_type', 'read_text', 'archive_status', 'thumbnail_generate_status', 'package_install_status', 'terminal_info'], p.rpc_action) < 0);
 let bus = require('ubus').connect(), result;
 try { result = bus && bus.call('session', 'access', { ubus_rpc_session: sid, scope: 'ubus', object: 'harbor.file', function: writing ? 'write' : 'read' }); } catch (e) {}
 if (result?.access !== true) error('Remote file access denied');
}
function agent_info(p) {
 let d = agent_device(p);
 let available = trim(run(d, AGENT_TOOLS + ' || true')) == 'ok';
 return { ready: available, device_revision: d.revision, packages: [ 'ucode', 'ucode-mod-fs', 'ucode-mod-uci' ] };
}
function agent_install(p) {
 let d = agent_device(p), info = tool_info(d);
 if (!info.root) error('Remote installation requires a root SSH account');
 if (!info.can_install) error('Remote device has neither opkg nor apk');
 let dir = workspace(), id = fs.basename(dir);
 private_dir(dir + '/target');
 let script = agent_setup_script() + '[ "$(id -u)" = 0 ] || exit 1\nlock=' + quote('/tmp/harbor_file_pro/stat-install.lock') + '\nmkdir "$lock" || exit 1\ntrap \'rmdir "$lock"\' EXIT HUP INT TERM\n';
 script += info.installer == 'apk' ? 'apk update\napk add ucode ucode-mod-fs ucode-mod-uci\n' : 'opkg update\nopkg install ucode ucode-mod-fs ucode-mod-uci\n';
 script += AGENT_TOOLS + '\n';
 let command = ssh_command(d, dir + '/target', script, false);
 return launch_task(dir, 'umask 077\ncd ' + quote(dir) + '\ntrap \'rm -f target/password\' EXIT HUP INT TERM\ntimeout 900 sh -c ' + quote(command) + '\nrc=$?\nprintf "%s\\n" "$rc" > result.tmp\nmv result.tmp result\nexit "$rc"\n', { task_id: id, kind: 'install', started: time(), done: false, device_id: d.id, device_revision: d.revision, package_name: 'ucode ucode-mod-fs ucode-mod-uci', package_type: info.installer == 'apk' ? 'apk' : 'ipk', installer: info.installer, path: d.name + ' (' + d.host + ':' + d.port + ')' });
}
function agent_prepare(p) {
 let d = agent_device(p);
 let api = H.api_source ? H.api_source() : null;
 let io = require('harborpro.io').agent_source();
 if (!length(api) || !length(io) || index(api, 'function read_preferences() {') < 0 || index(io, 'function agent(') < 0) error('Cannot read remote file helper sources');
 api = replace(api, "'use strict';", "'use strict';\nconst agent_context = require('agent_context');\nconst http = agent_context.http;", 1);
 api = replace(api, 'function read_preferences() {', 'function read_preferences() {\n return { ...PREFERENCE_DEFAULTS, ...agent_context.request.preferences };\n', 1);
 api = replace(api, "const RUNTIME_DIR = '/tmp/harbor_file_pro';", "const RUNTIME_DIR = '" + agent_root() + "/runtime';", 1);
 io = replace(io, "const RUNTIME_DIR = '/tmp/harbor_file_pro';", "const RUNTIME_DIR = '" + agent_root() + "/runtime';", 1);
 let codes = { 'agent_api.uc': api, 'agent_io.uc': io, 'agent_context.uc': AGENT_CONTEXT };
 let dir = workspace(), hash;
 let combined = join('\n', map(keys(codes), (key) => codes[key]));
 try {
  if (fs.writefile(dir + '/source', combined) != length(combined) || !fs.chmod(dir + '/source', 0o600)) error('Cannot prepare remote helper sources');
  hash = split(trim(shell('sha256sum < ' + quote(dir + '/source'), dir, 5)), ' ')[0];
  fs.unlink(dir + '/source');
  if (!match(hash, /^[a-f0-9]{64}$/)) error('Cannot identify remote helper');
  let path = agent_root() + '/' + hash;
  let probe = trim(run(d, STAT_DETECT + 'if [ "$stat_kind" = missing ]; then echo HF_STAT_MISSING; elif [ "$(' + AGENT_TOOLS + ')" != ok ]; then echo HF_AGENT_MISSING; else [ ! -L ' + quote(path) + ' ] && [ -O ' + quote(path + '/ready') + ' ] && cat ' + quote(path + '/ready') + ' || true; fi'));
  if (probe == 'HF_STAT_MISSING') error('coreutils-stat is required to open this device', { stat_missing: true, device_id: d.id, device_revision: d.revision });
  if (probe == 'HF_AGENT_MISSING') error('Remote file tools are missing', { agent_missing: true, device_id: d.id, device_revision: d.revision });
  if (probe != hash) {
   let stage = agent_root() + '/.' + token();
   let deploy = agent_setup_script() + 'stage=' + quote(stage) + '\nmkdir -m 700 "$stage"\ntrap \'rm -rf "$stage"\' EXIT HUP INT TERM\n';
   for (let name, code in codes) {
    let delimiter = 'HF_' + token();
    deploy += 'cat > "$stage"/' + quote(name) + ' <<\'' + delimiter + '\'\n' + code + '\n' + delimiter + '\n';
   }
   deploy += 'printf %s ' + quote(hash) + ' > "$stage/ready"\nif [ -e ' + quote(path) + ' ] || [ -L ' + quote(path) + ' ]; then [ ! -L ' + quote(path) + ' ] && [ -O ' + quote(path + '/ready') + ' ] && [ "$(cat ' + quote(path + '/ready') + ')" = ' + quote(hash) + ' ]; else mv "$stage" ' + quote(path) + '; fi\n';
   let pipe = fs.popen(ssh_command(d, dir, 'sh -s', false) + ' >' + quote(dir + '/deploy.log') + ' 2>&1', 'w');
   if (!pipe) error('Cannot start remote helper setup');
   let written = pipe.write(deploy), rc = pipe.close();
   if (written != length(deploy) || rc != 0) error(tail(dir + '/deploy.log', 4096) || 'Remote helper setup failed');
  }
  save_json(ROOT + '/agent-' + d.id, { revision: d.revision, path, hash });
 }
 catch (e) { fs.unlink(dir + '/source'); fs.unlink(dir + '/deploy.log'); remove_query(dir); die(e); }
 fs.unlink(dir + '/deploy.log'); remove_query(dir);
 return { ready: true, device_id: d.id, device_revision: d.revision, helper_hash: hash };
}
function agent_request(p, params, api, env) {
 let d = agent_device(p);
 trusted(d);
 let cached = read_json(ROOT + '/agent-' + d.id);
 if (!cached || cached.revision != d.revision || !match(cached.hash ?? '', /^[a-f0-9]{64}$/) || cached.path != agent_root() + '/' + cached.hash) error('Remote file helper is not ready; reopen the operation', { helper_missing: true });
 if (api && index(AGENT_APIS, api) < 0) error('Unsupported remote file action');
 if (!api && index(AGENT_MODES, params.mode ?? 'download') < 0) error('Unsupported remote file mode');
 let prefs = H.read_preferences();
 let request = { params, api, env, preferences: { allow_system_operations: prefs.allow_system_operations, show_hidden_files: prefs.show_hidden_files ?? 0, enable_thumbnails: prefs.enable_thumbnails ?? 0 } };
 delete request.params.device_id; delete request.params.device_revision; delete request.params.sessionid; delete request.params.remote_action;
 delete request.env.QUERY_STRING;
 if (api) {
  let query = [];
  for (let key, value in request.params) if (type(value) == 'string' || type(value) == 'int') push(query, key + '=' + replace('' + value, /[^A-Za-z0-9_.~-]/g, (c) => sprintf('%%%02X', ord(c))));
  request.env.QUERY_STRING = join('&', query);
 }
 let input = sprintf('%J', request) + '\n';
 if (length(input) > 4194304) error('Remote request is too large');
 let program = 'const req = json(require("fs").stdin.read("line")); req.preferences.home_dir = getenv("HOME") || "/tmp"; if (req.api) { require("agent_context").request = req; require("agent_api")["api_" + req.api](); } else require("agent_io").agent(req.params, req.env, req.preferences);';
 let missing = api ? 'printf %s ' + quote(sprintf('%J', { code: 1, message: 'Remote file helper is not ready; reopen the operation', data: { helper_missing: true } })) + '; exit 0;' : 'echo "Remote file helper is not ready; reopen the operation" >&2; exit 1;';
 let script = '[ ! -L ' + quote(cached.path) + ' ] && [ -O ' + quote(cached.path + '/ready') + ' ] && [ "$(cat ' + quote(cached.path + '/ready') + ')" = ' + quote(cached.hash) + ' ] || { ' + missing + ' }\nexec ucode -L ' + quote(cached.path) + ' -e ' + quote(program);
 return { device: d, script, input };
}
function agent_rpc(p) {
 let data;
 try { data = json(p.rpc_data ?? '{}'); } catch (e) { error('Invalid remote file request'); }
 if (type(data) != 'object' || index(AGENT_APIS, p.rpc_action) < 0 || p.rpc_action == 'upload' || p.rpc_action == 'save_editor_upload') error('Invalid remote file request');
 if (p.rpc_action == 'tool_install_start' && index([ 'bsdtar', 'tar', 'gzip', 'gunzip', 'bzip2', 'xz', 'ffmpeg', 'convert', 'gm', 'ttyd' ], data.tool) < 0) error('Unsupported remote tool');
 if (p.rpc_action == 'tool_install_start' || p.rpc_action == 'package_install_start') {
  let info = tool_info(agent_device(p));
  if (!info.root) error('Remote installation requires a root SSH account');
  if (!info.can_install) error('Remote device has neither opkg nor apk');
 }
 let job;
 try { job = agent_request(p, data, p.rpc_action, { REQUEST_METHOD: 'POST', CONTENT_LENGTH: '0' }); }
 catch (e) {
  let detail;
  try { detail = json('' + e); } catch (ignored) {}
  if (detail?.data?.helper_missing) return { code: 1, message: detail.message, data: detail.data };
  die(e);
 }
 let dir = workspace(), raw, response;
 try {
  if (fs.writefile(dir + '/request', job.input) != length(job.input) || !fs.chmod(dir + '/request', 0o600)) error('Cannot prepare remote request');
  raw = shell(ssh_command(job.device, dir, job.script, false) + ' < ' + quote(dir + '/request'), dir, 120);
 } catch (e) { fs.unlink(dir + '/request'); remove_query(dir); die(e); }
 fs.unlink(dir + '/request'); remove_query(dir);
 try { response = json(raw); } catch (e) { error('Invalid remote file response'); }
 if (type(response) != 'object' || type(response.code) != 'int') error('Invalid remote file response');
 return response;
}
function stream_remote(params, env, helpers) {
 H = helpers;
 let api = params.mode == 'api_upload' ? params.rpc_action : null;
 if (api && api != 'upload' && api != 'save_editor_upload') error('Invalid remote upload');
 let job = agent_request(params, { ...params }, api, env), dir = workspace();
 let pipe;
 try {
  if (fs.writefile(dir + '/request', job.input) != length(job.input) || !fs.chmod(dir + '/request', 0o600)) error('Cannot prepare remote request');
  pipe = fs.popen('{ cat ' + quote(dir + '/request') + '; cat; } | sh -c ' + quote(ssh_command(job.device, dir, job.script, false)) + ' 2>' + quote(dir + '/error'), 'r');
  if (!pipe) error('Cannot start remote file request');
  if (api) {
   let raw = pipe.read(1048576), rc = pipe.close(); pipe = null;
   if (rc != 0) error(tail(dir + '/error', 4096) || 'Remote upload failed');
   let response = json(raw);
   if (H.headers_started) H.headers_started();
   print('Status: 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n', sprintf('%J', response));
  }
  else {
   let header = '', end = -1, separator = 4, chunk;
   while (length(header) < 16384) {
    chunk = pipe.read(1024);
    if (!length(chunk)) error(tail(dir + '/error', 4096) || 'Remote file request failed');
    header += chunk;
    end = index(header, '\r\n\r\n');
    if (end < 0) { end = index(header, '\n\n'); separator = 2; }
    else separator = 4;
    if (end >= 0) break;
   }
   if (end < 0 || end > 16384) error('Invalid remote file headers');
   let lines = split(substr(header, 0, end), /\r?\n/), response = lines[0] + '\r\n', seen = {};
   if (!match(lines[0], /^Status: [1-5][0-9]{2} [^[:cntrl:]]+$/)) error('Invalid remote file headers');
   for (let i = 1; i < length(lines); i++) {
    let field = match(lines[i], /^([A-Za-z0-9-]+):[ \t]*(.*)$/);
    if (!field || match(field[2], /[[:cntrl:]]/)) error('Invalid remote file headers');
    let key = lc(field[1]);
    if (index(['content-type', 'content-length', 'content-range', 'content-disposition', 'accept-ranges', 'cache-control', 'etag', 'last-modified', 'x-content-type-options', 'x-harbor-total', 'x-harbor-offset'], key) < 0) continue;
    if (seen[key] || key == 'content-length' && !match(field[2], /^[0-9]+$/)) error('Invalid remote file headers');
    seen[key] = true; response += field[1] + ': ' + field[2] + '\r\n';
   }
   if (H.headers_started) H.headers_started();
   print(response, '\r\n', substr(header, end + separator));
   while (length(chunk = pipe.read(65536) ?? '')) print(chunk);
   pipe.close(); pipe = null;
  }
 }
 catch (e) { if (pipe) pipe.close(); fs.unlink(dir + '/request'); remove_query(dir); die(e); }
 fs.unlink(dir + '/request'); remove_query(dir);
}

function status(id) {
	if (!match(id ?? '', /^[a-f0-9]{32}$/)) error('Invalid task ID');
	let dir = ROOT + '/' + id, task = read_json(dir + '/state');
	if (!task) return { task_id: id, done: true, success: false, message: 'Task no longer exists' };
	let rc = fs.readfile(dir + '/result');
	let process = process_state(task.pid);
	task.done = rc != null || !process || process.state == 'Z' || process.state == 'X' || process.start != task.process_start;
	task.success = task.done && trim(rc ?? '') == '0';
	task.elapsed = time() - task.started;
	if (task.done) task.exit_code = rc != null && match(trim(rc), /^[0-9]+$/) ? +trim(rc) : null;
	task.bytes = 0;
	let lines = split(trim(tail(dir + '/progress', 4096)), '\n');
	let last = split(trim(lines[length(lines) - 1] ?? ''), /\s+/);
	if (length(last) == 2 && match(last[1], /^[0-9]+$/)) task.bytes = +last[1];
	task.log = tail(dir + '/log', 4096);
	task.phase = trim(fs.readfile(dir + '/phase') ?? '');
	if (task.operation == 'move') {
		task.deleted_count = 0;
		let shown = 0;
		let decode_path = task.path_encoding == 'hex' ? hexdec : b64dec;
		task.source_results = map(task.source_items ?? [], (item) => ({ path: item.path, deleted_count: 0, deleted_paths: [], state: task.phase == 'deleting' || task.phase == 'complete' ? 'unknown' : 'retained' }));
		for (let line in split(fs.readfile(dir + '/delete.log') ?? '', '\n')) {
			let fields = split(line, ' ');
			if (fields[0] == 'RETAINED') for (let result in task.source_results) result.state = 'retained';
			if (length(fields) == 3 && fields[0] == 'D') {
				task.deleted_count++;
				let key = split(decode_path(fields[1]) ?? '', '/')[0];
				if (match(key, /^[0-9]+$/) && task.source_results[+key]) {
					let result = task.source_results[+key];
					result.deleted_count++;
					if (shown++ < 200) push(result.deleted_paths, H.join_path(H.parent_path(result.path), substr(decode_path(fields[2]), 2)));
					else result.more_deleted_paths = true;
				}
			}
			if (length(fields) == 3 && fields[0] == 'R' && match(fields[1], /^[0-9]+$/) && task.source_results[+fields[1]] && (fields[2] == 'deleted' || fields[2] == 'retained')) task.source_results[+fields[1]].state = fields[2];
		}
		for (let result in task.source_results) if (result.state == 'retained' && result.deleted_count) result.state = 'partial';
	}
	if (task.operation == 'move' && task.success && length(filter(task.source_results, (r) => r.state == 'unknown'))) { task.success = false; task.log += '\nSource deletion status could not be confirmed'; }
	if (task.done) {
		cleanup(dir + '/source'); cleanup(dir + '/target');
		if (!task.success) task.message = length(task.log) ? task.log : task.kind == 'install' ? 'Installation failed; check the remote device before retrying' : 'Transfer failed; some files may have been copied';
	}
	return task;
}
function prune_runtime() {
	for (let name in (fs.lsdir(ROOT) ?? [])) {
		let path = ROOT + '/' + name;
		if (match(name, /^trust-[a-f0-9]{32}$/)) {
			let challenge = read_json(path);
			if (!challenge || challenge.expires < time()) fs.unlink(path);
		}
		else if (match(name, /^[a-f0-9]{32}$/)) {
			let st = fs.lstat(path);
			if (!st || st.type != 'directory' || time() - st.mtime < 86400) continue;
			let task = read_json(path + '/state'), process = task ? process_state(task.pid) : null;
			if (!process || process.state == 'Z' || process.start != task?.process_start) H.remove_recursive(path);
		}
	}
}
function dispatch(http, helpers) {
	H = helpers;
	try {
		let action = http.formvalue('remote_action'), p = parameters(http), result;
		let write = action == 'get' || action == 'save' || action == 'delete' || action == 'trust' || action == 'start' || action == 'install_stat' || action == 'agent_install' || action == 'agent_prepare' || action == 'rpc';
		if (write && http.getenv('REQUEST_METHOD') != 'POST') error('POST required');
		authorize_remote(http, action, p);
		if (action == 'devices') prune_runtime();
		if (action == 'devices') {
			let info = tool_info(null);
			result = { devices: devices(false), tools: { sshpass: H.command_exists('sshpass'), pv: H.command_exists('pv'), ssh: H.command_exists('ssh'), stat: info.stat, stat_provider: info.stat_provider } };
		}
		else if (action == 'tools') {
			let d = checked_device(p.device_id, p.device_revision);
			if (!d) error('Device not found');
			result = tool_info(d);
		}
		else if (action == 'agent_info') result = agent_info(p);
		else if (action == 'agent_install') result = agent_install(p);
		else if (action == 'agent_prepare') result = agent_prepare(p);
		else if (action == 'rpc') result = agent_rpc(p);
		else if (action == 'install_stat') result = install_stat(p);
		else if (action == 'get') { result = device(p.id); delete result.host_key; }
		else if (action == 'save') result = update_device(p);
		else if (action == 'delete') {
			let d = device(p.id); if (!d) error('Device not found');
			let u = cursor(); u.load(CONFIG);
			if (!u.delete(CONFIG, d.id) || !u.save(CONFIG) || !u.commit(CONFIG)) error('Cannot delete device');
			result = {};
		}
		else if (action == 'trust') {
			if (!match(p.challenge ?? '', /^[a-f0-9]{32}$/)) error('Invalid host key confirmation');
			let file = ROOT + '/trust-' + p.challenge, challenge = read_json(file), d = device(p.device_id);
			if (!d || !challenge || challenge.id != d.id || challenge.host != d.host || challenge.port != d.port || challenge.expires < time()) error('Host key confirmation expired');
			if (d.host_key && d.host_key != challenge.key) error('Host key was already confirmed; reconnect');
			let u = cursor(); u.load(CONFIG);
			if (!u.set(CONFIG, d.id, 'host_key', challenge.key) || !u.save(CONFIG) || !u.commit(CONFIG)) error('Cannot save host key');
			fs.unlink(file); result = {};
		}
		else if (action == 'list' || action == 'capacity') {
			let d = checked_device(p.device_id, p.device_revision); if (!d) error('Device not found');
			result = listing(d, p.path ?? '/', action == 'capacity');
			result.device_revision = d.revision;
			result.device_name = d.name;
			if (action == 'capacity') delete result.items;
		}
		else if (action == 'check') {
			if (p.tree_path) result = { children: listing(checked_device(p.source_device, p.source_revision), p.tree_path).items };
			else { let q = plan(p); result = { conflicts: q.conflicts, rename_names: q.rename_names }; }
		}
		else if (action == 'start') result = start(p);
		else if (action == 'status') result = status(p.task_id);
		else error('Unknown remote operation');
		H.ok(http, result);
	}
	catch (e) {
		let detail;
		try { detail = json('' + e); } catch (ignored) {}
		H.fail(http, detail?.data?.challenge ? 11 : 1, H.tr(detail?.message ?? ('' + e)), detail?.data);
	}
}

return { dispatch, stream_remote };
