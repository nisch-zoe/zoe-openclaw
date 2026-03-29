#!/usr/bin/env bash
set -euo pipefail

PATH="/home/zoe/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENCLAW_HOME="$(cd "$WORKSPACE_DIR/.." && pwd)"
LOCK_DIR="$OPENCLAW_HOME/run"
LOCK_FILE="$LOCK_DIR/backup-openclaw.lock"

mkdir -p "$LOCK_DIR" "$OPENCLAW_HOME/logs"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Backup skipped: another run is still active."
  exit 0
fi

if ! git -C "$WORKSPACE_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "Backup failed: $WORKSPACE_DIR is not a git repository."
  exit 1
fi

if ! git -C "$WORKSPACE_DIR" config user.name >/dev/null 2>&1; then
  log "Backup failed: git user.name is not configured."
  exit 1
fi

if ! git -C "$WORKSPACE_DIR" config user.email >/dev/null 2>&1; then
  log "Backup failed: git user.email is not configured."
  exit 1
fi

if [[ -z "$(git -C "$WORKSPACE_DIR" status --porcelain --untracked-files=all)" ]]; then
  log "Nothing to backup."
  exit 0
fi

git -C "$WORKSPACE_DIR" add -A

if git -C "$WORKSPACE_DIR" diff --cached --quiet --exit-code; then
  log "Nothing to backup after staging."
  exit 0
fi

commit_stamp="$(date '+%Y-%m-%d %H:%M:%S %z')"
git -C "$WORKSPACE_DIR" commit -m "backup: $commit_stamp"
log "Created backup commit."

if git -C "$WORKSPACE_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
  git -C "$WORKSPACE_DIR" push
  log "Pushed backup via configured upstream."
  exit 0
fi

push_remote="${OPENCLAW_BACKUP_REMOTE:-}"
if [[ -z "$push_remote" ]]; then
  if git -C "$WORKSPACE_DIR" remote get-url origin >/dev/null 2>&1; then
    push_remote="origin"
  else
    mapfile -t remotes < <(git -C "$WORKSPACE_DIR" remote)
    if [[ "${#remotes[@]}" -eq 1 ]]; then
      push_remote="${remotes[0]}"
    fi
  fi
fi

if [[ -z "$push_remote" ]]; then
  log "No remote configured; kept the commit locally."
  exit 0
fi

push_branch="${OPENCLAW_BACKUP_BRANCH:-}"
if [[ -z "$push_branch" ]]; then
  push_branch="$(git -C "$WORKSPACE_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
fi

if [[ -z "$push_branch" ]]; then
  log "No branch name available for push; kept the commit locally."
  exit 0
fi

git -C "$WORKSPACE_DIR" push "$push_remote" "HEAD:refs/heads/$push_branch"
log "Pushed backup to $push_remote/$push_branch."
