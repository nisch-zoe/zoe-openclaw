---
name: workout-capture
description: Capture gym, swim, run, and other workout updates from chat into the local OpenClaw workout tracker, including multi-turn follow-ups. Use when the user says they worked out, mentions gym/swim/run/lifts/sets/reps/distance, or reports what they did physically today.
---

# Workout Capture

Use the local workout tracker for real completed sessions, not vague intentions.

Primary surfaces:

- durable history: `../data/openclaw.db`
- helper commands: `workspace/scripts/workouts.js`
- pending follow-up state: `workspace/state/workout-drafts.json`
- playbook: `../knowledge/reference/playbooks/workout-tracking.md`

## Default workflow

1. Decide whether the message is:
   - a completed workout worth logging
   - a plan/intention only
   - a follow-up answer to an existing workout draft
2. Read existing open drafts if the conversation looks mid-capture:
   ```bash
   node scripts/workouts.js draft:list --status open --json
   ```
3. Extract whatever is already known:
   - `date`
   - `sessionType`
   - `title`
   - `summary`
   - `durationMinutes`
   - `exercises`
   - useful extra context in `metadata`
4. If critical fields are still missing, save or update a draft and ask one concise follow-up.
5. When the session is good enough, record it.

## Minimum bar before recording

Record once you have:

- `date`
- `sessionType`
- `summary`
- at least one structured anchor:
  - `durationMinutes`
  - one or more `exercises`
  - a quantitative metric in `metadata`

If the message already clears that bar, do not interrogate the user for more.

## What to ask back for

Ask only for things that materially improve trust or later analysis:

- the date if not clearly today or explicit
- the session type if unclear
- one structured anchor if the workout is too vague to be useful later

Good follow-up style:

- "Nice. Roughly how long were you there, or what were the main lifts?"
- "Was that gym, swim, or something else?"
- "Was this today or yesterday?"

Avoid admin sludge:

- do not demand exact sets if the user did not track them
- do not ask for every accessory
- do not force a template back onto Telegram

## Draft command

Write a draft JSON payload and save it:

```bash
node scripts/workouts.js draft:save --file "<draft.json>" --json
```

Keep the draft session partial. Preserve the raw user message in `rawMessages` and `session.rawText`.

## Record command

Write a final session JSON payload and record it:

```bash
node scripts/workouts.js record --file "<session.json>" [--draft-id "<draft-id>"] --json
```

By default this also mirrors a short fitness entry into the general activity log, so weekly summaries can still see that training happened.

## Modeling rules

- Put stable session-level fields at the top level.
- Put changing extra fields in `metadata`.
- Put exercise-specific detail inside each exercise entry.
- If an exercise has non-standard fields, keep them. The helper stores unknown fields in `payload_json`.
- Preserve rough wording if that is the only honest signal available.

## Examples

Message:
`Gym done. Push day. Bench, incline DB, shoulder press. About 70 mins.`

Likely result:

- `date`: today
- `sessionType`: `gym`
- `title`: `push day`
- `durationMinutes`: `70`
- `exercises`: `Bench Press`, `Incline Dumbbell Press`, `Shoulder Press`

Message:
`Went swimming this morning`

Likely action:

1. save a draft
2. ask one short follow-up for duration, laps, distance, or the kind of swim

See `../knowledge/reference/playbooks/workout-tracking.md` for the fuller data shape and examples.
