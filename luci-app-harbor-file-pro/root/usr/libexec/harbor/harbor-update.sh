#!/bin/sh
# Harbor File Pro update script

CACHE_DIR="/tmp/harbor_update"
CORE_UPDATE_ROOT="/tmp/harbor-core-update"
mkdir -p "$CACHE_DIR"
LOCK_DIR="$CACHE_DIR/.lock"

PM="" EXT=""
command -v apk  >/dev/null 2>&1 && { PM=apk  EXT=apk; }
command -v opkg >/dev/null 2>&1 && { PM=opkg EXT=ipk; }

CORE_TARGETS="aarch64-unknown-linux-musl arm-unknown-linux-musleabi arm-unknown-linux-musleabihf armv5te-unknown-linux-musleabi armv7-unknown-linux-musleabi armv7-unknown-linux-musleabihf i586-unknown-linux-musl i686-unknown-linux-musl mips-unknown-linux-musl mipsel-unknown-linux-musl riscv64gc-unknown-linux-musl x86_64-unknown-linux-musl"

cache_full()    { echo "$CACHE_DIR/$1.full.json"; }
cache_slim()    { echo "$CACHE_DIR/$1.slim.json"; }
status_file()   { echo "$CACHE_DIR/$1.status";    }
log_file()      { echo "$CACHE_DIR/$1.log";       }
event_file()    { echo "$CACHE_DIR/$1.events";    }

log() {
    local f="$(log_file "$1")"; shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$f"
}

event() {
    local f="$(event_file "$1")"; shift
    printf '[%s] EVENT %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$f"
}

set_status() {
    local f="$(status_file "$1")"
    echo "$2" > "${f}.tmp" && mv "${f}.tmp" "$f"
}

format_size() {
    local b="$1"
    [ "$b" -gt 1048576 ] 2>/dev/null && awk "BEGIN{printf \"%.1f MB\",$b/1048576}" && return
    [ "$b" -gt 1024 ] 2>/dev/null && awk "BEGIN{printf \"%.1f KB\",$b/1024}" && return
    echo "$b B"
}

wait_for_network() {
    local i=0
    while [ $i -lt 30 ]; do
        ip route show default 2>/dev/null | grep -q . && return 0
        sleep 1
        i=$((i+1))
    done
    return 1
}

acquire_lock() {
    local i=0
    while ! mkdir "$LOCK_DIR" 2>/dev/null; do
        i=$((i+1))
        [ $i -gt 60 ] && return 1
        sleep 1
    done
    trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT INT TERM
    return 0
}

