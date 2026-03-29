---
name: x-article-research
description: Fact-check, extend, and research topics from X/Twitter articles after first converting them through xtomd.com. Use when the user shares x.com or twitter.com links and asks for a fact-check, deeper research, supporting or contradicting evidence, broader synthesis, or follow-up reading.
homepage: https://xtomd.com/
---

# x-article-research

This skill builds on the local X article library at `../knowledge/reference/x-articles/`.

## Always start with conversion

For every new X/Twitter link:

1. Run:
   ```bash
   node scripts/x-articles.js fetch --url "<x-url>" --json
   ```
2. Read the generated `raw.md`.
3. If the article is not already stored and the user did not explicitly ask for an ephemeral one-off, ingest it first using the `x-article-kb` workflow.

Do not skip the `xtomd` conversion step.

## Research workflow

1. Separate the author's original claims from your verification.
2. Verify concrete facts, dates, numbers, and causal claims.
3. Search for supporting evidence, contradictions, missing context, and newer developments.
4. Be explicit when a claim remains unverified.
5. Keep original article content separate from outside research.

## Save durable output

1. Write a temporary `research.md` file using [output-format.md](references/output-format.md).
2. Attach it to the stored article:
   ```bash
   node scripts/x-articles.js attach-research --slug "<slug>" --file "<tmpDir>/research.md" --json
   ```
   You can use `--url` instead of `--slug` if needed.
3. Return the main findings and saved path.

## Guardrails

- Never skip `xtomd` for a new article link.
- Never mix the author's claims with your outside verification notes.
- If the user only wants a quick summary, use `x-article-kb` behavior instead of a full research pass.
