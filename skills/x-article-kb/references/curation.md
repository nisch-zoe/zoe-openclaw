# X Article Curation

Use this pass after `node scripts/x-articles.js fetch` and before `ingest`.

## What to keep

- Keep the author's argument, examples, structure, quotes, and useful links.
- Keep the article mostly intact.
- Preserve any metadata block that already exists at the top of the Markdown.

## What to trim

- Newsletter/course/product promos
- Follow/like/repost bait
- Sponsor blurbs
- Generic self-congratulatory filler
- Unrelated footer sections that do not help retrieval later

If unsure, preserve rather than over-trim.

## Classification rules

- Pick exactly one primary area:
  - `work`
  - `fitness`
  - `fence`
  - `content`
  - `learning`
  - `personal`
  - `other`
- Set `project` only when the article clearly maps to an active project like `fence` or `openclaw`.
- Use `tags` for short kebab-case retrieval labels.
- Use `topics` for 1-4 plain-language themes.

## Required metadata

- `area`
- `tags`
- `topics`
- `summary`
- `whyItMatters`
- `trimNotes`

`project` and `notes` are optional.

## Meta file template

```json
{
  "area": "learning",
  "project": "openclaw",
  "tags": ["game-theory", "decision-making", "ai-learning"],
  "topics": ["game theory", "strategic thinking", "AI-assisted study"],
  "summary": "Two to four sentences on the core ideas.",
  "whyItMatters": "Why this is worth keeping in OpenClaw.",
  "trimNotes": "What was removed and why.",
  "notes": "Optional retrieval hints or user-specific context."
}
```
