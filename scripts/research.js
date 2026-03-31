#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.resolve(WORKSPACE, '..');
const RESEARCH_ROOT = path.join(OPENCLAW_HOME, 'knowledge', 'reference', 'research');
const CONFIG_PATH = path.join(RESEARCH_ROOT, 'config.json');

const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const FETCH_TIMEOUT_MS = 12000;
const INTER_REQUEST_DELAY_MS = 1100;

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return nowIso().slice(0, 10);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeText(p, text) {
  ensureDir(path.dirname(p));
  const out = String(text);
  fs.writeFileSync(p, out.endsWith('\n') ? out : `${out}\n`, 'utf8');
}

function writeJson(p, data) {
  writeText(p, JSON.stringify(data, null, 2));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) { args._.push(t); continue; }
    const key = t.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { args[key] = true; continue; }
    args[key] = next;
    i++;
  }
  return args;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found at ${CONFIG_PATH}. Run config-init first.`);
  }
  return readJson(CONFIG_PATH);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeFetch(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`  [WARN] ${label}: HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    const reason = err.name === 'AbortError' ? 'timeout' : err.message;
    console.error(`  [WARN] ${label}: ${reason}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reddit
// ---------------------------------------------------------------------------

async function redditSubredditHot(subreddit, limit = 25) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}&raw_json=1`;
  const data = await safeFetch(url, `reddit r/${subreddit}/hot`);
  if (!data?.data?.children) return [];
  return data.data.children
    .filter((c) => c.kind === 't3')
    .map((c) => ({
      id: c.data.id,
      subreddit: c.data.subreddit,
      title: c.data.title,
      selftext: (c.data.selftext || '').slice(0, 500),
      url: `https://reddit.com${c.data.permalink}`,
      score: c.data.score,
      numComments: c.data.num_comments,
      createdUtc: c.data.created_utc,
      author: c.data.author,
      flair: c.data.link_flair_text || null,
    }));
}

async function redditSearch(query, subreddit = null, sort = 'relevance', time = 'week', limit = 25) {
  const sub = subreddit ? `/r/${subreddit}` : '';
  const url = `https://www.reddit.com${sub}/search.json?q=${encodeURIComponent(query)}&sort=${sort}&t=${time}&limit=${limit}&raw_json=1&restrict_sr=${subreddit ? 'on' : 'off'}`;
  const data = await safeFetch(url, `reddit search "${query}"${subreddit ? ` in r/${subreddit}` : ''}`);
  if (!data?.data?.children) return [];
  return data.data.children
    .filter((c) => c.kind === 't3')
    .map((c) => ({
      id: c.data.id,
      subreddit: c.data.subreddit,
      title: c.data.title,
      selftext: (c.data.selftext || '').slice(0, 500),
      url: `https://reddit.com${c.data.permalink}`,
      score: c.data.score,
      numComments: c.data.num_comments,
      createdUtc: c.data.created_utc,
      author: c.data.author,
      flair: c.data.link_flair_text || null,
    }));
}

// ---------------------------------------------------------------------------
// Hacker News
// ---------------------------------------------------------------------------

async function hnTopStories(limit = 30) {
  const ids = await safeFetch('https://hacker-news.firebaseio.com/v0/topstories.json', 'hn top');
  if (!Array.isArray(ids)) return [];
  const items = [];
  for (const id of ids.slice(0, limit)) {
    const item = await safeFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, `hn item ${id}`);
    if (item && item.type === 'story') {
      items.push({
        id: item.id,
        title: item.title,
        url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
        hnUrl: `https://news.ycombinator.com/item?id=${item.id}`,
        score: item.score || 0,
        numComments: item.descendants || 0,
        author: item.by,
        time: item.time,
      });
    }
    await sleep(200);
  }
  return items;
}

async function hnSearch(query, limit = 15) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
  const data = await safeFetch(url, `hn search "${query}"`);
  if (!data?.hits) return [];
  return data.hits.map((h) => ({
    id: h.objectID,
    title: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    hnUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
    score: h.points || 0,
    numComments: h.num_comments || 0,
    author: h.author,
    time: Math.floor(new Date(h.created_at).getTime() / 1000),
  }));
}

