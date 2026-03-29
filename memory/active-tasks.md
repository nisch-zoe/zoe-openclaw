# Active Tasks

Track ongoing work to enable crash recovery. Update this file when you start, pause, or complete tasks.

## Format

```
## Task: [Brief Description]
- **Status**: [in-progress | waiting | completed | failed]
- **Started**: [YYYY-MM-DD HH:MM]
- **Last Update**: [YYYY-MM-DD HH:MM]
- **Subagent**: [session key if applicable]
- **Next Step**: [What to do next]
- **Notes**: [Context for resuming]
```

## Current Tasks

_No active tasks._

---

**Instructions for the agent:**
- When starting a new task, add an entry here
- When spawning a subagent, note its session key
- When a task completes, update status to `completed` and timestamp
- When gateway restarts, BOOT.md reads this file to resume work