cfg_name() {
    local ptr
    ptr="$(uci -q get harbor_file_pro.main.config_file 2>/dev/null)"
    case "$ptr" in
        /etc/config/*) basename "$ptr" ;;
        *) echo "harbor_file_pro" ;;
    esac
}

CFG="$(cfg_name)"

uci_get() {
    uci -q get "$CFG.main.$1" 2>/dev/null
}

load_uci() {
    MIRROR="$(uci_get update_mirror)"; [ -n "$MIRROR" ] || MIRROR="$(uci_get mirror)"
    [ -n "$MIRROR" ] || MIRROR="auto"
    case "$MIRROR" in github|gitlab|gitee|cloudflare|auto) ;; *) MIRROR="auto" ;; esac
    CORE_MIRROR="$MIRROR"
    _arch="$(uci_get arch)"
    [ -z "$_arch" ] || [ "$_arch" = "auto" ] && _arch="$(detect_arch)"
    ARCH1="$(echo "$_arch" | cut -d' ' -f1)"
    ARCH2="$(echo "$_arch" | cut -d' ' -f2)"
    [ "$ARCH2" = "$ARCH1" ] && ARCH2=""
    if [ -n "$ARCH1" ] && [ -z "$ARCH2" ]; then
        _detected="$(detect_arch)"
        _det1="$(echo "$_detected" | cut -d' ' -f1)"
        _det2="$(echo "$_detected" | cut -d' ' -f2)"
        [ "$_det1" = "$ARCH1" ] && [ "$_det2" != "$_det1" ] && ARCH2="$_det2"
    fi
    BIN_DIR="$(uci_get bin_dir)";      [ -n "$BIN_DIR" ] || BIN_DIR="/usr/sbin"
    STATE_DIR="$(uci_get state_dir)";  [ -n "$STATE_DIR" ] || STATE_DIR="/etc/harbor"
    PORT="$(uci_get port)";            [ -n "$PORT" ] || PORT="9700"
    CACHE_HOURS="$(uci_get check_cache_hours)"; [ -n "$CACHE_HOURS" ] || CACHE_HOURS="6"
    AUTO_LUCI="$(uci_get auto_update_luci)";    [ -n "$AUTO_LUCI" ] || AUTO_LUCI="0"
}

valid_project() {
    case "$1" in harbor-core|luci-app-harbor-file-pro) return 0 ;; *) return 1 ;; esac
}

api_url() {
    local mirror="$1" proj="$2"
    case "$mirror" in
        github)     echo "https://api.github.com/repos/whzhni1/${proj}/releases" ;;
        gitlab)     echo "https://gitlab.com/api/v4/projects/whzhni%2F${proj}/releases" ;;
        gitee)      echo "https://gitee.com/api/v5/repos/whzhni/${proj}/releases?per_page=20" ;;
        cloudflare) echo "https://pub-8a57d35d70d5423aac22a3316867e7ce.r2.dev/${proj}/releases" ;;
        *)          echo "https://api.github.com/repos/whzhni1/${proj}/releases" ;;
    esac
}

pick_mirror() {
    local m="$1"
    case "$m" in
        ''|auto|random) echo github ;;
        *) echo "$m" ;;
    esac
}

mirror_order() {
    local preferred="$1" mirror seen=""
    for mirror in "$preferred" github gitlab gitee cloudflare; do
        case " $seen " in *" $mirror "*) continue ;; esac
        seen="$seen $mirror"
        printf '%s\n' "$mirror"
    done
}

fetch_release() {
    local mirror="$1" project="$2" output="$3" url
    url="$(api_url "$mirror" "$project")"
    ( ulimit -f 4096; curl -fsSL --connect-timeout 2 --max-time 3 --max-filesize 2097152 \
        --proto '=https' --proto-redir '=https' -H 'Accept: application/json' \
        -H 'User-Agent: Harbor-Updater' -o "$output" "$url" ) 2>/dev/null
}

valid_release_metadata() {
    ucode - "$1" <<'HARBOR_UCODE'
'use strict';
import { readfile } from 'fs';
let data;
try { data = json(readfile(ARGV[0]) || ''); } catch (e) { exit(1); }
function hasVersion(value) {
    if (type(value) == 'array') {
        for (let item in value) if (hasVersion(item)) return true;
    } else if (type(value) == 'object') {
        if (type(value.tag_name) == 'string' && match(value.tag_name, /^v?[0-9]+\.[0-9]+\.[0-9]+$/)) return true;
        for (let k, v in value) if ((type(v) == 'array' || type(v) == 'object') && hasVersion(v)) return true;
    }
    return false;
}
exit(hasVersion(data) ? 0 : 1);
HARBOR_UCODE
}

detect_arch() {
    local machine; machine="$(uname -m)"
    case "$machine" in
        x86_64)        echo "x86_64" ;;
        i686)          echo "i686" ;;
        i[3-5]86)      echo "i586" ;;
        aarch64|arm64) echo "aarch64" ;;
        riscv64)       echo "riscv64" ;;
        armv7*)
            grep -q "vfp" /proc/cpuinfo 2>/dev/null \
                && echo "armv7 musleabihf" || echo "armv7 musleabi" ;;
        armv6*|arm1176*)
            grep -q "vfp" /proc/cpuinfo 2>/dev/null \
                && echo "arm musleabihf" || echo "arm musleabi" ;;
        armv5*)        echo "armv5te musleabi" ;;
        mipsel*)       echo "mipsel" ;;
        mips*)         echo "mips" ;;
        *)             echo "$machine" ;;
    esac
}

core_triple() {
    case "$ARCH1 $ARCH2" in
        "x86_64 ")            echo "x86_64-unknown-linux-musl" ;;
        "i686 ")              echo "i686-unknown-linux-musl" ;;
        "i586 ")              echo "i586-unknown-linux-musl" ;;
        "aarch64 ")           echo "aarch64-unknown-linux-musl" ;;
        "riscv64 ")           echo "riscv64gc-unknown-linux-musl" ;;
        "armv7 musleabihf")   echo "armv7-unknown-linux-musleabihf" ;;
        "armv7 musleabi")     echo "armv7-unknown-linux-musleabi" ;;
        "arm musleabihf")     echo "arm-unknown-linux-musleabihf" ;;
        "arm musleabi")       echo "arm-unknown-linux-musleabi" ;;
        "armv5te musleabi")   echo "armv5te-unknown-linux-musleabi" ;;
        "mips ")             echo "mips-unknown-linux-musl" ;;
        "mipsel ")           echo "mipsel-unknown-linux-musl" ;;
        *)                    echo "" ;;
    esac
}

extract_version() {
    grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1
}

installed_version() {
    local proj="$1" raw_ver=""
    load_uci
    case "$proj" in
        harbor-core)
            [ -x "$BIN_DIR/harbor-core" ] || { echo ""; return; }
            "$BIN_DIR/harbor-core" --version 2>/dev/null | extract_version
            ;;
        luci-app-harbor-file-pro)
            case "$PM" in
                apk)  raw_ver="$(apk info luci-app-harbor-file-pro 2>/dev/null | head -1)" ;;
                opkg) raw_ver="$(opkg info luci-app-harbor-file-pro 2>/dev/null | grep '^Version:')" ;;
            esac
            echo "$raw_ver" | extract_version
            ;;
    esac
}

cache_fresh() {
    local f="$1" now mt
    [ -f "$f" ] || return 1
    now="$(date +%s)"
    mt="$(stat -c %Y "$f" 2>/dev/null || echo 0)"
    case "$CACHE_HOURS" in *[!0-9]*|'') CACHE_HOURS=6 ;; esac
    [ $((now - mt)) -lt $((CACHE_HOURS * 3600)) ]
}

cmd_check() {
    local proj="$1" mirror
    local raw file_ext lines work
    local slim_json first_release current_tag assets_slim first_asset fname count line
    valid_project "$proj" || return 1
    load_uci
    mirror="$(pick_mirror "${2:-$MIRROR}")"
    if [ "${HARBOR_CHECK_FORCE:-0}" != "1" ] && cache_fresh "$(cache_slim "$proj")"; then
        count="$(grep -o '"tag":' "$(cache_slim "$proj")" 2>/dev/null | wc -l | tr -d ' ')"
        set_status "$proj" "ready:${count:-0}"
        event "$proj" "version_list_cached count=${count:-0}"
        return 0
    fi
    rm -f "$(log_file "$proj")" "$(event_file "$proj")"
    set_status "$proj" "checking"
    event "$proj" "checking_version project=$proj mirror=$mirror"
    log "$proj" "Checking for updates (mirror: $mirror)"
    raw=""
    work="$(mktemp "$CACHE_DIR/release-check.XXXXXX")" || { set_status "$proj" "error:Temporary storage failed"; return 1; }
    for m in $(mirror_order "$mirror"); do
        log "$proj" "Trying mirror: $m"
        if fetch_release "$m" "$proj" "$work" && valid_release_metadata "$work"; then
            raw="$(sed 's/": /":/g' "$work")"
            mirror="$m"
            break
        fi
        event "$proj" "api_request_failed project=$proj mirror=$m"
    done
    rm -f "$work"
    if [ -z "$raw" ]; then
        log "$proj" "Cannot reach the release API on any mirror"
        set_status "$proj" "error:Release API unreachable on all mirrors"
        return 1
    fi
    file_ext=""
    [ "$proj" = "luci-app-harbor-file-pro" ] && file_ext="$EXT"
    if [ -n "$file_ext" ]; then
        lines="$(echo "$raw" | grep -o '"tag_name":"[^"]*"\|https://[^"]*\.'"$file_ext"'[^"]*')"
    elif [ "$proj" = "harbor-core" ]; then
        lines="$(echo "$raw" | grep -o '"tag_name":"[^"]*"\|https://[^"]*\.tar\.gz[^"]*')"
    else
        lines="$(echo "$raw" | grep -o '"tag_name":"[^"]*"\|https://[^"]*linux[^"]*')"
    fi
    slim_json='{"releases":['
    first_release=1 current_tag="" assets_slim="" first_asset=1
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        case "$line" in
            '"tag_name":"'*)
                if [ -n "$current_tag" ] && [ -n "$assets_slim" ]; then
                    [ "$first_release" -eq 1 ] && first_release=0 || slim_json="${slim_json},"
                    slim_json="${slim_json}{\"tag\":\"$current_tag\",\"filenames\":[$assets_slim]}"
                fi
                current_tag="$(echo "$line" | cut -d'"' -f4)"
                assets_slim="" first_asset=1
                ;;
            https://*)
                fname="${line##*/}"
                [ -z "$fname" ] && continue
                case "$fname" in *sha256*) continue ;; esac
                case "$assets_slim" in *"\"$fname\"") continue ;; esac
                [ "$first_asset" -eq 1 ] && first_asset=0 || assets_slim="${assets_slim},"
                assets_slim="${assets_slim}\"$fname\""
                ;;
        esac
    done <<EOF