// ---------------------------------------------------------------------------
// dev.to
// ---------------------------------------------------------------------------

async function devtoTrending(tag, top = 7, perPage = 10) {
  const url = `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&top=${top}&per_page=${perPage}`;
  const data = await safeFetch(url, `dev.to tag=${tag}`);
  if (!Array.isArray(data)) return [];
  return data.map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    tags: a.tag_list || [],
    reactions: a.positive_reactions_count || 0,
    comments: a.comments_count || 0,
    publishedAt: a.published_at,
    readingTime: a.reading_time_minutes,
    author: a.user?.username,
  }));
}

// ---------------------------------------------------------------------------
// App Store (iTunes Search API)
// ---------------------------------------------------------------------------

async function appStoreSearch(term, country = 'in', limit = 10) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&entity=software&limit=${limit}`;
  const data = await safeFetch(url, `appstore "${term}"`);
  if (!data?.results) return [];
  return data.results.map((a) => ({
    trackId: a.trackId,
    name: a.trackName,
    developer: a.artistName,
    rating: a.averageUserRating,
    ratingCount: a.userRatingCount,
    version: a.version,
    releaseDate: a.releaseDate,
    currentVersionReleaseDate: a.currentVersionReleaseDate,
    price: a.formattedPrice,
    description: (a.description || '').slice(0, 300),
    genres: a.genres || [],
    bundleId: a.bundleId,
    url: a.trackViewUrl,
    screenshotUrls: (a.screenshotUrls || []).slice(0, 2),
  }));
}

// ---------------------------------------------------------------------------
// Scoring & Classification
// ---------------------------------------------------------------------------

function keywordMatch(text, keywords) {
  const lower = (text || '').toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase()));
}

function classifyPillar(text, pillars) {
  const matches = [];
  for (const [id, pillar] of Object.entries(pillars)) {
    const hits = keywordMatch(text, pillar.keywords);
    if (hits.length > 0) {
      matches.push({ pillar: id, name: pillar.name, hits: hits.length, keywords: hits });
    }
  }
  return matches.sort((a, b) => b.hits - a.hits);
}

function classifyIntent(text, patterns) {
  const lower = (text || '').toLowerCase();
  const intents = [];
  for (const p of patterns.painPointPatterns || []) {
    if (lower.includes(p)) intents.push({ type: 'pain-point', pattern: p });
  }
  for (const p of patterns.featureRequestPatterns || []) {
    if (lower.includes(p)) intents.push({ type: 'feature-request', pattern: p });
  }
  for (const p of patterns.contentOpportunityPatterns || []) {
    if (lower.includes(p)) intents.push({ type: 'content-opportunity', pattern: p });
  }
  return intents;
}

function deduplicateByField(items, field) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item[field];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatAge(utcSeconds) {
  const hours = Math.floor((Date.now() / 1000 - utcSeconds) / 3600);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Pipeline: competitor-pulse
// ---------------------------------------------------------------------------

async function pipelineCompetitorPulse(config) {
  console.log('\n=== Competitor Pulse ===\n');
  const results = { appStore: {}, redditMentions: {}, hnMentions: [], fetchedAt: nowIso() };

  // App Store lookups
  console.log('Fetching App Store data...');
  for (const [slug, comp] of Object.entries(config.competitors.apps)) {
    const apps = await appStoreSearch(comp.appStoreSearch, 'in', 5);
    results.appStore[slug] = { name: comp.name, results: apps };
    console.log(`  ${comp.name}: ${apps.length} results`);
    await sleep(INTER_REQUEST_DELAY_MS);
  }

  // Reddit mentions per competitor — search within target subreddits to reduce noise
  const competitorSubreddits = config.subreddits || ['personalfinanceindia', 'india', 'iphone', 'developersIndia'];
  console.log('Searching Reddit for competitor mentions...');
  for (const [slug, comp] of Object.entries(config.competitors.apps)) {
    const allMentions = [];
    for (const kw of comp.keywords.slice(0, 2)) {
      for (const sub of competitorSubreddits.slice(0, 3)) {
        const posts = await redditSearch(kw, sub, 'new', 'month', 10);
        allMentions.push(...posts);
        await sleep(INTER_REQUEST_DELAY_MS);
      }
    }
    results.redditMentions[slug] = {
      name: comp.name,
      posts: deduplicateByField(allMentions, 'id').sort((a, b) => b.score - a.score).slice(0, 15),
    };
    console.log(`  ${comp.name}: ${results.redditMentions[slug].posts.length} unique mentions`);
  }

  // Generic keyword Reddit search
  console.log('Searching Reddit for generic keywords...');
  const genericPosts = [];
  for (const kw of config.competitors.genericKeywords) {
    const posts = await redditSearch(kw, null, 'relevance', 'week', 15);
    genericPosts.push(...posts);
    await sleep(INTER_REQUEST_DELAY_MS);
  }
  results.redditMentions['_generic'] = {
    name: 'Generic Keywords',
    posts: deduplicateByField(genericPosts, 'id').sort((a, b) => b.score - a.score).slice(0, 20),
  };
  console.log(`  Generic: ${results.redditMentions['_generic'].posts.length} unique posts`);

  // HN search for relevant topics
  console.log('Searching Hacker News...');
  const hnPosts = [];
  for (const kw of ['expense tracker', 'personal finance app', 'privacy fintech']) {
    const hits = await hnSearch(kw, 10);
    hnPosts.push(...hits);
    await sleep(500);
  }
  results.hnMentions = deduplicateByField(hnPosts, 'id').sort((a, b) => b.score - a.score).slice(0, 15);
  console.log(`  HN: ${results.hnMentions.length} relevant threads`);

  return results;
}

function renderCompetitorPulse(results, config) {
  const lines = [];
  lines.push(`# Competitor Pulse — ${todayDate()}`);
  lines.push(`> Fetched: ${results.fetchedAt}`);
  lines.push('');

  // App Store
  lines.push('## App Store Snapshot (India)\n');
  for (const [slug, data] of Object.entries(results.appStore)) {
    lines.push(`### ${data.name}`);
    if (!data.results.length) {
      lines.push('_No results found._\n');
      continue;
    }
    lines.push('| App | Rating | Reviews | Version | Updated | Price |');
    lines.push('|-----|--------|---------|---------|---------|-------|');
    for (const app of data.results.slice(0, 3)) {
      const rating = app.rating ? app.rating.toFixed(1) : '—';
      const reviews = app.ratingCount || 0;
      const updated = app.currentVersionReleaseDate ? app.currentVersionReleaseDate.slice(0, 10) : '—';
      lines.push(`| ${app.name} | ${rating} | ${reviews} | ${app.version || '—'} | ${updated} | ${app.price || 'Free'} |`);
    }
    lines.push('');
  }

  // Reddit mentions
  lines.push('## Reddit Mentions\n');
  for (const [slug, data] of Object.entries(results.redditMentions)) {
    lines.push(`### ${data.name}`);
    if (!data.posts.length) {
      lines.push('_No mentions found._\n');
      continue;
    }
    for (const post of data.posts.slice(0, 8)) {
      const age = formatAge(post.createdUtc);
      lines.push(`- **[${post.title}](${post.url})** | r/${post.subreddit} | ${post.score} pts, ${post.numComments} comments | ${age}`);
      if (post.selftext) {
        const preview = post.selftext.slice(0, 150).replace(/\n/g, ' ');
        lines.push(`  > ${preview}...`);
      }
    }
    lines.push('');
  }

  // HN
  lines.push('## Hacker News Threads\n');
  if (!results.hnMentions.length) {
    lines.push('_No relevant threads found._\n');
  } else {
    for (const item of results.hnMentions.slice(0, 10)) {
      lines.push(`- **[${item.title}](${item.hnUrl})** | ${item.score} pts, ${item.numComments} comments | by ${item.author}`);
    }
    lines.push('');
  }

  // LLM analysis prompt
  lines.push('---\n');
  lines.push('## LLM Analysis Prompt\n');
  lines.push('```');
  lines.push('You are analyzing competitive intelligence for Fence, a privacy-first');
  lines.push('local-only iOS expense tracker targeting Indian iPhone users.');
  lines.push('');
  lines.push('Key competitors: Axio (SMS parsing, crippled on iOS), Fold (Account');
  lines.push('Aggregator, requires bank login), Money Manager Realbyte (offline but');
  lines.push('ugly UX), Spendrix (new entrant, serverless claim).');
  lines.push('');
  lines.push("Fence's differentiator: Siri Shortcuts automation, zero-knowledge");
  lines.push('architecture, modern UI, no bank login required.');
  lines.push('');
  lines.push('Based on the data above, provide:');
  lines.push('1. Notable competitor moves (new versions, rating changes, feature launches)');
  lines.push('2. Sentiment patterns in user discussions (pain points, praise, complaints)');
  lines.push('3. Content opportunities arising from competitor discussions');
  lines.push('4. Strategic gaps Fence should exploit');
  lines.push('5. Any emerging threats or new entrants to watch');
  lines.push('```\n');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pipeline: content-trends
