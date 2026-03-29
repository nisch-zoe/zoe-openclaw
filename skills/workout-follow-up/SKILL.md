---
name: workout-follow-up
description: Check for stale or missing fitness updates and nudge briefly using the local workout tracker and draft state. Use during morning planning, evening wrap-up, or heartbeat-style follow-ups when gym/swim/workout status matters and the fitness signal is missing.
---

# Workout Follow-Up

Use this skill when fitness matters but the workout signal is missing, stale, or half-captured.

Primary surfaces:

- `workspace/PULSE.md`
- `knowledge/areas/fitness/overview.md`
- `workspace/state/workout-drafts.json`
- `workspace/scripts/workouts.js`

## Default workflow

1. Check if there is an open workout draft:
   ```bash
   node scripts/workouts.js draft:list --status open --json
   ```
2. If a relevant draft exists, ask only the pending question or a tighter version of it.
3. If there is no draft and the day genuinely needs a fitness check:
   - ask one short question like `Gym, swim, or rest today?`
4. If the user replies with real session details, switch to `workout-capture`.

## When to use this

- Evening wrap-up and there is still no clear fitness update
- Morning or daytime follow-up when a stale fitness signal is relevant
- Swim-class days when a quick check could help and there is no recent update
- A prior workout capture is incomplete and needs one more answer

## When not to use this

- Quiet hours or explicit rest mode
- Repeating the same ask too soon
- When the user already gave a meaningful workout update today
- When the check-in would be generic nagging

## Good nudge style

- `Gym, swim, or rest today?`
- `Did training happen, or was today a rest day?`
- `You mentioned the gym earlier. What were the main lifts, and I’ll log it.`

Keep it short. One question. No form.

## Draft discipline

- Drafts are for temporary uncertainty, not permanent storage.
- If the user never answers, leave the draft open until it is clearly stale or irrelevant.
- If the draft becomes irrelevant, discard it instead of recording garbage:
  ```bash
  node scripts/workouts.js draft:discard --id "<draft-id>" --json
  ```

See `../knowledge/reference/playbooks/workout-tracking.md` for the capture rules behind this follow-up behavior.
