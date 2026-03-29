#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCLAW_HOME="$(cd "$WORKSPACE_DIR/.." && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-openclaw.sh"
LOG_DIR="$OPENCLAW_HOME/logs"
LOG_FILE="$LOG_DIR/backup-openclaw.log"
SCHEDULE="${1:-${OPENCLAW_BACKUP_SCHEDULE:-17 9,15,21 * * *}}"
BEGIN_MARKER="# >>> openclaw workspace backup >>>"
END_MARKER="# <<< openclaw workspace backup <<<"

mkdir -p "$LOG_DIR"

if [[ ! -x "$BACKUP_SCRIPT" ]]; then
  chmod +x "$BACKUP_SCRIPT"
fi

existing_crontab="$(crontab -l 2>/dev/null || true)"
filtered_crontab="$(
  printf '%s\n' "$existing_crontab" | awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  '
)"

new_entry="$SCHEDULE $BACKUP_SCRIPT >> $LOG_FILE 2>&1"

{
  if [[ -n "$filtered_crontab" ]]; then
    printf '%s\n' "$filtered_crontab"
    printf '\n'
  fi
  printf '%s\n' "$BEGIN_MARKER"
  printf '%s\n' "$new_entry"
  printf '%s\n' "$END_MARKER"
} | crontab -

printf 'Installed OpenClaw backup cron:\n%s\n' "$new_entry"