// ---------------------------------------------------------------------------

async function pipelineContentTrends(config) {
  console.log('\n=== Content Trends ===\n');
  const results = { reddit: [], hn: [], devto: [], fetchedAt: nowIso() };

  // Reddit hot posts from target subreddits
  console.log('Fetching Reddit hot posts...');
  for (const sub of config.subreddits) {
    const posts = await redditSubredditHot(sub, 20);
    for (const post of posts) {
      const combined = `${post.title} ${post.selftext}`;
      post.pillarMatches = classifyPillar(combined, config.contentPillars);
      post.intents = classifyIntent(combined, config.listening);
    }
    const relevant = posts.filter((p) => p.pillarMatches.length > 0 || p.intents.length > 0);
    results.reddit.push(...relevant);
    console.log(`  r/${sub}: ${posts.length} hot, ${relevant.length} relevant`);
    await sleep(INTER_REQUEST_DELAY_MS);
  }
  results.reddit = deduplicateByField(results.reddit, 'id')
    .sort((a, b) => (b.pillarMatches.length * 100 + b.score) - (a.pillarMatches.length * 100 + a.score))
    .slice(0, 30);

  // HN top stories
  console.log('Fetching HN top stories...');
  const hnStories = await hnTopStories(40);
  for (const story of hnStories) {
    story.pillarMatches = classifyPillar(story.title, config.contentPillars);
  }
  results.hn = hnStories
    .filter((s) => s.pillarMatches.length > 0 && s.score >= (config.hnMinScore || 10))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  console.log(`  HN: ${hnStories.length} top, ${results.hn.length} pillar-relevant`);

  // dev.to trending
  console.log('Fetching dev.to trends...');
  for (const tag of (config.devtoTags || []).slice(0, 6)) {
    const articles = await devtoTrending(tag, 7, 8);
    for (const article of articles) {
      article.pillarMatches = classifyPillar(`${article.title} ${article.tags.join(' ')}`, config.contentPillars);
    }
    results.devto.push(...articles.filter((a) => a.reactions >= 5));
    console.log(`  dev.to/${tag}: ${articles.length} articles`);
    await sleep(500);
  }
  results.devto = deduplicateByField(results.devto, 'id')
    .sort((a, b) => b.reactions - a.reactions)
    .slice(0, 20);

  return results;
}

