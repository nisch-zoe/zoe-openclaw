---
name: research-pipeline
description: Run OpenClaw research pipelines (competitor-pulse, content-trends, reddit-listen, social-trends, full-scan) that monitor competitors, surface trending content, detect Reddit signals, and track social media trends via API Direct for Fence and content strategy. Use when the user asks to run research, check competitors, find content ideas, scan Reddit, check social trends, get a market pulse, or wants a research digest sent to Telegram.
---

# research-pipeline

Hybrid research system: deterministic scoring + LLM analysis prompts. Two tiers of data sources:

**Free tier** (no API key): Reddit, HN, dev.to, App Store (India)
**Paid tier** (API Direct, ~$0.006/request): Twitter/X, Instagram, LinkedIn

Both tiers use the same content pillar scoring, intent classification, and output format.

## Quick reference

| Pipeline | What it does | Cost |
|---|---|---|
| `competitor-pulse` | App Store metadata, Reddit/HN mentions for tracked competitors | Free |
| `content-trends` | Trending posts scored against content pillars, pillar heat map | Free |
| `reddit-listen` | Keyword monitoring, intent classification, competitor mention detection | Free |
| `social-trends` | Twitter/X, Instagram, LinkedIn search via API Direct | ~$0.006/req |
| `full-scan` | All pipelines (social-trends auto-included when API key present) | Mixed |

Script: `node workspace/scripts/research.js <pipeline>`
Config: `knowledge/reference/research/config.json`

## API Direct setup

Social-trends requires an API Direct key. Three ways to provide it:

1. **Env var**: `export APIDIRECT_API_KEY=your_key`
2. **Credentials file**: save the raw key to `credentials/apidirect-api-key.txt`
3. **Config**: add `"apiDirect": { "apiKey": "your_key" }` to config.json

Sign up (free, no card): https://apidirect.io/signup
50 free requests per endpoint per month.

## Running a scan

```bash
# Free pipelines (no API key needed)
node workspace/scripts/research.js competitor-pulse
node workspace/scripts/research.js content-trends
node workspace/scripts/research.js reddit-listen

# Paid pipeline (requires API Direct key)
node workspace/scripts/research.js social-trends

# Paid pipeline with content overlay
node workspace/scripts/research.js social-trends --content-mode overlay

# Everything (social-trends included when key is present, skipped if not)
node workspace/scripts/research.js full-scan

# Raw JSON output
node workspace/scripts/research.js full-scan --json
```

Expect ~2 minutes for `full-scan` without social-trends, ~3 minutes with.

## What social-trends actually tracks

- **Twitter/X**: live trend topics for configured WOEIDs plus top posts in strategic query lanes
- **Instagram**: top high-engagement posts in strategic query lanes
- **LinkedIn**: top public posts in strategic query lanes

This is intentionally mixed:
- X gives us real trend topics
- Instagram and LinkedIn are better treated as "high-signal lane monitoring"
- the output still lands in one unified report so content strategy can use it

## Content integration modes

- `separate` (default): research stays in `knowledge/reference/research/social-trends/`
- `overlay`: also writes `knowledge/content/TREND-ALIGNMENT.md` and `workspace/state/content-hub/trend-alignment.json`

Use `overlay` when you want current trends to steer what gets written next. Keep `separate` when you want evergreen or conviction-led content without trend pressure.

## Output locations

Reports land in `knowledge/reference/research/<pipeline>/YYYY-MM-DD.md` with a `latest.md` symlink.
Raw JSON snapshots go to `knowledge/reference/research/snapshots/<pipeline>-YYYY-MM-DD.json`.

| Pipeline | Report path | Snapshot path |
|---|---|---|
| competitor-pulse | `knowledge/reference/research/competitor-pulse/` | `knowledge/reference/research/snapshots/competitor-pulse-*.json` |
| content-trends | `knowledge/reference/research/content-trends/` | `knowledge/reference/research/snapshots/content-trends-*.json` |
| reddit-listen | `knowledge/reference/research/reddit-signals/` | `knowledge/reference/research/snapshots/reddit-listen-*.json` |
| social-trends | `knowledge/reference/research/social-trends/` | `knowledge/reference/research/snapshots/social-trends-*.json` |

## Reading and synthesizing results

After running a scan:

1. Read the generated `.md` reports (not the JSON snapshots — those are for archival).
2. Each report ends with an **LLM Analysis Prompt** section. Use it to synthesize strategic insights.
3. When synthesizing, focus on:
   - Actionable signals (not noise)
   - Cross-pipeline patterns (a Reddit pain point + competitor gap + content pillar match = high-value signal)
   - Time-sensitive opportunities (trending HN posts, new competitor versions, viral Reddit threads)

## Composing a Telegram digest

When asked to send results or a digest:

1. Run the scan (or read existing `latest.md` reports if recent enough).
2. Synthesize a compact digest covering:
   - **Competitor moves**: version updates, rating changes, new entrants
   - **Top signals**: highest-value Reddit/HN threads with why they matter
   - **Content heat**: which pillar is hottest, 2-3 concrete content ideas
   - **Action items**: posts worth engaging with, product insights to capture
3. Keep the digest under 2000 characters for Telegram readability.
4. Send via:
   ```bash
   openclaw message send -m "<digest>" -t "6310677934" --channel telegram
   ```
5. If the digest is too long, split into 2 messages: market intel first, content opportunities second.

## Digest format

Use this structure for Telegram messages (no markdown tables — use bullets):

```
📊 Research Digest — YYYY-MM-DD

🏷 Competitor Pulse
• [key finding 1]
• [key finding 2]

🔥 Hottest Signals
• [signal with link]
• [signal with link]

📝 Content Heat
• Pillar: [hottest pillar] — [signal count]
• Idea: [concrete content angle]

⚡ Action Items
• [specific action]
```

## Automation

Wire into heartbeat or cron for 2-3x/week runs. The PULSE.md follow-up already notes this.
A good cadence: Monday morning (start of week), Wednesday (mid-week check), Friday (end-of-week review).

## Config

Edit `knowledge/reference/research/config.json` to:
- Add/remove competitors and their keywords
- Change target subreddits
- Adjust content pillar keywords
- Modify listening intent patterns
- Change dev.to tags or HN minimum score threshold
- Configure social trends queries per platform (`socialTrends.twitter.queries`, etc.)
- Configure X trend locations with `socialTrends.twitter.trendWoeids`
- Set the default content integration mode with `socialTrends.contentMode`

## Cost tracking

Social-trends logs the request count and estimated cost in both console output and the report header.
At $0.006/request with default config (6 Twitter + 4 Instagram + 6 LinkedIn = 16 queries), one run costs ~$0.10.
The free tier covers ~3 full runs per month (50 requests/endpoint/month).
