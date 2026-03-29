---
name: x-article-kb
description: Convert X/Twitter articles, tweets, and threads to Markdown via xtomd.com, curate them into the local OpenClaw X article library, and retrieve stored article knowledge later. Use when the user shares x.com or twitter.com links, wants to save/archive/add an article, sends a bare X link, or asks to search/summarize wisdom from previously saved X articles.
homepage: https://xtomd.com/
---

# x-article-kb

This skill manages the local X article library at `../knowledge/reference/x-articles/`.

## Default behavior

If the user sends a bare X/Twitter link with no extra instruction, default to:

1. converting it through `xtomd`
2. saving it into the local library
3. returning a short summary plus the chosen tags

Only skip saving when the user explicitly wants a one-off read.

## New article workflow

1. Run:
   ```bash
   node scripts/x-articles.js fetch --url "<x-url>" --json
   ```
2. Read the generated `raw.md` file from the returned temp dir.
3. Curate the article using [curation.md](references/curation.md).
4. Write two temp files inside the same temp dir:
   - `cleaned.md` with the trimmed article
   - `meta.json` with the curation metadata
5. Ingest it:
   ```bash
   node scripts/x-articles.js ingest --source-json "<sourceJsonPath>" --raw-markdown "<rawMarkdownPath>" --clean-markdown "<tmpDir>/cleaned.md" --meta "<tmpDir>/meta.json" --json
   ```
6. Return:
   - where it was saved
   - the short summary
   - the chosen area, project, tags, and topics

Use heredocs when writing `cleaned.md` and `meta.json`.

## Retrieval workflow

When the user wants relevant wisdom from saved X articles:

1. Search first:
   ```bash
   node scripts/x-articles.js search --query "<query>" --limit 5 --json
   ```
2. Read the most relevant `overview.md`, `article.md`, and `research.md` files.
3. Synthesize only from the relevant saved entries.
4. Mention which stored articles you relied on.

## Duplicate handling

- `fetch` may report an existing saved entry.
- `ingest` updates the existing entry when the URL is already stored.
- If the user wants recall rather than a fresh save, prefer the stored copy.

## Notes

- Always use `xtomd` before reading a new X/Twitter article link.
- Keep the original signal in `source.md`.
- Keep the cleaned copy in `article.md`.
- Prefer OpenClaw areas: `work`, `fitness`, `fence`, `content`, `learning`, `personal`, `other`.
