# Notion Sync Archive (Fence HQ)

Historical compatibility tooling for the pre-local OpenClaw workflow.

This is no longer part of the active manager loop. Use the local stack first:

- `../data/openclaw.db` for tracked work
- `../knowledge/` for durable context
- `workspace/state/` for the live manager loop

Reach for this archive only when:

- you need to inspect old Notion data directly
- you need to compare the old Notion task set against the local DB
- the one-time migration path needs to be rerun

## Prerequisites

- Node.js 18+ (workspace has Node 22)
- Notion integration API key via any one of:
  - `NOTION_API_KEY`
  - `LIFEOS_NOTION_API_KEY`
  - `OPENCLAW_NOTION_API_KEY`
  - `NOTION_API_KEY_FILE`
  - `~/.config/notion/api_key`
- Integration must have access to the legacy Fence HQ page and related databases

## Commands

Run from `workspace/`:

```bash
node archive/scripts/notion-sync.js open-tasks --json
```

- Dumps normalized legacy Notion open-task rows for comparison or recovery

```bash
node archive/scripts/notion-sync.js pull-tasks
# or custom output path
node archive/scripts/notion-sync.js pull-tasks archive/memory/notion/tasks.md
```

- Writes a markdown snapshot filtered to tasks owned by Zoe

```bash
node archive/scripts/notion-sync.js migrate
```

- Rebuilds the historical Notion structures
- Writes snapshots into `archive/memory/notion/`

Other legacy commands still exist:

- `push-tasks`
- `daily-checkin`
- `sync-from-state`
- `setup-assignees`
- `setup-landing-page-project`

Use those only for historical repair or comparison work.

## Archive Outputs

- `archive/memory/notion/tasks.md`
- `archive/memory/notion/migration-summary.json`
- other preserved historical snapshots under `archive/memory/notion/`

## Idempotency / Safety

- Every seeded entry uses `External ID` so repeated runs update existing rows.
- No destructive delete/archive operations are performed.
- Existing rows without matching `External ID` are left untouched.
- `pull-tasks` exports only rows where `Executor = Zoe`.
