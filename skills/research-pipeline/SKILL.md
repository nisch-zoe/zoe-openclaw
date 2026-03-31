---
name: research-pipeline
description: Run OpenClaw research pipelines (competitor-pulse, content-trends, reddit-listen, full-scan) that monitor competitors, surface trending content, and detect Reddit signals for Fence and content strategy. Use when the user asks to run research, check competitors, find content ideas, scan Reddit, get a market pulse, or wants a research digest sent to Telegram.
---

# research-pipeline

Hybrid research system: deterministic scoring + LLM analysis prompts. Pulls from Reddit, HN, dev.to, and the App Store (India). No API keys needed.

## Quick reference

| Pipeline | What it does |
|---|---|
| `competitor-pulse` | App Store metadata, Reddit/HN mentions for tracked competitors |
| `content-trends` | Trending posts scored against content pillars, pillar heat map |
| `reddit-listen` | Keyword monitoring, intent classification, competitor mention detection |
| `full-scan` | All three pipelines in sequence |

Script: `node workspace/scripts/research.js <pipeline>`
Config: `knowledge/reference/research/config.json`

## Running a scan

```bash
# Single pipeline
node workspace/scripts/research.js competitor-pulse
node workspace/scripts/research.js content-trends
node workspace/scripts/research.js reddit-listen

# All three
node workspace/scripts/research.js full-scan

# Raw JSON output
node workspace/scripts/research.js full-scan --json
```

Expect ~2 minutes for `full-scan` due to rate-limiting delays between API calls.

## Output locations

Reports land in `knowledge/reference/research/<pipeline>/YYYY-MM-DD.md` with a `latest.md` symlink.
Raw JSON snapshots go to `knowledge/reference/research/snapshots/<pipeline>-YYYY-MM-DD.json`.

| Pipeline | Report path | Snapshot path |
|---|---|---|
| competitor-pulse | `knowledge/reference/research/competitor-pulse/` | `knowledge/reference/research/snapshots/competitor-pulse-*.json` |
| content-trends | `knowledge/reference/research/content-trends/` | `knowledge/reference/research/snapshots/content-trends-*.json` |
| reddit-listen | `knowledge/reference/research/reddit-signals/` | `knowledge/reference/research/snapshots/reddit-listen-*.json` |

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