function renderContentTrends(results, config) {
  const lines = [];
  lines.push(`# Content Trends — ${todayDate()}`);
  lines.push(`> Fetched: ${results.fetchedAt} | Reddit: ${results.reddit.length} signals, HN: ${results.hn.length}, dev.to: ${results.devto.length}`);
  lines.push('');

  // Pillar summary
  const pillarCounts = {};
  for (const pillar of Object.keys(config.contentPillars)) {
    pillarCounts[pillar] = 0;
  }
  for (const item of [...results.reddit, ...results.hn, ...results.devto]) {
    for (const m of item.pillarMatches || []) {
      pillarCounts[m.pillar] = (pillarCounts[m.pillar] || 0) + 1;
    }
  }
  lines.push('## Pillar Heat Map\n');
  const sorted = Object.entries(pillarCounts).sort((a, b) => b[1] - a[1]);
  for (const [pillar, count] of sorted) {
    const bar = '█'.repeat(Math.min(count, 20));
    const name = config.contentPillars[pillar]?.name || pillar;
    lines.push(`- **${name}**: ${count} signals ${bar}`);
  }
  lines.push('');

  // Reddit signals
  lines.push('## Reddit — Trending & Relevant\n');
  if (!results.reddit.length) {
    lines.push('_No pillar-relevant posts found._\n');
  } else {
    for (const post of results.reddit.slice(0, 15)) {
      const pillars = post.pillarMatches.map((m) => m.pillar).join(', ');
      const intents = post.intents.map((i) => i.type).join(', ');
      const age = formatAge(post.createdUtc);
      lines.push(`- **[${post.title}](${post.url})** | r/${post.subreddit} | ${post.score} pts | ${age}`);
      lines.push(`  Pillars: ${pillars || '—'} | Intents: ${intents || '—'}`);
    }
    lines.push('');
  }

  // HN signals
  lines.push('## Hacker News — Pillar-Relevant\n');
  if (!results.hn.length) {
    lines.push('_No pillar-relevant stories on HN right now._\n');
  } else {
    for (const story of results.hn) {
      const pillars = story.pillarMatches.map((m) => m.pillar).join(', ');
      lines.push(`- **[${story.title}](${story.hnUrl})** | ${story.score} pts, ${story.numComments} comments`);
      lines.push(`  Pillars: ${pillars}`);
    }
    lines.push('');
  }

  // dev.to
  lines.push('## dev.to — Top Articles\n');
  if (!results.devto.length) {
    lines.push('_No relevant dev.to articles._\n');
  } else {
    for (const article of results.devto.slice(0, 12)) {
      const pillars = (article.pillarMatches || []).map((m) => m.pillar).join(', ');
      lines.push(`- **[${article.title}](${article.url})** | ${article.reactions} reactions, ${article.comments} comments | ${article.readingTime}min`);
      if (pillars) lines.push(`  Pillars: ${pillars}`);
    }
    lines.push('');
  }

  // LLM analysis prompt
  lines.push('---\n');
  lines.push('## LLM Analysis Prompt\n');
  lines.push('```');
  lines.push('You are a content strategist for a builder/engineer who posts on');
  lines.push('LinkedIn, X/Twitter, and Reddit. Their content pillars are:');
  lines.push('1. iOS/mobile engineering (shortcuts, SwiftUI, real problems)');
  lines.push('2. Privacy & fintech in India (consent, data, Account Aggregator)');
  lines.push('3. Indie maker journey (building Fence, architecture, launch)');
  lines.push('4. Tools & workflows (AI coding, dev setup, local-first)');
  lines.push('5. Observations & opinions (industry trends, product design)');
  lines.push('');
  lines.push('Based on the trending data above, provide:');
  lines.push('1. Top 5 content ideas ranked by timeliness and audience fit');
  lines.push('2. Which pillar has the most momentum right now');
  lines.push('3. Any trending conversation worth joining (with a specific angle)');
  lines.push('4. One contrarian take that could generate engagement');
  lines.push('5. Suggested post format for each idea (thread, short post, long-form)');
  lines.push('```\n');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pipeline: reddit-listen
// ---------------------------------------------------------------------------

async function pipelineRedditListen(config) {
  console.log('\n=== Reddit Listening ===\n');
  const results = { signals: [], fetchedAt: nowIso() };

  // Keyword searches across target subreddits
  const allKeywords = [
    ...config.competitors.genericKeywords,
    'expense tracker ios',
    'privacy finance app',
    'siri shortcuts automation',
    'offline budget app',
  ];

  console.log('Running keyword searches...');
  for (const sub of config.subreddits.slice(0, 4)) {
    for (const kw of allKeywords.slice(0, 4)) {
      const posts = await redditSearch(kw, sub, 'new', 'month', 10);
      for (const post of posts) {
        const combined = `${post.title} ${post.selftext}`;
        post.competitorMentions = [];
        for (const [slug, comp] of Object.entries(config.competitors.apps)) {
          const hits = keywordMatch(combined, [comp.name.split(' ')[0], ...comp.keywords]);
          if (hits.length) post.competitorMentions.push({ competitor: slug, name: comp.name, keywords: hits });
        }
        post.intents = classifyIntent(combined, config.listening);
        post.pillarMatches = classifyPillar(combined, config.contentPillars);
        post.searchKeyword = kw;
      }
      results.signals.push(...posts);
      await sleep(INTER_REQUEST_DELAY_MS);
    }
    console.log(`  r/${sub}: searched ${allKeywords.slice(0, 4).length} keywords`);
  }

  results.signals = deduplicateByField(results.signals, 'id');

  // Score and sort
  results.signals.sort((a, b) => {
    const aScore = a.score + a.numComments * 2 + a.competitorMentions.length * 50 + a.intents.length * 30;
    const bScore = b.score + b.numComments * 2 + b.competitorMentions.length * 50 + b.intents.length * 30;
    return bScore - aScore;
  });

  results.signals = results.signals.slice(0, 40);
  console.log(`  Total unique signals: ${results.signals.length}`);

  return results;
}

function renderRedditListen(results, config) {
  const lines = [];
  lines.push(`# Reddit Signals — ${todayDate()}`);
  lines.push(`> Fetched: ${results.fetchedAt} | Signals: ${results.signals.length}`);
  lines.push('');

  // Group by intent type
  const painPoints = results.signals.filter((s) => s.intents.some((i) => i.type === 'pain-point'));
  const featureReqs = results.signals.filter((s) => s.intents.some((i) => i.type === 'feature-request'));
  const contentOpps = results.signals.filter((s) => s.intents.some((i) => i.type === 'content-opportunity'));
  const competitorMentions = results.signals.filter((s) => s.competitorMentions.length > 0);

  lines.push('## Signal Summary\n');
  lines.push(`- Pain points: ${painPoints.length}`);
  lines.push(`- Feature requests: ${featureReqs.length}`);
  lines.push(`- Content opportunities: ${contentOpps.length}`);
  lines.push(`- Competitor mentions: ${competitorMentions.length}`);
  lines.push('');

  function renderSignals(title, signals, limit = 10) {
    lines.push(`## ${title}\n`);
    if (!signals.length) { lines.push('_None found._\n'); return; }
    for (const post of signals.slice(0, limit)) {
      const age = formatAge(post.createdUtc);
      const comps = post.competitorMentions.map((c) => c.name).join(', ');
      lines.push(`- **[${post.title}](${post.url})** | r/${post.subreddit} | ${post.score} pts | ${age}`);
      if (comps) lines.push(`  Competitors: ${comps}`);
      if (post.selftext) {
        lines.push(`  > ${post.selftext.slice(0, 200).replace(/\n/g, ' ')}...`);
      }
    }
    lines.push('');
  }

  renderSignals('Pain Points', painPoints);
  renderSignals('Feature Requests', featureReqs);
  renderSignals('Content Opportunities', contentOpps);
  renderSignals('Competitor Mentions', competitorMentions);

  // All signals
  const unclassified = results.signals.filter(
    (s) => s.intents.length === 0 && s.competitorMentions.length === 0
  );
  if (unclassified.length) {
    renderSignals('Other Relevant Posts', unclassified, 8);
  }

  // LLM analysis prompt
  lines.push('---\n');
  lines.push('## LLM Analysis Prompt\n');
  lines.push('```');
  lines.push('You are analyzing Reddit signals for Fence, a privacy-first iOS');
  lines.push('expense tracker for the Indian market.');
  lines.push('');
  lines.push('Based on the Reddit data above, provide:');
  lines.push('1. Most actionable pain points Fence could address (product insights)');
  lines.push('2. Posts worth replying to with genuine value (not promotional)');
  lines.push('3. Content ideas directly inspired by real user questions');
  lines.push('4. Emerging trends in user expectations or competitor perception');
  lines.push('5. Any community sentiment shifts to be aware of');
  lines.push('```\n');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pipeline: full-scan
// ---------------------------------------------------------------------------

async function pipelineFullScan(config) {
  const competitorResults = await pipelineCompetitorPulse(config);
  const contentResults = await pipelineContentTrends(config);
  const redditResults = await pipelineRedditListen(config);
  return { competitorResults, contentResults, redditResults };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function savePipelineOutput(pipelineName, markdown, rawData) {
  const date = todayDate();
  const outputDir = path.join(RESEARCH_ROOT, pipelineName);
  const snapshotDir = path.join(RESEARCH_ROOT, 'snapshots');

  writeText(path.join(outputDir, `${date}.md`), markdown);
  writeJson(path.join(snapshotDir, `${pipelineName}-${date}.json`), rawData);

  // Symlink latest
  const latestPath = path.join(outputDir, 'latest.md');
  try { fs.unlinkSync(latestPath); } catch {}
  fs.symlinkSync(`${date}.md`, latestPath);

  return {
    report: path.relative(OPENCLAW_HOME, path.join(outputDir, `${date}.md`)),
    snapshot: path.relative(OPENCLAW_HOME, path.join(snapshotDir, `${pipelineName}-${date}.json`)),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`OpenClaw Research Pipelines

Commands:
  competitor-pulse   Monitor competitors (App Store, Reddit, HN)
  content-trends     Scan trending content across platforms
  reddit-listen      Monitor Reddit for signals and opportunities
  full-scan          Run all three pipelines
  config             Show current configuration

Options:
  --json             Output raw JSON instead of Markdown
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';

  if (command === 'help') {
    usage();
    return;
  }

  if (command === 'config') {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  const config = loadConfig();
  const asJson = Boolean(args.json);

  if (command === 'competitor-pulse') {
    const results = await pipelineCompetitorPulse(config);
    const markdown = renderCompetitorPulse(results, config);
    const paths = savePipelineOutput('competitor-pulse', markdown, results);
    if (asJson) {
      console.log(JSON.stringify({ paths, data: results }, null, 2));
    } else {
      console.log(`\nSaved: ${paths.report}`);
      console.log(`Snapshot: ${paths.snapshot}`);
    }
    return;
  }

  if (command === 'content-trends') {
    const results = await pipelineContentTrends(config);
    const markdown = renderContentTrends(results, config);
    const paths = savePipelineOutput('content-trends', markdown, results);
    if (asJson) {
      console.log(JSON.stringify({ paths, data: results }, null, 2));
    } else {
      console.log(`\nSaved: ${paths.report}`);
      console.log(`Snapshot: ${paths.snapshot}`);
    }
    return;
  }

  if (command === 'reddit-listen') {
    const results = await pipelineRedditListen(config);
    const markdown = renderRedditListen(results, config);
    const paths = savePipelineOutput('reddit-signals', markdown, results);
    if (asJson) {
      console.log(JSON.stringify({ paths, data: results }, null, 2));
    } else {
      console.log(`\nSaved: ${paths.report}`);
      console.log(`Snapshot: ${paths.snapshot}`);
    }
    return;
  }

  if (command === 'full-scan') {
    const { competitorResults, contentResults, redditResults } = await pipelineFullScan(config);

    const p1 = savePipelineOutput('competitor-pulse', renderCompetitorPulse(competitorResults, config), competitorResults);
    const p2 = savePipelineOutput('content-trends', renderContentTrends(contentResults, config), contentResults);
    const p3 = savePipelineOutput('reddit-signals', renderRedditListen(redditResults, config), redditResults);

    if (asJson) {
      console.log(JSON.stringify({ paths: [p1, p2, p3] }, null, 2));
    } else {
      console.log('\n=== Full Scan Complete ===');
      console.log(`Competitor Pulse: ${p1.report}`);
      console.log(`Content Trends:   ${p2.report}`);
      console.log(`Reddit Signals:   ${p3.report}`);
    }
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
