#!/usr/bin/env bash
# Writes (or clears) the current tmux session's Claude state to a status file.
# Usage: session-status.sh working|waiting|idle|end
#   end  -> remove the status file (session finished/closed)
set -u
state="${1:-}"
case "$state" in working|waiting|idle|end) ;; *) exit 0 ;; esac
name="$(tmux display-message -p '#S' 2>/dev/null)" || exit 0
[ -z "$name" ] && exit 0
# M4 safety: only simple names (no path separators / traversal)
case "$name" in *[!A-Za-z0-9._-]*|*..*) exit 0 ;; esac
dir="${HOME}/.claude/session-status"
file="$dir/${name}.json"
if [ "$state" = "end" ]; then rm -f "$file"; exit 0; fi
mkdir -p "$dir"
ts="$(date +%s)"
# atomic write (temp + mv) so the watcher never reads a half-written file
tmp="$(mktemp "$dir/.tmp.XXXXXX")"
printf '{"state":"%s","ts":%s}\n' "$state" "$ts" > "$tmp"
mv -f "$tmp" "$file"
