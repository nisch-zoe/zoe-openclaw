---
name: pr-stack-autopilot
description: Ship a coding sprint as a chained PR stack without idle gaps. Use when the user wants sequential PR delivery (PR-1, PR-2, ...), automatic next-task triggering on completion, and a fallback watchdog that resumes work if the chain stalls.
---

# PR Stack Autopilot

Drive implementation as a strict branch stack with two control loops:
1) **Primary loop:** completion-event chaining (spawn next PR immediately when current PR is done)
2) **Fallback loop:** cron watchdog (only if chain stalls)

## Inputs to lock before starting

- Repo path
- Ordered PR list with branch names and base branch for each PR
- Definition of done per PR (scope, tests expected, completion event text)
- User update preference (milestones only)

## Execution protocol

### 1) Create the stack plan

Document this table before coding:
- PR index
- branch
- base branch
- scope summary
- test expectations
- completion event string (`Done PRx: ...`)

### 2) Start PR-1 worker

Spawn a coding worker with:
- explicit branch/base instructions
- strict scope limits
- requirement to add tests even if local execution is unavailable
- required final event command:
`openclaw system event --text "Done PRx: ..." --mode now`

### 3) Chain on completion events (primary loop)

When a completion event arrives:
- acknowledge with brief user update (1-2 lines)
- immediately spawn the next PR worker in sequence
- keep one active PR worker at a time unless user asks for parallelism

### 4) Run watchdog fallback (secondary loop)

Create an isolated cron job every 10 minutes to prevent idle gaps.

Watchdog behavior:
- check for active PR worker sessions
- if active: do nothing (`NO_REPLY`)
- if idle and pending PR exists: spawn next pending PR worker and send brief status
- avoid duplicate spawns (check active/recent sessions and done events)

Use lightweight model for watchdog turns.

### 5) Communication discipline

Send updates only when:
- a PR starts
- a PR finishes
- blocked on user decision/credentials
- error requiring intervention

Avoid noisy “still working” chatter unless user asked for heartbeat-style updates.

### 6) Closeout

After final PR in stack is complete:
- remove/disable watchdog cron
- send final summary with:
  - branch order
  - merge order
  - known manual setup steps
  - unresolved blockers

## Safety/quality rules

- Keep each PR tightly scoped to reduce merge conflicts.
- Do not let missing local toolchain block forward progress; add tests anyway and mark execution deferred.
- Keep branch base chain linear: each PR based on previous PR branch unless explicitly requested otherwise.
- If a worker hangs/fails, respawn once with clarified instructions before escalating.

## Optional templates

Use `references/templates.md` for copy-paste worker prompt and watchdog payload skeletons.
