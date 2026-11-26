#!/bin/sh
# Private Harbor log view. Never clear the system-wide logread ring buffer.
LOG_DIR="${HARBOR_LOG_DIR:-/tmp/harbor-core-logs}"
LOG_FILE="$LOG_DIR/service.log"
CURSOR="$LOG_DIR/last-line"
# Auto-clear threshold (300 KiB) and how often the size is re-checked
# while lines are appended (every N lines).
LIMIT="${HARBOR_LOG_LIMIT:-307200}"
CHECK_EVERY="${HARBOR_LOG_CHECK_EVERY:-100}"
case "$LIMIT" in ''|*[!0-9]*) LIMIT=307200 ;; esac
case "$CHECK_EVERY" in ''|*[!0-9]*|0) CHECK_EVERY=100 ;; esac
umask 077
mkdir -p "$LOG_DIR" || exit 1
[ ! -L "$LOG_DIR" ] && [ ! -L "$LOG_FILE" ] && [ ! -L "$CURSOR" ] || exit 1
chmod 700 "$LOG_DIR" || exit 1
case "$1" in
    sync|clear) ;;
    *) exit 2 ;;
esac
# Only the newest logread line is used as a cursor. Clearing never affects other services.
snapshot="$(mktemp "$LOG_DIR/snapshot.XXXXXX")" || exit 1
trap 'rm -f "$snapshot" "$LOG_DIR/new.$$"' EXIT INT TERM
logread -e harbor-core > "$snapshot" 2>/dev/null || true
if [ ! -s "$snapshot" ]; then
	logread 2>/dev/null | grep -F 'harbor-core' >> "$snapshot" || true
fi
last="$(tail -n 1 "$snapshot")"
if [ "$1" = clear ]; then
    printf '%s\n' "$last" > "$CURSOR" && : > "$LOG_FILE"
    exit $?
fi
old="$(cat "$CURSOR" 2>/dev/null)"
[ -f "$LOG_FILE" ] || : > "$LOG_FILE"
if [ -n "$old" ]; then
    awk -v marker="$old" '{ entries[NR]=$0; if ($0==marker) from=NR } END { for (i=from+1;i<=NR;i++) print entries[i] }' "$snapshot" > "$LOG_DIR/new.$$" || exit 1
else
    cp "$snapshot" "$LOG_DIR/new.$$" || exit 1
fi
# Append in a single pass but re-check the file size every CHECK_EVERY
# lines; the log is wiped as soon as it passes LIMIT so a burst never
# grows /tmp without bound. Recording continues after a wipe so the
# newest lines survive the rotation. (This replaces the old bulk append
# with one end-of-run size check.)
LC_ALL=C awk -v out="$LOG_FILE" -v base="$(wc -c < "$LOG_FILE")" \
    -v limit="$LIMIT" -v n="$CHECK_EVERY" '
{
    print >> out
    size += length($0) + 1
    if (++count >= n) {
        count = 0
        if (base + size > limit) {
            close(out)
            system(": > \047" out "\047")
            base = 0
            size = 0
        }
    }
}' "$LOG_DIR/new.$$" || exit 1
printf '%s\n' "$last" > "$CURSOR" || exit 1
bytes="$(wc -c < "$LOG_FILE")"
if [ "$bytes" -gt "$LIMIT" ]; then
    : > "$LOG_FILE" || exit 1
fi
