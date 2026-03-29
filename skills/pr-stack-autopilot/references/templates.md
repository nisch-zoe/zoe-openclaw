# Templates

## A) PR worker spawn prompt template

```text
Repository: <repo_path>
Implement PR-<n> in stack order.

Branching:
- Create branch `<branch>` from `<base_branch>`.

Scope:
- <bullet 1>
- <bullet 2>
- <bullet 3>

Constraints:
- Keep scope strict to this PR.
- Add/update tests even if build tools are unavailable.
- Do not refactor unrelated areas.

Deliverables:
- Commit(s) on `<branch>`.
- Summary of changed files and behavior.
- Exact push + PR commands with base `<base_branch>`.

When completely finished, run:
openclaw system event --text "Done PR<n>: <short description>" --mode now
```

## B) Fallback watchdog cron payload template

```text
Fallback orchestrator for <repo_path>.

Goal: keep PR stack moving if idle.

Rules:
1) Check active subagent sessions for PR workers (active window ~25 min).
2) If active worker exists: NO_REPLY.
3) If idle: detect next pending PR in order and spawn it.
4) Avoid duplicate spawns by checking recent runs/events.
5) After spawning, send short status to main session.
6) If all PRs complete, send one completion message and remain silent.
```
