#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.resolve(WORKSPACE, '..');
const HOME_ROOT = path.resolve(OPENCLAW_HOME, '..');
const RESEARCH_ROOT = path.join(OPENCLAW_HOME, 'knowledge', 'reference', 'research');
const CONFIG_PATH = path.join(RESEARCH_ROOT, 'config.json');
const CREDENTIALS_ROOT = path.join(OPENCLAW_HOME, 'credentials');
const HOME_CREDENTIALS_ROOT = path.join(HOME_ROOT, 'credentials');
const APIDIRECT_KEY_PATHS = [
  path.join(CREDENTIALS_ROOT, 'apidirect-api-key.txt'),
  path.join(HOME_CREDENTIALS_ROOT, 'apidirect-api-key.txt'),
];
const CONTENT_ROOT = path.join(OPENCLAW_HOME, 'knowledge', 'content');
const CONTENT_HUB_INDEX_PATH = path.join(OPENCLAW_HOME, 'workspace', 'state', 'content-hub', 'index.json');
const CONTENT_TREND_ALIGNMENT_PATH = path.join(CONTENT_ROOT, 'TREND-ALIGNMENT.md');
const CONTENT_TREND_ALIGNMENT_STATE_PATH = path.join(OPENCLAW_HOME, 'workspace', 'state', 'content-hub', 'trend-alignment.json');

const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const FETCH_TIMEOUT_MS = 12000;
const APIDIRECT_TIMEOUT_MS = 18000;
const INTER_REQUEST_DELAY_MS = 1100;
const APIDIRECT_BASE = 'https://apidirect.io';
const TREND_TOKEN_STOPWORDS = new Set([
  'about', 'after', 'before', 'being', 'build', 'built', 'data', 'developer', 'developers', 'doing',
  'from', 'have', 'just', 'like', 'more', 'most', 'need', 'only', 'over', 'post', 'posts',
  'that', 'their', 'there', 'these', 'they', 'this', 'those', 'topic', 'topics', 'using',
  'what', 'when', 'where', 'with', 'your',
]);

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

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return readJson(p);
}

