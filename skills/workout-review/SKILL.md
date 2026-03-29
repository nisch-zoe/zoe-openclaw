---
name: workout-review
description: Query workout history, exercise frequency, and recent fitness patterns from the local OpenClaw workout tracker. Use when the user asks what they trained, how consistent they have been, what they last did for an exercise, or wants workout summaries over days, weeks, or months.
---

# Workout Review

Use the local workout tracker for history and pattern questions. Prefer this over scanning chat memory when the question is about actual logged training.

Primary commands:

```bash
node scripts/workouts.js summary --days 30 --json
node scripts/workouts.js list --days 14 --json
node scripts/workouts.js exercise --name "bench press" --limit 10 --json
node scripts/workouts.js show --id "<session-id>" --json
```

## What each command is for

- `summary`: session count, duration, by-type mix, top exercises
- `list`: recent sessions in time order
- `exercise`: last logged entries for one movement
- `show`: full detail for one session

## How to answer

1. Start with the direct answer.
2. Mention the time range you used.
3. Flag any obvious caveat if the data is sparse or rough.
4. If helpful, offer one light coaching observation, not a lecture.

## Example questions

- `How many times did I work out this month?`
- `What did I last do for bench press?`
- `How has swimming looked recently?`
- `Have I been consistent the last two weeks?`

## Notes

- The activity log may mention fitness too, but the workout tables are the source of truth for workout detail.
- Rough sessions still count. If some logs are lighter on detail, say so instead of pretending the data is richer than it is.
- For broader life coaching, combine the workout answer with `workspace/PULSE.md` and `knowledge/areas/fitness/overview.md`.