$lines
EOF
    if [ -n "$current_tag" ] && [ -n "$assets_slim" ]; then
        [ "$first_release" -eq 1 ] || slim_json="${slim_json},"
        slim_json="${slim_json}{\"tag\":\"$current_tag\",\"filenames\":[$assets_slim]}"
    fi
    slim_json="${slim_json}]}"
    echo "$raw"       > "$(cache_full "$proj")"
    echo "$slim_json" > "$(cache_slim "$proj")"
    count="$(echo "$slim_json" | grep -o '"tag":' | wc -l | tr -d ' ')"
    log "$proj" "Found $count releases"
    if [ "$count" -eq 0 ]; then
        event "$proj" "no_matching_file project=$proj"
        set_status "$proj" "error:No matching file found, please switch mirror"
        return 1
    fi
    event "$proj" "version_list_ready count=$count"
    set_status "$proj" "ready:$count"
}

verify_download() {
    local proj="$1" tmp="$2"
    local actual cache short
    cache="$(cache_full "$proj")"
    if ! grep -qi 'sha256' "$cache" 2>/dev/null; then
        log "$proj" "Upstream publishes no checksum for this release, verification skipped"
        return 0
    fi
    actual="$(sha256sum "$tmp" 2>/dev/null | cut -d' ' -f1)"
    [ -z "$actual" ] && { log "$proj" "sha256sum unavailable, verification skipped"; return 0; }
    if grep -q "$actual" "$cache" 2>/dev/null; then
        short="$(echo "$actual" | cut -c1-16)"
        event "$proj" "checksum_passed"
        log "$proj" "Checksum OK (sha256 $short...)"
        return 0
    fi
    event "$proj" "checksum_failed"
    log "$proj" "Checksum mismatch, the download is corrupted (sha256 $actual)"
    set_status "$proj" "error:Checksum verification failed"
    rm -f "$tmp"
    return 1
}

pick_latest() {
    local proj="$1"
    LATEST_TAG="" LATEST_FILE=""
    local slim; slim="$(cache_slim "$proj")"
    [ -f "$slim" ] || return 1
    LATEST_TAG="$(grep -oE '"tag":"[^"]*"' "$slim" | head -1 | cut -d'"' -f4)"
    [ -n "$LATEST_TAG" ] || return 1
    local filenames
    filenames="$(grep -o '"filenames":\[[^]]*\]' "$slim" | head -1 | grep -oE '"[^"]+\.[^"]+"' | tr -d '"')"
    LATEST_FILE="$(echo "$filenames" | grep -E "\.${EXT}$" | grep -v 'i18n' | head -1)"
    [ -n "$LATEST_FILE" ]
}

# Language to auto-install a translation pack for. Mirrors the
# luci-app-tailscale update.sh (luci_i18n_install) convention: an explicit
# uci override, else the active LuCI language; anything invalid means
# "no language pack" and is silently skipped.
i18n_lang() {
    local lang
    lang="$(uci_get i18n_lang)"
    [ -n "$lang" ] || lang="$(uci -q get harbor_file_pro.update.lang 2>/dev/null)"
    [ -n "$lang" ] || lang="$(uci -q get luci.main.lang 2>/dev/null | tr '_' '-')"
    case "$lang" in
        ''|*[!a-z0-9-]*) return 0 ;;
    esac
    printf '%s' "$lang"
}

installed_i18n_asset() {
    local proj="$1" filenames pkg slug lang
    filenames="$(grep -o '"filenames":\[[^]]*\]' "$(cache_slim "$proj")" | head -1 | grep -oE '"[^"]+\.[^"]+"' | tr -d '"')"
    case "$PM" in
        apk)  pkg="$(apk info 2>/dev/null | grep '^luci-i18n-harbor-file-pro-' | head -1)" ;;
        opkg) pkg="$(opkg list-installed 2>/dev/null | awk '/^luci-i18n-harbor-file-pro-/{print $1}' | head -1)" ;;
    esac
    if [ -n "$pkg" ]; then
        slug="${pkg##*luci-i18n-harbor-file-pro-}"
        [ -n "$slug" ] || return 0
        echo "$filenames" | grep 'i18n' | grep -F "$slug" | grep -E "\.${EXT}$" | head -1
        return 0
    fi
    # No translation pack installed yet: pick the one matching the wanted
    # language from the same release (fresh auto-install, tailscale style).
    lang="$(i18n_lang)"
    [ -n "$lang" ] || return 0
    echo "$filenames" | grep -E "luci-i18n-harbor-file-pro-${lang}[_-][0-9]" | grep -E "\.${EXT}$" | head -1
}

pm_install() {
    local pkg="$1" out="${PM_LOG_FILE:-/dev/null}"
    case "$PM" in
        apk) apk add --allow-untrusted "$pkg" >>"$out" 2>&1 ;;
        opkg) opkg install "$pkg" >>"$out" 2>&1 ;;
        *) echo "No package manager (apk/opkg) found" >>"$out"; return 1 ;;
    esac
}

health_ok() {
    local i=0 host url listen
    listen="$(uci_get listen)"
    case "$listen" in
        ''|0.0.0.0) host=127.0.0.1 ;;
        ::|'[::]') host='[::1]' ;;
        \[*\]) host="$listen" ;;
        *:*) host="[$listen]" ;;
        *) host="$listen" ;;
    esac
    case "$PORT" in ''|*[!0-9]*) return 1 ;; esac
    url="http://${host}:${PORT}/healthz"
    while [ $i -lt 20 ]; do
        if curl -fsS --noproxy '*' --max-time 2 "$url" >/dev/null 2>&1; then
            return 0
        fi
        if command -v uclient-fetch >/dev/null 2>&1 && uclient-fetch -qO- "$url" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        i=$((i+1))
    done
    return 1
}

cmd_download() {
    local proj="$1" tag="$2" fnames="$3"
    valid_project "$proj" || return 1
    if [ "$proj" = "harbor-core" ]; then
        set_status "$proj" "error:Compatible core updater not yet available"
        return 1
    fi
    load_uci
    acquire_lock || { set_status "$proj" "error:Another update is running"; return 1; }
    rm -f "$(log_file "$proj")"
    set_status "$proj" "downloading"
    event "$proj" "download_prepare tag=$tag"
    log "$proj" "Downloading $tag ($fnames)"
    [ -f "$(cache_full "$proj")" ] || {
        log "$proj" "Version cache missing, please check for updates first"
        set_status "$proj" "error:Please check upstream version first"
        return 1
    }
    local installed="" fname
    for fname in $fnames; do
        case "$fname" in
            *i18n*)
                # Language packs ride along with the main package; failure is
                # non-fatal (same i18n_skip convention as luci-app-tailscale).
                if _download_and_install "$proj" "$fname"; then
                    installed="${installed:+${installed}, }${fname}"
                else
                    log "$proj" "i18n_skip $fname"
                    event "$proj" "i18n_skip file=$fname"
                fi
                ;;
            *)
                _download_and_install "$proj" "$fname" || return 1
                installed="${installed:+${installed}, }${fname}"
                ;;
        esac
    done
    event "$proj" "installation_complete installed=${installed:-$fnames}"
    set_status "$proj" "done:${installed:-$fnames}"
}

