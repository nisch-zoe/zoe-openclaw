# MEMORY.md - Long-Term Memory

This file is your curated long-term memory. Think of it as an index to your detailed memory files, not a database.

**How to use this:**
- Keep it concise and organized
- Point to detail files when needed
- Update periodically as you learn and grow
- This loads **ONLY in main session** (private DMs with Nisch)

---

## About Nisch

- **Name**: Nisch
- **Role**: Full-time Software Engineer & Artist
- **Goals**: Build useful products for personal use and revenue without sacrificing health or job stability
- **Style**: Prefers pragmatic, focused work; values creativity mixed with tech; wants low-friction systems

See: `USER.md` for full profile

---

## System
- **Tasks**: `node scripts/db.js tasks`
- **Activity log**: `node scripts/db.js activity`
- **Ideas**: `node scripts/ideas.js list`
- **Operational state**: `PULSE.md`
- **Area context**: `../knowledge/areas/<area>/overview.md`
- **Project context**: `../knowledge/projects/<slug>/overview.md`

---

## Projects

### Expense Tracker iOS
- Details: `../knowledge/projects/fence/overview.md`
- **Marketing Campaign**: `../knowledge/projects/fence/marketing/overview.md`
- Status: Active development complete. Marketing phase starting fresh (2026-03-14).
- Strategy: First week focuses on building credibility without mentioning the product (iOS shortcuts, finance automations, build-in-public, AI-related posts).
- Channels: X, LinkedIn, Reddit.

### Zoe Manager Layer
- Goal: evolve Zoe from a passive assistant into an active personal manager
- Core behaviors:
  - daily prioritization
  - adaptive follow-up
  - idea capture without forcing task creation
  - empathy around work load, sleep, and fitness
- Durable context:
  - `../knowledge/projects/openclaw/overview.md`
- Live system:
  - `PULSE.md`
  - `state/ideas.json`
  - `../knowledge/areas/`
  - `../data/openclaw.db`

---

## Preferences

- Build things that create value
- Tech + creativity blend
- Favor action over endless planning
- Telegram is the primary interface
- Low-friction local capture beats any workflow that depends on phone admin
- Growth includes work, fitness, products, personal life, and learning
- Plans should adapt to sleep, recovery, and work pressure instead of staying rigid
- Not every idea should become a task
- **Model providers**: ALWAYS use `google-gemini-cli/<model>` (1st priority), `google-antigravity/<model>` (fallback), or `openai-codex/<model>` (OpenAI models) — all use Nisch's existing subscriptions, no extra API cost. Use `openai-codex/gpt-5.3-codex` with high thinking for heavy reasoning tasks. See `CODING.md` for full routing strategy.

---

## Important Dates

- **2026-03-28**: Cut over Zoe's manager loop to the v2 local stack: `PULSE.md` for operational state, SQLite for tasks and activity, and `../knowledge/` for durable context.

---

## Lessons Learned

- If a system requires manual phone upkeep to stay trustworthy, it will become the bottleneck.
- Preserve raw ideas separately from executable tasks.
- Cheap models can work if the system does the structuring first.

---

## Notes

- Daily logs: `memory/YYYY-MM-DD.md`
- Always check yesterday + today on session start for continuity
- Weekly reviews live in `memory/weekly/`
