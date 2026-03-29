# Fence HQ Notion Migration Plan (Executed)

Date: 2026-02-17
Owner: OpenClaw subagent (codex-5.3-notion-migration)

## Scope
Migrate product + marketing source-of-truth context from local workspace into existing Notion **Fence HQ** and seed daily-operational tracking.

## Plan
1. **Normalize DB schemas** for Projects / Tasks / Content Calendar / Daily Log to support practical operations.
2. **Upsert Projects** from local source files:
   - `memory/project-fence.md`
   - `memory/project-fence-marketing.md`
   - `memory/active-tasks.md`
3. **Seed Tasks** from weekly plan + current blockers.
4. **Seed Content Calendar** from campaign weekly plan + draft assets.
5. **Seed Daily Log** with baseline campaign day and migration day.
6. **Add sync scripts** for recurring push/pull/check-in workflow.
7. **Run migration twice** to confirm idempotency.

## Executed Steps
- ✅ Added/updated DB properties across all 4 Notion databases.
- ✅ Upserted 3 Project rows:
  - `project:fence-ios-core`
  - `project:fence-marketing-launch`
  - `project:fence-hq-ops`
- ✅ Seeded 16 Tasks rows (including blockers and completed strategic artifacts).
- ✅ Seeded 12 Content Calendar rows for 2026-02-18 → 2026-02-27.
- ✅ Seeded 2 Daily Log rows:
  - 2026-02-13 campaign baseline
  - 2026-02-17 migration check-in
- ✅ Synced local active task tracker into Notion (`memory/active-tasks.md`).
- ✅ Exported live Notion Tasks snapshot to `memory/notion/tasks.md`.
- ✅ Implemented `scripts/notion-sync.js` + usage docs.
- ✅ Re-ran migration to verify idempotent upserts by `External ID`.

## Current Totals in Notion
- Projects: 3
- Tasks: 16
- Content Calendar: 12
- Daily Logs: 2

## Known Live Blockers Captured
- App name not finalized
- Mac/Xcode validation pending for PR-1..PR-8
- GitHub auth required to create private `fence-marketing` repo and add collaborator