_download_and_install() {
    local proj="$1" fname="$2"
    local cache dl_url esc_fname f total_size progress_pid rc downloaded pct size
    cache="$(cache_full "$proj")"
    esc_fname="$(printf '%s' "$fname" | sed 's/[][\.*^$/]/\\&/g')"
    dl_url="$(grep -o "https://[^\"']*/${esc_fname}" "$cache" | head -1)"
    [ -n "$dl_url" ] || { log "$proj" "Download URL not found for $fname"; set_status "$proj" "error:Download URL not found"; return 1; }
    f="$CACHE_DIR/$fname"
    rm -f "$f"
    log "$proj" "Downloading $fname"
    set_status "$proj" "downloading"
    total_size="$(curl -sIL --connect-timeout 15 --retry 2 --retry-delay 3 "$dl_url" 2>/dev/null \
        | grep -i content-length | tail -1 | awk '{print $2}' | tr -d '\r')"
    if [ -n "$total_size" ] && [ "$total_size" -gt 0 ] 2>/dev/null; then
        log "$proj" "File size: $(format_size "$total_size")"
        local need_kb avail_kb
        need_kb=$(( total_size / 1024 + 512 ))
        avail_kb="$(df -k "$CACHE_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
        if [ -n "$avail_kb" ] && [ "$avail_kb" -lt "$need_kb" ]; then
            log "$proj" "Not enough storage space in $CACHE_DIR"
            event "$proj" "insufficient_space"
            set_status "$proj" "error:Not enough storage space"
            return 1
        fi
    fi
    (
        local i=0
        while [ $i -lt 330 ]; do
            sleep 1
            i=$((i+1))
            [ -f "$f" ] || continue
            downloaded=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
            [ -n "$downloaded" ] || continue
            if [ -n "$total_size" ] && [ "$total_size" -gt 0 ] 2>/dev/null; then
                pct=$(( downloaded * 100 / total_size ))
                [ $pct -gt 100 ] && pct=100
                set_status "$proj" "downloading:${pct}:${downloaded}:${total_size}"
                [ $pct -ge 100 ] && break
            else
                set_status "$proj" "downloading:-1:${downloaded}:0"
            fi
        done
    ) &
    progress_pid=$!
    curl -fsSL --connect-timeout 15 --max-time 300 \
        --retry 3 --retry-delay 5 \
        -o "$f" "$dl_url"
    rc=$?
    kill "$progress_pid" 2>/dev/null
    wait "$progress_pid" 2>/dev/null
    if [ $rc -ne 0 ] || [ ! -s "$f" ]; then
        event "$proj" "download_failed file=$fname return_code=$rc"
        log "$proj" "Download failed (curl exit $rc): $fname"
        set_status "$proj" "error:Download failed"
        rm -f "$f"
        return 1
    fi
    size="$(wc -c < "$f" | tr -d ' ')"
    log "$proj" "Download complete: $fname ($(format_size "$size"))"
    event "$proj" "download_complete file=$fname"
    verify_download "$proj" "$f" || return 1
    event "$proj" "installation_started"
    set_status "$proj" "installing"
    local need_kb avail_kb
    need_kb=$(( size * 2 / 1024 + 512 ))
    avail_kb="$(df -k / 2>/dev/null | awk 'NR==2{print $4}')"
    if [ -n "$avail_kb" ] && [ "$need_kb" -gt "$avail_kb" ]; then
        log "$proj" "Not enough space to install package"
        event "$proj" "insufficient_space"
        set_status "$proj" "error:Not enough storage space"
        rm -f "$f"
        return 1
    fi
    PM_LOG_FILE="$(log_file "$proj")"
    if pm_install "$f"; then
        log "$proj" "Package installed: $fname"
        PM_LOG_FILE=""
        rm -f "$f"
        return 0
    fi
    PM_LOG_FILE=""
    log "$proj" "Package install failed: $fname"
    set_status "$proj" "error:Package install failed"
    rm -f "$f"
    return 1
}

auto_update_one() {
    local proj="$1"
    log "$proj" "=== Auto update: $proj ==="
    cmd_check "$proj" "$MIRROR" || return 1
    pick_latest "$proj" || {
        log "$proj" "No release file matching this architecture"
        set_status "$proj" "error:No file for this architecture"
        return 1
    }
    local latest_ver cur_ver
    latest_ver="$(echo "$LATEST_TAG" | extract_version)"
    cur_ver="$(installed_version "$proj")"
    log "$proj" "Installed ${cur_ver:-none}, latest ${latest_ver:-unknown}"
    if [ -n "$cur_ver" ] && [ -n "$latest_ver" ] && [ "$(printf '%s\n' "$cur_ver" "$latest_ver" | sort -V | tail -1)" = "$cur_ver" ]; then
        log "$proj" "Already up to date ($cur_ver)"
        set_status "$proj" "done:Already up to date($cur_ver)"
        return 0
    fi
    log "$proj" "Updating to $LATEST_TAG ($LATEST_FILE)"
    local fnames="$LATEST_FILE" lang_file
    if [ "$proj" = "luci-app-harbor-file-pro" ]; then
        lang_file="$(installed_i18n_asset "$proj")"
        [ -n "$lang_file" ] && fnames="$fnames $lang_file" && log "$proj" "Including language pack $lang_file"
    fi
    cmd_download "$proj" "$LATEST_TAG" "$fnames"
}

auto_update_core() {
    local target current check id
    target="$(core_triple)"
    [ -n "$target" ] || { log harbor-core "Unsupported target"; return 1; }
    current="$(installed_version harbor-core)"
    [ -n "$current" ] || current=0.0.0
    check="$(core_update_check --current-version "$current" --target "$target" --mirror "$CORE_MIRROR")" || return 1
    if [ "$(core_update_field "$check" update_available)" != true ] || [ "$(core_update_field "$check" installable)" != true ]; then
        log harbor-core "No installable update available"
        return 0
    fi
    id="auto-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
    core_update_valid_id "$id" || return 1
    core_update_start --task-id "$id" --current-version "$current" --target "$target" --mirror "$CORE_MIRROR" >/dev/null
}

cmd_auto_update() {
    load_uci
    wait_for_network || log "auto" "Network still unavailable after 30s, continuing anyway"
    log "auto" "Starting auto update (mirror: $MIRROR, arch: ${ARCH1}${ARCH2:+ $ARCH2})"
    local projects="$*"
    [ -n "$projects" ] || projects="harbor-core luci-app-harbor-file-pro"
    local proj
    for proj in $projects; do
        valid_project "$proj" || continue
        if [ "$proj" = "luci-app-harbor-file-pro" ] && [ "$AUTO_LUCI" != "1" ]; then
            log "$proj" "LuCI auto update disabled, skipping"
            continue
        fi
        if [ "$proj" = "harbor-core" ]; then
            auto_update_core || log "$proj" "Core auto update could not be started"
            continue
        fi
        auto_update_one "$proj" || true
        log "auto" "$proj -> $(cat "$(status_file "$proj")" 2>/dev/null)"
    done
    log "auto" "Done"
}

