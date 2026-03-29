# ERRORS

## [ERR-20260221-001] cron.run gateway timeout

**Logged**: 2026-02-21T16:50:00+05:30
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
`cron.run` tool call timed out (60s and 180s) even though `openclaw status` shows Gateway RPC probe OK.

### Context
- Tool: functions.cron (run)
- JobId: 0b2a5fcd-b618-4bc7-950b-36a14e617b0f
- Error: "gateway timeout after ...ms" while Gateway RPC probe is ok.

### Suggested Fix
Investigate gateway RPC routing for tool calls vs CLI probe; confirm gatewayUrl/token config used by tool layer, and check gateway logs around the call.

### Metadata
- Reproducible: unknown
- Related Files: ~/.openclaw/openclaw.json
- Tags: gateway, cron, timeout
---
