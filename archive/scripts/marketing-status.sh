#!/bin/bash
# Marketing Campaign Status — Expense Tracker iOS
# Usage: bash scripts/marketing-status.sh

WORKSPACE="/home/zoe/.openclaw/workspace"
METRICS="$WORKSPACE/memory/marketing/metrics.json"
LAUNCH="2026-02-27"

if ! command -v jq &> /dev/null; then
  echo "⚠️  jq not installed. Install with: sudo apt install jq"
  exit 1
fi

if [ ! -f "$METRICS" ]; then
  echo "⚠️  No metrics file found at $METRICS"
  exit 1
fi

# Days until launch
TODAY=$(date +%Y-%m-%d)
LAUNCH_EPOCH=$(date -d "$LAUNCH" +%s 2>/dev/null)
TODAY_EPOCH=$(date -d "$TODAY" +%s 2>/dev/null)
DAYS_LEFT=$(( (LAUNCH_EPOCH - TODAY_EPOCH) / 86400 ))

# Get latest weekly data
LATEST_WEEK=$(jq -r '.weekly | keys | sort | last' "$METRICS")
PHASE=$(jq -r ".weekly[\"$LATEST_WEEK\"].phase" "$METRICS")

echo "╔══════════════════════════════════════════╗"
echo "║   📊 EXPENSE TRACKER MARKETING STATUS    ║"
echo "╠══════════════════════════════════════════╣"
echo "║  📅 Today: $TODAY"
echo "║  🚀 Launch: $LAUNCH ($DAYS_LEFT days left)"
echo "║  📍 Phase: $PHASE"
echo "╠══════════════════════════════════════════╣"
echo "║  METRICS ($LATEST_WEEK)"
echo "║  ─────────────────────────────────────"
echo "║  🐦 Twitter Followers: $(jq -r ".weekly[\"$LATEST_WEEK\"].twitter_followers" "$METRICS")"
echo "║  👀 Twitter Impressions: $(jq -r ".weekly[\"$LATEST_WEEK\"].twitter_impressions" "$METRICS")"
echo "║  🟠 Reddit Karma: $(jq -r ".weekly[\"$LATEST_WEEK\"].reddit_karma" "$METRICS")"
echo "║  📝 Reddit Posts: $(jq -r ".weekly[\"$LATEST_WEEK\"].reddit_posts" "$METRICS")"
echo "║  📋 Waitlist Signups: $(jq -r ".weekly[\"$LATEST_WEEK\"].waitlist_signups" "$METRICS")"
echo "║  📱 App Downloads: $(jq -r ".weekly[\"$LATEST_WEEK\"].app_downloads" "$METRICS")"
echo "║  ✅ Tasks: $(jq -r ".weekly[\"$LATEST_WEEK\"].tasks_completed" "$METRICS")/$(jq -r ".weekly[\"$LATEST_WEEK\"].tasks_total" "$METRICS")"
echo "╚══════════════════════════════════════════╝"

# Check if today's daily log exists
DAILY_LOG="$WORKSPACE/memory/marketing/$TODAY.md"
if [ -f "$DAILY_LOG" ]; then
  echo "📓 Daily log exists for today"
else
  echo "⚠️  No daily log for today — create one!"
fi