core_update_parse_release() {
    ucode - "$@" <<'HARBOR_UCODE'
'use strict';

import { readfile } from 'fs';

const current = ARGV[1] || '';
const target = ARGV[2] || '';

function fail(message) {
    print(sprintf('%J\n', { error: message }));
    exit(1);
}

function version(value) {
    let m = match(`${value || ''}`, /^v?([0-9]+)\.([0-9]+)\.([0-9]+)$/);
    if (!m || length(m[1]) > 9 || length(m[2]) > 9 || length(m[3]) > 9)
        return null;
    return { text: `${m[1]}.${m[2]}.${m[3]}`, major: int(m[1]), minor: int(m[2]), patch: int(m[3]) };
}

function newer(a, b) {
    if (a.major != b.major) return a.major > b.major;
    if (a.minor != b.minor) return a.minor > b.minor;
    return a.patch > b.patch;
}

function releases(value) {
    if (type(value) == 'array') return value;
    if (type(value) != 'object') return [];
    for (let key in ['releases', 'results', 'data', 'items']) {
        if (type(value[key]) == 'array') return value[key];
    }
    return value.tag_name ? [ value ] : [];
}

function assets(value, name) {
    if (type(value) == 'array') {
        for (let item in value) {
            let found = assets(item, name);
            if (found) return found;
        }
    } else if (type(value) == 'object') {
        let filename = value.name || value.filename || value.file_name || '';
        let url = value.browser_download_url || value.direct_asset_url || value.download_url || value.href || value.url || '';
        if (filename == name && type(url) == 'string' && match(url, /^https:\/\/[A-Za-z0-9._~:\/?#@!$&'()*+,;=%-]+$/))
            return { url: url, digest: value.digest || value.sha256 || '' };
        for (let k, v in value) {
            if (type(v) == 'array' || type(v) == 'object') {
                let found = assets(v, name);
                if (found) return found;
            }
        }
    }
    return null;
}

let cur = version(current);
if (!cur || !match(target, /^[a-z0-9_-]{1,100}$/)) fail('Invalid version or target');
let raw = readfile(ARGV[0] || '');
if (!raw || length(raw) > 2097152) fail('Invalid release metadata');
let data;
try { data = json(raw); } catch (e) { fail('Invalid release metadata'); }
let best = null;
let bestRelease = null;
for (let r in releases(data)) {
    if (type(r) != 'object' || r.draft === true || r.prerelease === true) continue;
    let v = version(r.tag_name || r.tag || r.version || '');
    if (v && (!best || newer(v, best))) { best = v; bestRelease = r; }
}
if (!best) fail('No valid release found');
let available = newer(best, cur);
let filename = `harbor-core-${best.text}-${target}.tar.gz`;
let assetFound = assets(bestRelease, filename);
let digest = assetFound ? `${assetFound.digest || ''}` : '';
if (substr(digest, 0, 7) == 'sha256:') digest = substr(digest, 7);
if (digest && !match(digest, /^[0-9a-fA-F]{64}$/)) fail('Invalid release digest');
let manifest = assets(bestRelease, 'sha256.txt') || assets(bestRelease, 'SHA256SUMS') || assets(bestRelease, 'sha256sums.txt');
print(sprintf('%J\n', {
    ok: true,
    current_version: cur.text,
    latest_version: best.text,
    target: target,
    update_available: available,
    installable: !!assetFound,
    asset_version: assetFound ? best.text : null,
    asset_url: assetFound ? assetFound.url : null,
    asset_name: assetFound ? filename : null,
    sha256: digest || null,
    checksum_url: manifest ? manifest.url : null,
    message: available ? (assetFound ? 'Update available' : 'No matching target asset') : 'Already up to date'
}));
HARBOR_UCODE
}

core_update_verify_archive() (

[ "$#" -eq 3 ] || exit 2
archive="$1"
expected_sha="$2"
staged="$3"
created=0
work=""

cleanup() {
    [ -n "$work" ] && rm -rf "$work"
}
trap cleanup EXIT

fail() {
    [ "$created" -eq 1 ] && rm -f "$staged"
    printf '%s\n' "$1" >&2
    exit 1
}

[ -f "$archive" ] && [ ! -e "$staged" ] && [ ! -L "$staged" ] || fail invalid_path
size="$(wc -c < "$archive" | tr -d ' ')"
[ "$size" -gt 0 ] && [ "$size" -le 134217728 ] || fail archive_size_invalid
if [ -n "$expected_sha" ]; then
    [ "${#expected_sha}" -eq 64 ] || fail invalid_checksum
    case "$expected_sha" in *[!0-9a-fA-F]*) fail invalid_checksum ;; esac
    command -v sha256sum >/dev/null 2>&1 || fail checksum_tool_unavailable
    actual="$(sha256sum "$archive" | awk '{print $1}')"
    [ "$(printf '%s' "$actual" | tr 'A-F' 'a-f')" = "$(printf '%s' "$expected_sha" | tr 'A-F' 'a-f')" ] || fail checksum_mismatch
fi
command -v timeout >/dev/null 2>&1 || fail timeout_unavailable
work="$(mktemp -d)" || fail temporary_storage_failed
chmod 700 "$work" || fail temporary_storage_failed
( ulimit -f 128; timeout 20 tar -tzf "$archive" > "$work/list" ) 2>/dev/null || fail archive_invalid
listing="$(cat "$work/list")"
[ "$listing" = harbor-core ] || fail archive_members_invalid
( ulimit -f 128; timeout 20 tar -tvzf "$archive" > "$work/verbose" ) 2>/dev/null || fail archive_invalid
verbose="$(cat "$work/verbose")"
case "$verbose" in -*) ;; *) fail archive_type_invalid ;; esac
( set -C; : > "$staged" ) 2>/dev/null || fail staging_failed
created=1
( ulimit -f 262144; timeout 30 tar -xOzf "$archive" harbor-core > "$staged" ) 2>/dev/null || fail extract_failed
size="$(wc -c < "$staged" | tr -d ' ')"
[ "$size" -gt 0 ] && [ "$size" -le 134217728 ] || fail extracted_size_invalid
chmod 755 "$staged" || fail staging_failed
exit 0
)


core_update_wait_stopped() {
    local waited=0
    while :; do
        core_update_service_stopped && return 0
        [ "$waited" -ge "$CORE_UPDATE_STOP_WAIT" ] && return 1
        sleep 1 || return 1
        waited=$((waited + 1))
    done
}

