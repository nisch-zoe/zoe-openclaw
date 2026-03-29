# LEARNINGS

## [LRN-20260221-001] best_practice

**Logged**: 2026-02-21T08:29:53+05:30
**Priority**: high
**Status**: pending
**Area**: config

### Summary
Sub-agent runs can finish without user-visible follow-up if the main session doesn’t explicitly harvest/relay results.

### Details
In this chat, a Codex 5.3 sub-agent produced useful artifacts (scripts/files) but didn’t send a final synthesized response back to the user automatically. The user experienced this as “I never hear back after subagents.”

This can happen when:
- The sub-agent continues exploring and never produces a clean final message.
- The parent session doesn’t poll/check the sub-agent session and summarize results.

### Suggested Action
When spawning a sub-agent:
1) Set a clear deliverable contract (“return final summary + next steps”), and a run timeout.
2) Add a parent-side follow-up step: check `sessions_list`/`sessions_history` for completion and immediately relay a concise summary.
3) If sub-agent stalls, either nudge it via `sessions_send` (“wrap up + deliver final answer”) or take over and summarize artifacts yourself.

### Metadata
- Source: conversation
- Related Files: (none)
- Tags: subagents, followup, reliability
---
