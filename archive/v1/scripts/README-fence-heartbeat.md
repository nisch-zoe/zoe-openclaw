# Fence Heartbeat Checks (GitHub + Local DB)

Low-token scripted checks for Fence project updates with repeat suppression.

## Files

- `scripts/fence-heartbeat-check.js` — checker script
- `memory/heartbeat/fence-state.json` — persistent dedupe state
- `HEARTBEAT.md` — calls the script during heartbeat turns

## Live default

The active heartbeat loop is local-first:

- GitHub for repo activity
- the local task DB at `../data/openclaw.db` for due-today and recently changed open tasks

Historical Notion checks still exist as an explicit fallback mode, but they are no longer part of `heartbeat` or `all`.

## What It Checks

### GitHub (via `gh api`)

Default repos:

- `nisch-zoe/fence-marketing`
- `nishchay-v/expense-tracker-ios`
- `nishchay-v/expense-tracker-landing`

Signals:

- new issues created since the last check
- new PRs created since the last check
- CI failures since the last check
- mentions from GitHub notifications

Performance note:

- `heartbeat` mode runs a faster GitHub check and skips CI-failure scanning to avoid long stalls.
- Tune command timeouts with:
  - `FENCE_GH_TIMEOUT_MS` (default `15000`)
  - `FENCE_GH_HEARTBEAT_TIMEOUT_MS` (default `15000`)

### Local task DB

Source: `../data/openclaw.db` through `scripts/db.js`

Signals:

- open tasks due today
- open tasks updated since the last heartbeat check

### Historical Notion fallback

Use this only when you need to compare against the pre-cutover source or suspect the local DB missed something.

Signals:

- legacy tasks due today
- legacy tasks changed since the last check

## Usage

```bash
# GitHub only
node scripts/fence-heartbeat-check.js github

# Local DB only
node scripts/fence-heartbeat-check.js local

# Active default: GitHub + local DB
node scripts/fence-heartbeat-check.js all

# Heartbeat mode: prints HEARTBEAT_OK if no updates
node scripts/fence-heartbeat-check.js heartbeat

# Historical fallback only
node scripts/fence-heartbeat-check.js notion

# JSON output
node scripts/fence-heartbeat-check.js all --json
```

## Optional overrides

```bash
# custom state path
node scripts/fence-heartbeat-check.js all --state memory/heartbeat/custom.json

# custom repo list
node scripts/fence-heartbeat-check.js github --repos owner1/repo1,owner2/repo2

# env override for repos
export FENCE_GH_REPOS="owner1/repo1,owner2/repo2"

# env override for legacy Notion tasks DB (fallback mode only)
export FENCE_NOTION_TASKS_DB_ID="<notion-db-id>"
# aliases also supported:
# export LIFEOS_NOTION_TASKS_DB_ID="<notion-db-id>"
# export NOTION_TASKS_DB_ID="<notion-db-id>"
```

## Prereqs

```bash
# GitHub CLI auth
gh auth status

# local foundation available
node scripts/db.js summary --json

# Notion auth (only if you run the fallback `notion` mode)
# - NOTION_API_KEY
# - LIFEOS_NOTION_API_KEY
# - OPENCLAW_NOTION_API_KEY
# - NOTION_API_KEY_FILE
# - ~/.config/notion/api_key
```

## Model routing note (heartbeat vs cron)

OpenClaw heartbeats can use a different model than the session default by setting:

```bash
openclaw config set agents.defaults.heartbeat.model openai-codex/gpt-5.1-codex-mini
```

If you prefer strict isolation anyway, use cron isolated jobs with model override:

```bash
openclaw cron add \
  --name "Fence heartbeat checks" \
  --every "30m" \
  --session isolated \
  --message "Run node scripts/fence-heartbeat-check.js heartbeat and report only output." \
  --model "openai-codex/gpt-5.1-codex-mini" \
  --announce \
  --channel telegram \
  --to "<chat-id>"
```

If your config uses the alias `openai-codex/gpt-5.1-mini`, substitute it for `openai-codex/gpt-5.1-codex-mini`.