core_update_install_transaction() {
    local staged="$1" dst="$2" backup="$3" old=0 staged_dev dst_dev
    CORE_UPDATE_INSTALL_ERROR=''
    CORE_UPDATE_KEEP_BACKUP=0
    [ -f "$staged" ] && [ ! -L "$staged" ] && [ ! -e "$backup" ] && [ ! -L "$backup" ] || {
        CORE_UPDATE_INSTALL_ERROR=invalid_install_paths; return 1;
    }
    [ ! -L "$dst" ] || { CORE_UPDATE_INSTALL_ERROR=invalid_install_paths; return 1; }
    staged_dev="$(stat -c %d "$(dirname "$staged")" 2>/dev/null)"
    dst_dev="$(stat -c %d "$(dirname "$dst")" 2>/dev/null)"
    [ -n "$staged_dev" ] && [ "$staged_dev" = "$dst_dev" ] || {
        CORE_UPDATE_INSTALL_ERROR=staging_not_same_filesystem; return 1;
    }
    if [ -e "$dst" ]; then
        [ -f "$dst" ] || { CORE_UPDATE_INSTALL_ERROR=invalid_install_paths; return 1; }
        cp -p "$dst" "$backup" || { CORE_UPDATE_INSTALL_ERROR=backup_failed; return 1; }
        old=1
        CORE_UPDATE_KEEP_BACKUP=1
    fi
    if [ "$CORE_UPDATE_MANAGE_SERVICE" = 1 ]; then
        if ! core_update_stop_service; then
            CORE_UPDATE_INSTALL_ERROR=stop_failed
            CORE_UPDATE_KEEP_BACKUP=0
            return 1
        fi
        if ! core_update_wait_stopped; then
            CORE_UPDATE_INSTALL_ERROR=stop_timeout
            CORE_UPDATE_KEEP_BACKUP=0
            return 1
        fi
    fi
    if ! mv -f "$staged" "$dst"; then
        CORE_UPDATE_INSTALL_ERROR=install_failed
        CORE_UPDATE_KEEP_BACKUP=0
        if [ "$CORE_UPDATE_MANAGE_SERVICE" = 1 ] && [ "$old" = 1 ]; then
            core_update_start_service || CORE_UPDATE_INSTALL_ERROR=install_failed_restart_failed
        fi
        return 1
    fi
    if [ "$CORE_UPDATE_MANAGE_SERVICE" = 1 ] && { ! core_update_start_service || ! core_update_service_healthy; }; then
        CORE_UPDATE_INSTALL_ERROR=start_failed
        if ! core_update_stop_service || ! core_update_wait_stopped; then
            CORE_UPDATE_INSTALL_ERROR=rollback_stop_failed
            [ "$old" = 1 ] && CORE_UPDATE_KEEP_BACKUP=1
            return 1
        fi
        if [ "$old" = 1 ]; then
            if ! mv -f "$backup" "$dst"; then
                CORE_UPDATE_INSTALL_ERROR=rollback_restore_failed
                CORE_UPDATE_KEEP_BACKUP=1
                return 1
            fi
            CORE_UPDATE_KEEP_BACKUP=0
            if ! core_update_start_service || ! core_update_service_healthy; then
                CORE_UPDATE_INSTALL_ERROR=rollback_restart_failed
            fi
        else
            if ! rm -f "$dst"; then CORE_UPDATE_INSTALL_ERROR=rollback_remove_failed; fi
        fi
        return 1
    fi
    CORE_UPDATE_KEEP_BACKUP=0
    return 0
}

core_update_check() {
    local current="" target="" mirror="" work source result rc
    core_update_parse_args "$@" && [ -z "$CORE_UPDATE_ID" ] || { core_update_error invalid_arguments; return 1; }
    current="$CORE_UPDATE_CURRENT" target="$CORE_UPDATE_TARGET" mirror="$CORE_UPDATE_MIRROR"
    case " $CORE_TARGETS " in *" $target "*) ;; *) printf '%s\n' '{"error":"unsupported_target"}'; return 1 ;; esac
    case "$current" in ''|*[!0-9.v]*) printf '%s\n' '{"error":"invalid_version"}'; return 1 ;; esac
    case "$mirror" in auto|github|gitlab|gitee|cloudflare) source="$(pick_mirror "$mirror")" ;; *) printf '%s\n' '{"error":"invalid_mirror"}'; return 1 ;; esac
    work="$(mktemp -d "$CACHE_DIR/core-check.XXXXXX")" || { printf '%s\n' '{"error":"temporary_storage_failed"}'; return 1; }
    chmod 700 "$work" || { rmdir "$work"; return 1; }
    for m in $(mirror_order "$source"); do
        if fetch_release "$m" harbor-core "$work/release.json"; then
            result="$(core_update_parse_release "$work/release.json" "$current" "$target" 2>/dev/null)"
            rc=$?
            if [ "$rc" -eq 0 ]; then
                rm -rf "$work"
                printf '%s\n' "$result"
                return 0
            fi
        fi
    done
    rm -rf "$work"
    printf '%s\n' '{"error":"release_check_failed"}'
    return 1
}


CORE_UPDATE_SCRIPT='/usr/libexec/harbor/harbor-update.sh'
CORE_UPDATE_STOP_WAIT=30
CORE_UPDATE_MANAGE_SERVICE=1


core_update_stop_service() {
    timeout 30 /etc/init.d/harbor-core stop >/dev/null 2>&1
}

core_update_service_stopped() {
    ! pidof harbor-core >/dev/null 2>&1
}

core_update_start_service() {
    timeout 30 /etc/init.d/harbor-core start >/dev/null 2>&1
}

core_update_service_healthy() {
    health_ok && pidof harbor-core >/dev/null 2>&1
}

core_update_error() {
    printf '{"error":"%s"}\n' "$1"
    return 1
}

core_update_valid_id() {
    [ -n "$1" ] && [ "${#1}" -le 64 ] || return 1
    case "$1" in *[!A-Za-z0-9_-]*) return 1 ;; esac
}

core_update_parse_args() {
    CORE_UPDATE_ID='' CORE_UPDATE_CURRENT='' CORE_UPDATE_TARGET='' CORE_UPDATE_MIRROR=''
    while [ "$#" -gt 0 ]; do
        [ "$#" -ge 2 ] || return 1
        case "$1" in
            --task-id) [ -z "$CORE_UPDATE_ID" ] || return 1; CORE_UPDATE_ID="$2" ;;
            --current-version) [ -z "$CORE_UPDATE_CURRENT" ] || return 1; CORE_UPDATE_CURRENT="$2" ;;
            --target) [ -z "$CORE_UPDATE_TARGET" ] || return 1; CORE_UPDATE_TARGET="$2" ;;
            --mirror) [ -z "$CORE_UPDATE_MIRROR" ] || return 1; CORE_UPDATE_MIRROR="$2" ;;
            *) return 1 ;;
        esac
        shift 2
    done
}

core_update_prepare() {
    # The detached worker starts a fresh shell; it still needs BIN_DIR and mirror
    # from UCI even though task metadata now lives under /tmp.
    load_uci
    [ ! -L "$CORE_UPDATE_ROOT" ] || return 1
    ( umask 077; mkdir -p "$CORE_UPDATE_ROOT" ) || return 1
    [ -d "$CORE_UPDATE_ROOT" ] && [ "$(stat -c %u "$CORE_UPDATE_ROOT" 2>/dev/null)" = 0 ] || return 1
    chmod 700 "$CORE_UPDATE_ROOT" || return 1
}

