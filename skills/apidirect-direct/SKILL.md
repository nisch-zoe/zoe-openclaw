---
name: apidirect-direct
description: Query API Direct directly for Twitter/X trends and post search, Instagram post search, and LinkedIn post search without going through `workspace/scripts/research.js`. Use when the user wants ad hoc API Direct lookups, raw endpoint responses, quick query experiments, one-off cross-platform checks, or direct trend validation.
---

# API Direct Direct

Use this skill for exploratory or one-off API Direct calls. Keep it direct: hit the endpoint, inspect the response, summarize the signal.

## Use This Instead Of `research-pipeline` When

- the user wants a one-off search or raw JSON
- the user wants to test a new query before adding it to config
- the user wants to compare one topic across X, Instagram, and LinkedIn
- the user wants current X trends for a location

Use `research-pipeline` instead when:

- the user wants dated reports under `knowledge/reference/research/`
- the user wants content-pillar scoring, overlay, or draft alignment
- the user wants a repeatable scan or archived snapshot flow

## Auth

Resolve the API key in this order:

1. `APIDIRECT_API_KEY`
2. `~/.openclaw/credentials/apidirect-api-key.txt`
3. `~/credentials/apidirect-api-key.txt`
4. `knowledge/reference/research/config.json` -> `apiDirect.apiKey`

Never print the full key in chat, logs, or saved files.

## Default Working Style

1. Start with the smallest useful call:
   - `pages=1` for X and Instagram
   - `page=1` for LinkedIn
   - one `woeid` for X trends
2. Use `sort_by=relevance` for discovery and `sort_by=most_recent` for freshness.
3. Summarize the top results and the estimated request cost after each call.
4. Only expand to more pages or more endpoints if the first call is useful.
5. Do not create research report files unless the user asks.

## Tracking Model

- **Twitter/X** supports real live trends and post search.
- **Instagram** is better treated as high-signal topic-lane monitoring, not a global trends feed.
- **LinkedIn** is also better treated as high-signal public post search, not a clean global trends feed.

Be explicit about that distinction in answers. Do not call Instagram or LinkedIn results "global trends" unless the data actually supports that claim.

## Endpoint Quick Picks

- X live trends: `/v1/twitter/trends` with `woeid=1` (Worldwide) or `23424848` (India)
- X post search: `/v1/twitter/posts`
- Instagram post search: `/v1/instagram/posts`
- LinkedIn post search: `/v1/linkedin/posts`

Read `endpoints.md` for field notes and direct request templates.

## Common Patterns

### Quick X trends check

Use when the user asks "what's trending on X?" or wants location-specific trend topics.

Return:

- top 5-10 trend names
- any obvious relevance to current content pillars
- a note if the trends are mostly current-events/noise rather than useful content input

### Cross-platform topic check

Use when the user asks whether a topic is hot across platforms.

Recommended sequence:

1. X posts with `sort_by=relevance`
2. Instagram posts
3. LinkedIn posts

Then compare:

- how much engagement the results show
- recurring framing or narrative patterns
- whether the topic looks durable, noisy, or worth a content draft

### Raw endpoint inspection

If the user wants the raw API response, return the JSON or a filtered subset.
If not, summarize the important fields instead of dumping the whole payload.

## Cost Guardrails

- X trends: `$0.006/request`
- X posts: `$0.006/page`
- Instagram posts: `$0.006/page`
- LinkedIn posts: `$0.006/request`
- Free tier: 50 requests per endpoint per month
- Concurrency limit: 3 simultaneous requests per endpoint

For exploratory work, default to 1-3 total requests unless the user asks for broader coverage.

## Output Style

When answering from direct API calls, prefer:

- what was queried
- what came back
- why it matters
- whether the signal is actually useful or just noisy

## Examples

- "Check API Direct directly for local-first app chatter on X and LinkedIn."
- "Use API Direct, not the research pipeline. Show me raw JSON for X trends in India."
- "Test whether `build in public indie` still has signal across X, Instagram, and LinkedIn."
- "Pull the top Instagram posts for `fintech india startup` directly from API Direct."