function readTextIfExists(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
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
// API Direct — Twitter/X, Instagram, LinkedIn (paid, pay-per-request)
// ---------------------------------------------------------------------------

function getApiDirectKey() {
  if (process.env.APIDIRECT_API_KEY) return process.env.APIDIRECT_API_KEY;
  for (const keyPath of APIDIRECT_KEY_PATHS) {
    const keyFile = readTextIfExists(keyPath)?.trim();
    if (keyFile) return keyFile;
  }
  try {
    const cfg = readJson(CONFIG_PATH);
    if (cfg.apiDirect?.apiKey) return cfg.apiDirect.apiKey;
  } catch {}
  return null;
}

function hasApiDirect() {
  return Boolean(getApiDirectKey());
}

async function apiDirectFetch(endpoint, params, label) {
  const apiKey = getApiDirectKey();
  if (!apiKey) {
    console.error(`  [SKIP] ${label}: no API Direct key (set APIDIRECT_API_KEY or apiDirect.apiKey in config)`);
    return null;
  }
  const url = new URL(`${APIDIRECT_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APIDIRECT_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`  [WARN] ${label}: HTTP ${res.status} ${body.slice(0, 200)}`);
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

async function twitterSearch(query, pages = 1, sortBy = 'most_recent') {
  const data = await apiDirectFetch('/v1/twitter/posts', { query, pages, sort_by: sortBy }, `twitter "${query}"`);
  if (!data?.posts) return [];
  return data.posts.map((p) => ({
    platform: 'twitter',
    title: p.title || '',
    url: p.url,
    date: p.date,
    author: p.author,
    snippet: (p.snippet || '').slice(0, 500),
    likes: p.likes || 0,
    retweets: p.retweets || 0,
    replies: p.replies || 0,
    views: p.views || null,
    authorFollowers: p.author_followers || 0,
    authorVerified: p.author_verified || false,
    hashtags: p.hashtags || [],
    isReply: p.is_reply || false,
    engagement: (p.likes || 0) + (p.retweets || 0) * 2 + (p.replies || 0),
  }));
}

async function instagramSearch(query, pages = 1) {
  const data = await apiDirectFetch('/v1/instagram/posts', { query, pages }, `instagram "${query}"`);
  if (!data?.posts) return [];
  return data.posts.map((p) => ({
    platform: 'instagram',
    title: p.title || '',
    url: p.url,
    date: p.date,
    author: p.author,
    authorName: p.author_name,
    snippet: (p.snippet || '').slice(0, 500),
    likes: p.likes || 0,
    comments: p.comments || 0,
    shares: p.shares || 0,
    views: p.views || null,
    isVideo: p.is_video || false,
    mediaType: p.media_type,
    authorVerified: p.author_verified || false,
    hashtags: p.hashtags || [],
    engagement: (p.likes || 0) + (p.comments || 0) * 3 + (p.shares || 0) * 2,
  }));
}

async function linkedinSearch(query, page = 1, sortBy = 'most_recent') {
  const data = await apiDirectFetch('/v1/linkedin/posts', { query, page, sort_by: sortBy }, `linkedin "${query}"`);
  if (!data?.posts) return [];
  return data.posts.map((p) => ({
    platform: 'linkedin',
    title: p.title || '',
    url: p.url,
    date: p.date,
    author: p.author,
    snippet: (p.snippet || '').slice(0, 500),
    engagement: 0,
  }));
}

async function twitterCurrentTrends(woeid = 1) {
  const data = await apiDirectFetch('/v1/twitter/trends', { woeid }, `twitter trends ${woeid}`);
  if (!data?.trends) {
    return {
      location: null,
      woeid,
      asOf: null,
      trends: [],
    };
  }
  return {
    location: data.location || null,
    woeid: data.woeid || woeid,
    asOf: data.as_of || null,
    trends: data.trends.map((trend) => ({
      name: trend.name,
      query: decodeURIComponent(trend.query || trend.name || ''),
      tweetVolume: trend.tweet_volume || 0,
      url: trend.url,
    })),
  };
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

function normalizeSocialContentMode(value) {
  return String(value || 'separate').trim().toLowerCase() === 'overlay' ? 'overlay' : 'separate';
}

function flattenSocialPosts(results) {
  return [...(results.twitter || []), ...(results.instagram || []), ...(results.linkedin || [])];
}

function extractTrendTokens(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[#@]/g, ' ')
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !TREND_TOKEN_STOPWORDS.has(token))
  )];
}

function summarizeSocialTrends(results, config) {
  const pillarMap = Object.fromEntries(Object.keys(config.contentPillars).map((pillar) => [pillar, 0]));
  const queryMap = new Map();
  const hashtagMap = new Map();
  const twitterTrendMap = new Map();

  for (const trendSet of results.twitterTrends || []) {
    for (const trend of trendSet.trends || []) {
      const key = String(trend.name || '').toLowerCase();
      if (!key) continue;
      const existing = twitterTrendMap.get(key) || {
        name: trend.name,
        query: trend.query,
        tweetVolume: 0,
        url: trend.url,
        locations: new Set(),
      };
      existing.tweetVolume = Math.max(existing.tweetVolume, trend.tweetVolume || 0);
      if (trendSet.location) existing.locations.add(trendSet.location);
      twitterTrendMap.set(key, existing);
    }
  }

  for (const post of flattenSocialPosts(results)) {
    for (const match of post.pillarMatches || []) {
      pillarMap[match.pillar] = (pillarMap[match.pillar] || 0) + 1;
    }

    const query = post.searchQuery || 'unclassified';
    const queryKey = `${post.platform}:${query}`;
    const existingQuery = queryMap.get(queryKey) || {
      platform: post.platform,
      query,
      posts: 0,
      totalEngagement: 0,
      pillars: {},
    };
    existingQuery.posts += 1;
    existingQuery.totalEngagement += post.engagement || 0;
    for (const match of post.pillarMatches || []) {
      existingQuery.pillars[match.pillar] = (existingQuery.pillars[match.pillar] || 0) + 1;
    }
    queryMap.set(queryKey, existingQuery);

    for (const hashtag of post.hashtags || []) {
      const normalized = String(hashtag || '').trim().toLowerCase();
      if (!normalized) continue;
      const existingHashtag = hashtagMap.get(normalized) || {
        tag: normalized.startsWith('#') ? normalized : `#${normalized}`,
        posts: 0,
        totalEngagement: 0,
      };
      existingHashtag.posts += 1;
      existingHashtag.totalEngagement += post.engagement || 0;
      hashtagMap.set(normalized, existingHashtag);
    }
  }

  const pillarCounts = Object.entries(pillarMap)
    .map(([pillar, count]) => ({
      pillar,
      name: config.contentPillars[pillar]?.name || pillar,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const topQueries = [...queryMap.values()]
    .map((entry) => ({
      ...entry,
      pillarMatches: Object.entries(entry.pillars)
        .map(([pillar, count]) => ({
          pillar,
          name: config.contentPillars[pillar]?.name || pillar,
          count,
        }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => (b.totalEngagement + b.posts * 25) - (a.totalEngagement + a.posts * 25))
    .slice(0, 12);

  const topHashtags = [...hashtagMap.values()]
    .sort((a, b) => (b.totalEngagement + b.posts * 10) - (a.totalEngagement + a.posts * 10))
    .slice(0, 15);

  const twitterTrendTopics = [...twitterTrendMap.values()]
    .map((entry) => ({
      ...entry,
      locations: [...entry.locations].sort(),
    }))
    .sort((a, b) => b.tweetVolume - a.tweetVolume || a.name.localeCompare(b.name))
    .slice(0, 20);

  const topKeywords = [...new Set([
    ...topQueries.flatMap((entry) => [entry.query, ...extractTrendTokens(entry.query)]),
    ...topHashtags.map((entry) => entry.tag.replace(/^#/, '')),
    ...twitterTrendTopics.flatMap((entry) => [
      entry.name.replace(/^#/, '').toLowerCase(),
      ...extractTrendTokens(entry.name),
      ...extractTrendTokens(entry.query),
    ]),
  ])].slice(0, 30);

  return {
    pillarMap,
    pillarCounts,
    topQueries,
    topHashtags,
    twitterTrendTopics,
    topKeywords,
  };
}

function loadContentHubIndex() {
  return readJsonIfExists(CONTENT_HUB_INDEX_PATH);
}

function buildContentTrendAlignment(results, config) {
  const index = loadContentHubIndex();
  const summary = results.summary || summarizeSocialTrends(results, config);

  if (!index?.items?.length) {
    return {
      generatedAt: nowIso(),
      available: false,
      reason: `Content hub index not found at ${path.relative(OPENCLAW_HOME, CONTENT_HUB_INDEX_PATH)}.`,
      summary,
      matchedItems: [],
      uncoveredQueries: [],
    };
  }

  const matchedItems = index.items
    .map((item) => {
      const searchable = [
        item.title,
        item.intent,
        item.source,
        item.draftStats?.excerpt,
        item.notesStats?.excerpt,
        ...(item.tags || []),
        ...(item.platforms || []),
      ].filter(Boolean).join(' ');

      const matchedPillars = classifyPillar(searchable, config.contentPillars)
        .filter((match) => (summary.pillarMap[match.pillar] || 0) > 0)
        .map((match) => ({
          pillar: match.pillar,
          name: match.name,
          score: summary.pillarMap[match.pillar] || 0,
        }));

      const keywordHits = summary.topKeywords.filter((keyword) =>
        searchable.toLowerCase().includes(String(keyword).toLowerCase())
      ).slice(0, 8);

      const platformBoost = (item.platforms || []).reduce((score, platform) => {
        if (platform === 'x' && results.twitter.length) return score + 4;
        if (platform === 'linkedin' && results.linkedin.length) return score + 4;
        return score;
      }, 0);

      const score =
        matchedPillars.reduce((sum, match) => sum + match.score * 25, 0) +
        keywordHits.length * 8 +
        platformBoost;

      return {
        slug: item.slug,
        title: item.title,
        state: item.state,
        platforms: item.platforms || [],
        path: item.path,
        score,
        matchedPillars,
        keywordHits,
        excerpt: item.draftStats?.excerpt || item.intent || null,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const coveredPillars = new Set(
    matchedItems.flatMap((item) => item.matchedPillars.map((match) => match.pillar))
  );

  const uncoveredQueries = summary.topQueries
    .filter((entry) => {
      const queryPillars = entry.pillarMatches.map((match) => match.pillar);
      return queryPillars.length > 0 && !queryPillars.some((pillar) => coveredPillars.has(pillar));
    })
    .slice(0, 6)
    .map((entry) => ({
      platform: entry.platform,
      query: entry.query,
      posts: entry.posts,
      totalEngagement: entry.totalEngagement,
      pillarMatches: entry.pillarMatches,
    }));

  return {
    generatedAt: nowIso(),
    available: true,
    summary,
    matchedItems,
    uncoveredQueries,
  };
}

function renderContentTrendAlignment(alignment, config) {
  const lines = [];
  lines.push(`# Trend Alignment — ${todayDate()}`);
  lines.push(`> Generated: ${alignment.generatedAt}`);
  lines.push('> This is an optional overlay. Use it when you want trend-aligned content; ignore it when you want conviction-led or evergreen content.');
  lines.push('');

  lines.push('## What We Track\n');
  lines.push('- Twitter/X: live trend topics for configured locations plus top posts in strategic query lanes');
  lines.push('- Instagram: high-engagement posts in strategic query lanes');
  lines.push('- LinkedIn: top public posts in strategic query lanes');
  lines.push('');

  lines.push('## Hottest Pillars Right Now\n');
  for (const pillar of alignment.summary.pillarCounts.slice(0, 5)) {
    lines.push(`- **${pillar.name}**: ${pillar.count} social signals`);
  }
  lines.push('');

  lines.push('## Twitter/X Live Trends\n');
  if (!alignment.summary.twitterTrendTopics.length) {
    lines.push('_No live X trends captured in this run._\n');
  } else {
    for (const trend of alignment.summary.twitterTrendTopics.slice(0, 10)) {
      const volume = trend.tweetVolume ? `${trend.tweetVolume.toLocaleString()} tweets` : 'volume n/a';
      const locations = trend.locations.length ? trend.locations.join(', ') : 'unknown location';
      lines.push(`- **${trend.name}** | ${volume} | ${locations}`);
    }
    lines.push('');
  }

  lines.push('## Existing Drafts Worth Pushing Now\n');
  if (!alignment.available || !alignment.matchedItems.length) {
    lines.push('_No strong matches in the current content hub index._\n');
  } else {
    for (const item of alignment.matchedItems.slice(0, 8)) {
      const pillars = item.matchedPillars.map((match) => match.name).join(', ');
      const keywords = item.keywordHits.join(', ');
      lines.push(`- **${item.title}** | ${item.state} | score ${item.score} | \`${item.path}\``);
      if (pillars) lines.push(`  Pillars: ${pillars}`);
      if (keywords) lines.push(`  Keyword hits: ${keywords}`);
      if (item.excerpt) lines.push(`  ${item.excerpt}`);
    }
    lines.push('');
  }

  lines.push('## Open Trend Lanes Without Draft Coverage\n');
  if (!alignment.available || !alignment.uncoveredQueries.length) {
    lines.push('_Current drafts already cover the main trending lanes reasonably well._\n');
  } else {
    for (const entry of alignment.uncoveredQueries) {
      const pillars = entry.pillarMatches.map((match) => match.name).join(', ');
      lines.push(`- **${entry.query}** (${entry.platform}) | ${entry.posts} posts | engagement ${entry.totalEngagement}`);
      if (pillars) lines.push(`  Pillars: ${pillars}`);
    }
    lines.push('');
  }

  lines.push('## How To Use This\n');
  lines.push('- Want trend-aligned content: pick from `Existing Drafts Worth Pushing Now` first.');
  lines.push('- Want purely evergreen or opinion-led content: ignore this file and keep using the content hub normally.');
  lines.push('- Want to chase the wave hard: start with `Open Trend Lanes Without Draft Coverage` and create a new item in `idea` state.');
  lines.push('');

  return lines.join('\n');
}

function saveContentTrendAlignment(alignment) {
  writeText(CONTENT_TREND_ALIGNMENT_PATH, renderContentTrendAlignment(alignment));
  writeJson(CONTENT_TREND_ALIGNMENT_STATE_PATH, alignment);
  return {
    report: path.relative(OPENCLAW_HOME, CONTENT_TREND_ALIGNMENT_PATH),
    snapshot: path.relative(OPENCLAW_HOME, CONTENT_TREND_ALIGNMENT_STATE_PATH),
  };
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
// Pipeline: social-trends (API Direct — paid)
// ---------------------------------------------------------------------------

async function pipelineSocialTrends(config, options = {}) {
  console.log('\n=== Social Trends (API Direct) ===\n');
  const st = config.socialTrends || {};
  const fallbackQueries = config.competitors.genericKeywords;
  const contentMode = normalizeSocialContentMode(options.contentMode || st.contentMode);
  const results = {
    twitterTrends: [],
    twitter: [],
    instagram: [],
    linkedin: [],
    fetchedAt: nowIso(),
    requestCount: 0,
    contentMode,
  };

  const twitterTrendWoeids = (st.twitter?.trendWoeids || [1]).slice(0, 4);
  const twitterQueries = (st.twitter?.queries || fallbackQueries).slice(0, 8);
  const instagramQueries = (st.instagram?.queries || fallbackQueries).slice(0, 6);
  const linkedinQueries = (st.linkedin?.queries || fallbackQueries).slice(0, 8);

  console.log('Fetching Twitter/X live trend topics...');
  for (const woeid of twitterTrendWoeids) {
    const trendSet = await twitterCurrentTrends(woeid);
    results.twitterTrends.push(trendSet);
    results.requestCount++;
    console.log(`  ${trendSet.location || `woeid:${woeid}`}: ${trendSet.trends.length} trends`);
    await sleep(400);
  }

  console.log('Fetching Twitter/X posts...');
  for (const q of twitterQueries) {
    const posts = await twitterSearch(q, 1);
    for (const post of posts) {
      const text = `${post.snippet} ${post.hashtags.join(' ')}`;
      post.pillarMatches = classifyPillar(text, config.contentPillars);
      post.intents = classifyIntent(text, config.listening);
      post.searchQuery = q;
    }
    results.twitter.push(...posts);
    results.requestCount++;
    console.log(`  "${q}": ${posts.length} tweets`);
    await sleep(400);
  }
  results.twitter = deduplicateByField(results.twitter, 'url')
    .filter((p) => !p.isReply)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 30);

  console.log('Fetching Instagram posts...');
  for (const q of instagramQueries) {
    const posts = await instagramSearch(q, 1);
    for (const post of posts) {
      const text = `${post.snippet} ${post.hashtags.join(' ')}`;
      post.pillarMatches = classifyPillar(text, config.contentPillars);
      post.searchQuery = q;
    }
    results.instagram.push(...posts);
    results.requestCount++;
    console.log(`  "${q}": ${posts.length} posts`);
    await sleep(400);
  }
  results.instagram = deduplicateByField(results.instagram, 'url')
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 20);

  console.log('Fetching LinkedIn posts...');
  for (const q of linkedinQueries) {
    const posts = await linkedinSearch(q, 1);
    for (const post of posts) {
      post.pillarMatches = classifyPillar(post.snippet, config.contentPillars);
      post.intents = classifyIntent(post.snippet, config.listening);
      post.searchQuery = q;
    }
    results.linkedin.push(...posts);
    results.requestCount++;
    console.log(`  "${q}": ${posts.length} posts`);
    await sleep(400);
  }
  results.linkedin = deduplicateByField(results.linkedin, 'url')
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 20);

  results.summary = summarizeSocialTrends(results, config);
  if (results.contentMode === 'overlay') {
    results.contentAlignment = buildContentTrendAlignment(results, config);
  }

  const cost = results.requestCount * 0.006;
  console.log(`\n  API Direct requests: ${results.requestCount} (~$${cost.toFixed(3)})`);
  return results;
}

function renderSocialTrends(results, config) {
  const summary = results.summary || summarizeSocialTrends(results, config);
  const lines = [];
  lines.push(`# Social Trends — ${todayDate()}`);
  lines.push(`> Fetched: ${results.fetchedAt} | Twitter: ${results.twitter.length}, Instagram: ${results.instagram.length}, LinkedIn: ${results.linkedin.length}`);
  lines.push(`> API Direct requests: ${results.requestCount} (~$${(results.requestCount * 0.006).toFixed(3)})`);
  lines.push(`> Content mode: ${results.contentMode || 'separate'} (separate = research only, overlay = also score current drafts against trends)`);
  lines.push('');

  lines.push('## Tracking Model\n');
  lines.push('- Twitter/X: live trend topics for configured locations plus top posts in strategic query lanes');
  lines.push('- Instagram: top high-engagement posts in strategic query lanes');
  lines.push('- LinkedIn: top public posts in strategic query lanes');
  lines.push('');

  lines.push('## Twitter/X - Live Trend Topics\n');
  if (!(summary.twitterTrendTopics || []).length) {
    lines.push('_No live X trends captured._\n');
  } else {
    for (const trend of summary.twitterTrendTopics.slice(0, 12)) {
      const volume = trend.tweetVolume ? `${trend.tweetVolume.toLocaleString()} tweets` : 'volume n/a';
      const locations = trend.locations.length ? trend.locations.join(', ') : 'unknown location';
      lines.push(`- **[${trend.name}](${trend.url})** | ${volume} | ${locations}`);
    }
    lines.push('');
  }

  lines.push('## Cross-Platform High-Signal Query Lanes\n');
  for (const entry of summary.topQueries.slice(0, 10)) {
    const pillars = entry.pillarMatches.map((match) => match.pillar).join(', ');
    lines.push(`- **${entry.query}** (${entry.platform}) | ${entry.posts} posts | engagement ${entry.totalEngagement}`);
    if (pillars) lines.push(`  Pillars: ${pillars}`);
  }
  lines.push('');

  lines.push('## Pillar Heat (Social Platforms)\n');
  for (const pillar of summary.pillarCounts) {
    const bar = '█'.repeat(Math.min(pillar.count, 20));
    lines.push(`- **${pillar.name}**: ${pillar.count} signals ${bar}`);
  }
  lines.push('');

  // Twitter
  lines.push('## Twitter/X — Top Posts\n');
  if (!results.twitter.length) {
    lines.push('_No results._\n');
  } else {
    for (const post of results.twitter.slice(0, 15)) {
      const pillars = (post.pillarMatches || []).map((m) => m.pillar).join(', ');
      const metrics = `${post.likes} likes, ${post.retweets} RT`;
      const views = post.views ? `, ${(post.views / 1000).toFixed(1)}k views` : '';
      const verified = post.authorVerified ? ' ✓' : '';
      lines.push(`- **[${post.snippet.slice(0, 100)}...](${post.url})**`);
      lines.push(`  @${post.author}${verified} (${(post.authorFollowers / 1000).toFixed(1)}k) | ${metrics}${views} | q: "${post.searchQuery}"`);
      if (pillars) lines.push(`  Pillars: ${pillars}`);
    }
    lines.push('');
  }

  // Instagram
  lines.push('## Instagram — Top Posts\n');
  if (!results.instagram.length) {
    lines.push('_No results._\n');
  } else {
    for (const post of results.instagram.slice(0, 12)) {
      const pillars = (post.pillarMatches || []).map((m) => m.pillar).join(', ');
      const metrics = `${post.likes} likes, ${post.comments} comments`;
      const views = post.views ? `, ${(post.views / 1000).toFixed(1)}k views` : '';
      const type = post.isVideo ? '🎬' : '📷';
      lines.push(`- ${type} **[@${post.author}](${post.url})**: ${post.snippet.slice(0, 120)}`);
      lines.push(`  ${metrics}${views} | q: "${post.searchQuery}"`);
      if (pillars) lines.push(`  Pillars: ${pillars}`);
    }
    lines.push('');
  }

  // LinkedIn
  lines.push('## LinkedIn — Top Posts\n');
  if (!results.linkedin.length) {
    lines.push('_No results._\n');
  } else {
    for (const post of results.linkedin.slice(0, 12)) {
      const pillars = (post.pillarMatches || []).map((m) => m.pillar).join(', ');
      lines.push(`- **[${post.author}](${post.url})**: ${post.snippet.slice(0, 150)}`);
      lines.push(`  ${post.date} | q: "${post.searchQuery}"`);
      if (pillars) lines.push(`  Pillars: ${pillars}`);
    }
    lines.push('');
  }

  if (results.contentMode === 'overlay') {
    lines.push('## Content Overlay Snapshot\n');
    if (!results.contentAlignment?.available) {
      lines.push(`_Overlay requested but unavailable: ${results.contentAlignment?.reason || 'content hub index missing'}._\n`);
    } else if (!results.contentAlignment.matchedItems.length) {
      lines.push('_Overlay requested, but no current drafts strongly match the active trend lanes._\n');
    } else {
      for (const item of results.contentAlignment.matchedItems.slice(0, 5)) {
        const pillars = item.matchedPillars.map((match) => match.pillar).join(', ');
        lines.push(`- **${item.title}** | ${item.state} | score ${item.score} | \`${item.path}\``);
        if (pillars) lines.push(`  Pillars: ${pillars}`);
      }
      lines.push('');
    }
  }

  // LLM analysis prompt
  lines.push('---\n');
  lines.push('## LLM Analysis Prompt\n');
  lines.push('```');
  lines.push('You are a content strategist analyzing social media trends across');
  lines.push('Twitter/X, Instagram, and LinkedIn for a builder/engineer who:');
  lines.push('- Ships iOS apps (Fence: privacy-first expense tracker for India)');
  lines.push('- Posts about indie making, privacy, fintech, iOS engineering, and AI tools');
  lines.push('- Targets Indian iPhone users and the global indie/developer community');
  lines.push('');
  lines.push('Based on the social trends data above, provide:');
  lines.push('1. Top 5 cross-platform content angles (which topics are hot on multiple platforms)');
  lines.push('2. Platform-specific opportunities (what works on Twitter vs LinkedIn vs Instagram)');
  lines.push('3. High-engagement formats (threads, carousels, short posts) per platform');
  lines.push('4. Trending conversations worth joining with a specific angle');
  lines.push('5. Competitor or influencer accounts worth monitoring based on what appeared');
  lines.push('6. One contrarian take that could cut through the noise');
  lines.push('```\n');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pipeline: full-scan
// ---------------------------------------------------------------------------

async function pipelineFullScan(config, options = {}) {
  const competitorResults = await pipelineCompetitorPulse(config);
  const contentResults = await pipelineContentTrends(config);
  const redditResults = await pipelineRedditListen(config);

  let socialResults = null;
  if (hasApiDirect()) {
    socialResults = await pipelineSocialTrends(config, options);
  } else {
    console.log('\n[INFO] Skipping social-trends: no API Direct key. Set APIDIRECT_API_KEY, save the key to credentials/apidirect-api-key.txt, or add apiDirect.apiKey to config.');
  }
  return { competitorResults, contentResults, redditResults, socialResults };
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

Free pipelines (no API key needed):
  competitor-pulse   Monitor competitors (App Store, Reddit, HN)
  content-trends     Scan trending content across platforms
  reddit-listen      Monitor Reddit for signals and opportunities

Paid pipeline (API Direct — ~$0.006/request):
  social-trends      Twitter/X, Instagram, LinkedIn via API Direct

Combined:
  full-scan          Run all pipelines (social-trends included when API key present)

Utilities:
  config             Show current configuration

Options:
  --json             Output raw JSON instead of Markdown
  --content-mode     separate | overlay (default from config; only affects social-trends)

API Direct key: set APIDIRECT_API_KEY, save it to credentials/apidirect-api-key.txt, or add apiDirect.apiKey in config.json
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

  if (command === 'social-trends') {
    if (!hasApiDirect()) {
      console.error('Error: API Direct key not found. Set APIDIRECT_API_KEY, save the key to credentials/apidirect-api-key.txt, or add apiDirect.apiKey to config.json.');
      console.error('Sign up (free, no card): https://apidirect.io/signup');
      process.exitCode = 1;
      return;
    }
    const results = await pipelineSocialTrends(config, { contentMode: args['content-mode'] });
    const markdown = renderSocialTrends(results, config);
    const paths = savePipelineOutput('social-trends', markdown, results);
    const contentPaths =
      results.contentMode === 'overlay' && results.contentAlignment
        ? saveContentTrendAlignment(results.contentAlignment)
        : null;
    if (asJson) {
      console.log(JSON.stringify({ paths, contentPaths, data: results }, null, 2));
    } else {
      console.log(`\nSaved: ${paths.report}`);
      console.log(`Snapshot: ${paths.snapshot}`);
      console.log(`API Direct requests: ${results.requestCount} (~$${(results.requestCount * 0.006).toFixed(3)})`);
      if (contentPaths) {
        console.log(`Content Overlay: ${contentPaths.report}`);
      }
    }
    return;
  }

  if (command === 'full-scan') {
    const { competitorResults, contentResults, redditResults, socialResults } = await pipelineFullScan(config, {
      contentMode: args['content-mode'],
    });

    const p1 = savePipelineOutput('competitor-pulse', renderCompetitorPulse(competitorResults, config), competitorResults);
    const p2 = savePipelineOutput('content-trends', renderContentTrends(contentResults, config), contentResults);
    const p3 = savePipelineOutput('reddit-signals', renderRedditListen(redditResults, config), redditResults);

    const allPaths = [p1, p2, p3];
    let contentPaths = null;

    let p4 = null;
    if (socialResults) {
      p4 = savePipelineOutput('social-trends', renderSocialTrends(socialResults, config), socialResults);
      allPaths.push(p4);
      if (socialResults.contentMode === 'overlay' && socialResults.contentAlignment) {
        contentPaths = saveContentTrendAlignment(socialResults.contentAlignment);
      }
    }

    if (asJson) {
      console.log(JSON.stringify({ paths: allPaths, contentPaths }, null, 2));
    } else {
      console.log('\n=== Full Scan Complete ===');
      console.log(`Competitor Pulse: ${p1.report}`);
      console.log(`Content Trends:   ${p2.report}`);
      console.log(`Reddit Signals:   ${p3.report}`);
      if (p4) {
        console.log(`Social Trends:    ${p4.report} (${socialResults.requestCount} API Direct requests, ~$${(socialResults.requestCount * 0.006).toFixed(3)})`);
        if (contentPaths) {
          console.log(`Trend Overlay:    ${contentPaths.report}`);
        }
      } else {
        console.log(`Social Trends:    skipped (no API Direct key)`);
      }
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