core_update_task_status() {
    local id="$1" state="$2" phase="$3" progress="$4" message="$5" tmp
    tmp="$CORE_UPDATE_ROOT/$id/status.tmp.$$"
    if [ "$state" = failed ]; then
        printf '{"task_id":"%s","state":"%s","phase":"%s","progress":%s,"downloaded":0,"total":0,"message":"%s","error":"%s"}\n' "$id" "$state" "$phase" "$progress" "$message" "$message" > "$tmp" || return 1
    else
        printf '{"task_id":"%s","state":"%s","phase":"%s","progress":%s,"downloaded":0,"total":0,"message":"%s"}\n' "$id" "$state" "$phase" "$progress" "$message" > "$tmp" || return 1
    fi
    mv -f "$tmp" "$CORE_UPDATE_ROOT/$id/status.json"
}

core_update_ack() {
    printf '{"task_id":"%s","state":"%s","message":"Update task accepted"}\n' "$1" "$2"
}

core_update_start() {
    local id current target mirror dir expected boot state worker owner
    core_update_parse_args "$@" || { core_update_error invalid_arguments; return 1; }
    id="$CORE_UPDATE_ID" current="$CORE_UPDATE_CURRENT" target="$CORE_UPDATE_TARGET" mirror="$CORE_UPDATE_MIRROR"
    core_update_valid_id "$id" || { core_update_error invalid_task_id; return 1; }
    case "$current" in ''|*[!0-9.v]*) core_update_error invalid_version; return 1 ;; esac
    case " $CORE_TARGETS " in *" $target "*) ;; *) core_update_error unsupported_target; return 1 ;; esac
    case "$mirror" in auto|github|gitlab|gitee|cloudflare) ;; *) core_update_error invalid_mirror; return 1 ;; esac
    command -v setsid >/dev/null 2>&1 && command -v jsonfilter >/dev/null 2>&1 || { core_update_error missing_dependency; return 1; }
    core_update_prepare || { core_update_error task_storage_failed; return 1; }
    dir="$CORE_UPDATE_ROOT/$id"
    expected="$(printf '%s\n%s\n%s\n' "$current" "$target" "$mirror")"
    if [ -d "$dir" ] && [ ! -L "$dir" ]; then
        [ "$(cat "$dir/params" 2>/dev/null)" = "$expected" ] || { core_update_error task_id_conflict; return 1; }
        state="$(jsonfilter -i "$dir/status.json" -e '@.state' 2>/dev/null)"
        case "$state" in queued|running|succeeded|failed) core_update_ack "$id" "$state"; return 0 ;; esac
        core_update_error task_state_invalid; return 1
    fi
    ( umask 077; mkdir "$dir" ) || { core_update_error task_storage_failed; return 1; }
    if ! mkdir "$LOCK_DIR" 2>/dev/null; then
        owner="$(cat "$LOCK_DIR/owner" 2>/dev/null)"
        if core_update_valid_id "$owner"; then
            core_update_status --task-id "$owner" >/dev/null 2>&1 || :
        fi
        if ! mkdir "$LOCK_DIR" 2>/dev/null; then
            rmdir "$dir" 2>/dev/null
            core_update_error update_busy; return 1
        fi
    fi
    printf '%s\n' "$id" > "$LOCK_DIR/owner" || { rm -rf "$LOCK_DIR"; rmdir "$dir"; core_update_error lock_failed; return 1; }
    boot="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
    if [ -z "$boot" ] || ! printf '%s\n' "$expected" > "$dir/params" ||
       ! printf '%s\n' "$boot" > "$dir/boot" || ! core_update_task_status "$id" queued queued 0 'Update task accepted'; then
        rm -f "$LOCK_DIR/owner"; rmdir "$LOCK_DIR" 2>/dev/null; rm -rf "$dir"
        core_update_error task_storage_failed; return 1
    fi
    if ! printf '%s\n' "$id" > "$CORE_UPDATE_ROOT/last.tmp.$$" || ! mv -f "$CORE_UPDATE_ROOT/last.tmp.$$" "$CORE_UPDATE_ROOT/last"; then
        rm -f "$CORE_UPDATE_ROOT/last.tmp.$$" "$LOCK_DIR/owner"; rmdir "$LOCK_DIR" 2>/dev/null
        core_update_task_status "$id" failed failed 0 'Cannot record current task'
        core_update_error task_storage_failed; return 1
    fi
    setsid "$CORE_UPDATE_SCRIPT" core-worker --task-id "$id" </dev/null >/dev/null 2>&1 &
    worker=$!
    if ! printf '%s\n' "$worker" > "$dir/pid"; then
        kill "$worker" 2>/dev/null
        core_update_task_status "$id" failed failed 0 'Cannot record worker process'
        rm -f "$LOCK_DIR/owner"; rmdir "$LOCK_DIR" 2>/dev/null
        core_update_error worker_start_failed; return 1
    fi
    core_update_ack "$id" queued
}

core_update_status() {
    local id dir state saved_boot boot pid modified now
    core_update_parse_args "$@" || { core_update_error invalid_arguments; return 1; }
    id="$CORE_UPDATE_ID"
    core_update_valid_id "$id" && [ -z "$CORE_UPDATE_CURRENT$CORE_UPDATE_TARGET$CORE_UPDATE_MIRROR" ] || { core_update_error invalid_task_id; return 1; }
    core_update_prepare || { core_update_error task_storage_failed; return 1; }
    dir="$CORE_UPDATE_ROOT/$id"
    [ -d "$dir" ] && [ ! -L "$dir" ] && [ -f "$dir/status.json" ] || { core_update_error task_not_found; return 1; }
    state="$(jsonfilter -i "$dir/status.json" -e '@.state' 2>/dev/null)"
    case "$state" in
        queued|running)
            saved_boot="$(cat "$dir/boot" 2>/dev/null)"
            boot="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)"
            pid="$(cat "$dir/pid" 2>/dev/null)"
            case "$pid" in ''|*[!0-9]*) pid=0 ;; esac
            if [ "$pid" -le 1 ] && [ -n "$boot" ] && [ "$saved_boot" = "$boot" ]; then
                now="$(date +%s)"
                modified="$(stat -c %Y "$dir/status.json" 2>/dev/null)"
                case "$modified:$now" in *[!0-9:]*|:*) ;; *)
                    if [ "$((now - modified))" -lt 5 ]; then cat "$dir/status.json"; return 0; fi ;;
                esac
            fi
            if [ -z "$saved_boot" ] || [ "$saved_boot" != "$boot" ] || [ "$pid" -le 1 ] || ! kill -0 "$pid" 2>/dev/null; then
                core_update_task_status "$id" failed failed 0 'Update worker interrupted' || { core_update_error task_storage_failed; return 1; }
                if [ "$(cat "$LOCK_DIR/owner" 2>/dev/null)" = "$id" ]; then rm -f "$LOCK_DIR/owner"; rmdir "$LOCK_DIR" 2>/dev/null; fi
            fi
            ;;
        succeeded|failed) ;;
        *) core_update_error task_state_invalid; return 1 ;;
    esac
    cat "$dir/status.json"
}

core_update_field() {
    jsonfilter -s "$1" -e "@.$2" 2>/dev/null
}

core_update_worker() {
    local id dir current target mirror check available url version sha checksum_url filename archive stage_dir staged dst backup success
    core_update_parse_args "$@" || exit 1
    id="$CORE_UPDATE_ID"
    core_update_valid_id "$id" && [ -z "$CORE_UPDATE_CURRENT$CORE_UPDATE_TARGET$CORE_UPDATE_MIRROR" ] || exit 1
    core_update_prepare || exit 1
    dir="$CORE_UPDATE_ROOT/$id"
    [ -d "$dir" ] && [ "$(cat "$LOCK_DIR/owner" 2>/dev/null)" = "$id" ] || exit 1
    current="$(sed -n '1p' "$dir/params")"
    target="$(sed -n '2p' "$dir/params")"
    mirror="$(sed -n '3p' "$dir/params")"
    archive="$CACHE_DIR/core-$id.tar.gz"
    stage_dir='' dst="$BIN_DIR/harbor-core" backup='' success=0
    CORE_UPDATE_INSTALL_ERROR='' CORE_UPDATE_KEEP_BACKUP=0
    core_update_finish() {
        if [ "$success" -ne 1 ]; then
            if [ -n "$CORE_UPDATE_INSTALL_ERROR" ]; then
                core_update_task_status "$id" failed failed 0 "$CORE_UPDATE_INSTALL_ERROR" || :
            else
                core_update_task_status "$id" failed failed 0 'Update failed or was interrupted' || :
            fi
            set_status harbor-core 'error:Core update failed'
        fi
        rm -f "$archive"
        [ -n "$stage_dir" ] && [ "$CORE_UPDATE_KEEP_BACKUP" -ne 1 ] && rm -rf "$stage_dir"
        if [ "$(cat "$LOCK_DIR/owner" 2>/dev/null)" = "$id" ]; then rm -f "$LOCK_DIR/owner"; rmdir "$LOCK_DIR" 2>/dev/null; fi
    }
    trap core_update_finish EXIT
    trap 'exit 1' INT TERM HUP
    core_update_task_status "$id" running checking 5 'Checking release' || exit 1
    set_status harbor-core checking
    check="$(core_update_check --current-version "$current" --target "$target" --mirror "$mirror")" || exit 1
    available="$(core_update_field "$check" update_available)"
    [ "$available" = true ] && [ "$(core_update_field "$check" installable)" = true ] || exit 1
    url="$(core_update_field "$check" asset_url)"
    version="$(core_update_field "$check" asset_version)"
    sha="$(core_update_field "$check" sha256)"
    checksum_url="$(core_update_field "$check" checksum_url)"
    filename="$(core_update_field "$check" asset_name)"
    case "$version" in ''|*[!0-9.]*) exit 1 ;; esac
    [ "$filename" = "harbor-core-$version-$target.tar.gz" ] || exit 1
    case "$url" in https://*) ;; *) exit 1 ;; esac
    [ "$sha" = null ] && sha=''
    [ "$checksum_url" = null ] && checksum_url=''
    if [ -z "$sha" ] && [ -n "$checksum_url" ]; then
        case "$checksum_url" in https://*) ;; *) exit 1 ;; esac
        if ! curl -fsSL --connect-timeout 10 --max-time 30 --max-filesize 2097152 --proto '=https' --proto-redir '=https' -o "$dir/checksums" "$checksum_url" 2>/dev/null; then exit 1; fi
        sha="$(awk -v f="$filename" '{n=$2; sub(/^[*]/,"",n); if(n==f && length($1)==64) {print $1; exit}}' "$dir/checksums")"
        rm -f "$dir/checksums"
        [ -n "$sha" ] || exit 1
    fi
    case "$BIN_DIR" in /*) ;; *) exit 1 ;; esac
    case "$BIN_DIR" in *[!A-Za-z0-9/._-]*|*'..'*) exit 1 ;; esac
    mkdir -p "$BIN_DIR" || exit 1
    [ ! -L "$dst" ] || exit 1
    if [ -e "$dst" ]; then
        [ -f "$dst" ] || exit 1
    else
        [ "$current" = '0.0.0' ] || exit 1
    fi
    stage_dir="$(mktemp -d "$BIN_DIR/.harbor-update.XXXXXX")" || exit 1
    chmod 700 "$stage_dir" || exit 1
    staged="$stage_dir/harbor-core"
    core_update_task_status "$id" running download 20 'Downloading release' || exit 1
    set_status harbor-core downloading
    ( ulimit -f 262144; curl -fsSL --connect-timeout 15 --max-time 300 --max-filesize 134217728 --proto '=https' --proto-redir '=https' -o "$archive" "$url" ) 2>/dev/null || exit 1
    core_update_task_status "$id" running verify 60 'Verifying release' || exit 1
    core_update_verify_archive "$archive" "$sha" "$staged" || exit 1
    [ -x /etc/init.d/harbor-core ] && command -v pidof >/dev/null 2>&1 && command -v timeout >/dev/null 2>&1 || exit 1
    backup="$stage_dir/backup"
    core_update_task_status "$id" running install 80 'Stopping service and installing release' || exit 1
    set_status harbor-core installing
    core_update_install_transaction "$staged" "$dst" "$backup" || exit 1
    core_update_task_status "$id" succeeded complete 100 'Update completed' || exit 1
    set_status harbor-core "done:harbor-core-$version"
    success=1
    exit 0
}

case "$1" in
    detect_arch)   detect_arch; exit 0 ;;
    detect_target) load_uci; core_triple; exit 0 ;;
    i18n_asset)    load_uci; installed_i18n_asset "$2"; exit 0 ;;
esac

case "$1" in
    check)
        shift
        case "$1" in
            --current-version|--target|--mirror) core_update_check "$@" ;;
            *) cmd_check "$1" "$2" ;;
        esac
        ;;
    start) shift; core_update_start "$@" ;;
    status)
        shift
        if [ "$#" -eq 1 ] && [ "$1" = --probe ]; then
            for dependency in ucode curl tar jsonfilter timeout setsid pidof sha256sum; do
                if ! command -v "$dependency" >/dev/null 2>&1; then
                    printf '%s\n' '{"supported":false}'
                    exit 1
                fi
            done
            printf '%s\n' '{"supported":true}'
        else
            core_update_status "$@"
        fi
        ;;
    core-worker) shift; core_update_worker "$@" ;;
    core_update) set_status harbor-core "error:Compatible core updater not yet available"; exit 1 ;;
    download)  cmd_download "$2" "$3" "$4" ;;
    installed) installed_version "$2"; echo ;;
    auto)      shift; cmd_auto_update "$@" ;;
    '')        cmd_auto_update ;;
    *)         exit 2 ;;
esac
