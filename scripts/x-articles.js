#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.resolve(WORKSPACE, '..');
const DEFAULT_LIBRARY_ROOT = path.join(OPENCLAW_HOME, 'knowledge', 'reference', 'x-articles');
const DEFAULT_CATALOG_PATH = 'catalog.json';
const DEFAULT_INDEX_PATH = 'index.md';
const KNOWN_AREAS = ['work', 'fitness', 'fence', 'content', 'learning', 'personal', 'other'];

function usage() {
  writeStdout(`OpenClaw X article knowledge base

Commands:
  fetch --url "<x-url>" [--out-dir <dir>] [--library-root <dir>] [--json]
  ingest --source-json <file> --raw-markdown <file> --clean-markdown <file> --meta <file> [--library-root <dir>] [--json]
  search [--query "<text>"] [--area <area>] [--project <slug>] [--tag <tag1,tag2>] [--author <handle>] [--limit <n>] [--library-root <dir>] [--json]
  show [--slug <slug> | --url "<x-url>"] [--library-root <dir>] [--json]
  attach-research [--slug <slug> | --url "<x-url>"] --file <markdown-file> [--library-root <dir>] [--json]
  rebuild-index [--library-root <dir>] [--json]
`);
}

function nowIso() {
  return new Date().toISOString();
}

function writeStdout(value) {
  const text = String(value);
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function normalizeSlashes(value) {
  return String(value).split(path.sep).join('/');
}

function relativeToOpenClaw(targetPath) {
  return normalizeSlashes(path.relative(OPENCLAW_HOME, targetPath));
}

function displayPath(targetPath) {
  const relativePath = path.relative(OPENCLAW_HOME, targetPath);
  if (relativePath && !relativePath.startsWith('..')) {
    return normalizeSlashes(relativePath);
  }
  if (!relativePath) {
    return '.';
  }
  return normalizeSlashes(path.resolve(targetPath));
}

function absolutePath(pathValue) {
  return path.isAbsolute(pathValue) ? pathValue : path.join(OPENCLAW_HOME, pathValue);
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function normalizeText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function slugify(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return normalized
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 96);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }
  return args;
}

function parseInteger(value, flagName) {
  if (value == null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer for ${flagName}.`);
  }
  return parsed;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  const text = String(value);
  fs.writeFileSync(filePath, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function listToArray(value, { slugifyItems = false } = {}) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);

  const normalized = [];
  const seen = new Set();

  for (const item of rawItems) {
    const next = slugifyItems ? slugify(item) : normalizeText(item);
    if (!next) continue;
    const dedupeKey = next.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(next);
  }

  return normalized;
}

function normalizeUrl(inputUrl) {
  const raw = normalizeText(inputUrl);
  if (!raw) {
    throw new Error('A source URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error(`Invalid URL: ${inputUrl}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(host)) {
    throw new Error(`Expected an x.com or twitter.com URL, received "${parsed.hostname}".`);
  }

  parsed.hostname = host.includes('twitter.com') ? 'x.com' : 'x.com';
  parsed.protocol = 'https:';
  parsed.hash = '';
  parsed.search = '';
  const href = parsed.toString();
  return href.endsWith('/') ? href.slice(0, -1) : href;
}

function todayDate() {
  return nowIso().slice(0, 10);
}

function humanList(values, fallback = 'None') {
  return values && values.length ? values.join(', ') : fallback;
}

function summarizeText(value, maxLength = 220) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function extractMarkdownTitle(markdown) {
  const match = String(markdown || '').match(/^#\s+(.+)$/m);
  return match ? normalizeText(match[1]) : null;
}

function resolveLibraryRoot(args) {
  return path.resolve(args['library-root'] || DEFAULT_LIBRARY_ROOT);
}

function resolveCatalogPath(libraryRoot) {
  return path.join(libraryRoot, DEFAULT_CATALOG_PATH);
}

function resolveIndexPath(libraryRoot) {
  return path.join(libraryRoot, DEFAULT_INDEX_PATH);
}

function cleanImageUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'pbs.twimg.com') {
      parsed.searchParams.set('name', 'large');
      return parsed.toString();
    }
  } catch {
    return url;
  }
  return url;
}

function formatNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return String(value || '');
  if (numeric >= 1000000) return `${(numeric / 1000000).toFixed(1)}M`;
  if (numeric >= 1000) return `${(numeric / 1000).toFixed(1)}K`;
  return String(numeric);
}

function stripMd(text) {
  return String(text || '').replace(/\*\*/g, '').replace(/\*/g, '');
}

function applyInlineStyles(text, styleRanges) {
  if (!styleRanges || styleRanges.length === 0) return text;

  const length = text.length;
  const bold = new Uint8Array(length);
  const italic = new Uint8Array(length);
  const strike = new Uint8Array(length);

  for (const range of styleRanges) {
    const end = Math.min(range.offset + range.length, length);
    for (let index = range.offset; index < end; index += 1) {
      if (range.style === 'Bold') bold[index] = 1;
      else if (range.style === 'Italic') italic[index] = 1;
      else if (range.style === 'Strikethrough') strike[index] = 1;
    }
  }

  let result = '';
  let index = 0;

  while (index < length) {
    const isBold = bold[index];
    const isItalic = italic[index];
    const isStrike = strike[index];

    let end = index;
    while (
      end < length &&
      bold[end] === isBold &&
      italic[end] === isItalic &&
      strike[end] === isStrike
    ) {
      end += 1;
    }

    let segment = text.slice(index, end);
    if (isStrike) segment = `~~${segment}~~`;
    if (isItalic) segment = `*${segment}*`;
    if (isBold) segment = `**${segment}**`;
    result += segment;
    index = end;
  }

  return result;
}

function applyEntityLinks(text) {
  return text;
}

function resolveAtomicBlock(block, entityMap) {
  if (!block.entityRanges || block.entityRanges.length === 0 || !entityMap) return null;

  const entity = entityMap[block.entityRanges[0].key];
  if (!entity) return null;

  if (entity.type === 'IMAGE' || entity.type === 'PHOTO') {
    const url = entity.data?.src || entity.data?.url || entity.data?.media_url_https || '';
    if (url) return `![Image](${url})`;
  }

  if (entity.type === 'LINK') {
    return `[${entity.data?.url || 'Link'}](${entity.data?.url || ''})`;
  }

  if (entity.type === 'DIVIDER') {
    return '---';
  }

  return null;
}

function convertDraftBlocks(blocks, entityMap) {
  let markdown = '';
  let lastWasList = false;

  for (const block of blocks || []) {
    const isList = block.type === 'unordered-list-item' || block.type === 'ordered-list-item';
    if (!isList && lastWasList) {
      markdown += '\n';
    }
    lastWasList = isList;

    if (block.type === 'atomic') {
      const atomicMarkdown = resolveAtomicBlock(block, entityMap);
      if (atomicMarkdown) {
        markdown += `${atomicMarkdown}\n\n`;
      }
      continue;
    }

    let text = applyInlineStyles(block.text || '', block.inlineStyleRanges || []);
    text = applyEntityLinks(text, block.entityRanges || [], entityMap);
    if (!text.trim()) continue;

    switch (block.type) {
      case 'header-one':
      case 'header-two':
        markdown += `## ${stripMd(text)}\n\n`;
        break;
      case 'header-three':
        markdown += `### ${stripMd(text)}\n\n`;
        break;
      case 'blockquote':
        markdown += `> ${text}\n\n`;
        break;
      case 'unordered-list-item':
        markdown += `- ${text}\n`;
        break;
      case 'ordered-list-item':
        markdown += `1. ${text}\n`;
        break;
      case 'code-block':
        markdown += `\`\`\`\n${block.text || ''}\n\`\`\`\n\n`;
        break;
      default:
        markdown += `${text}\n\n`;
        break;
    }
  }

  return markdown;
}

function convertArticle(data) {
  const article = data.article || {};
  let markdown = '';

  if (article.title) {
    markdown += `# ${article.title}\n\n`;
  }

  if (data.author?.name) {
    markdown += `**Author**: ${data.author.name} ([@${data.author.handle}](https://x.com/${data.author.handle}))\n`;
  }
  if (article.createdAt) {
    markdown += `**Date**: ${new Date(article.createdAt).toISOString().split('T')[0]}\n`;
  }
  markdown += `**Source**: ${data.url}\n\n`;
  markdown += '---\n\n';

  if (article.coverImage) {
    markdown += `![Cover](${article.coverImage})\n\n`;
  }

  let entityMap = {};
  if (Array.isArray(article.entityMap)) {
    for (const entry of article.entityMap) {
      if (entry.key !== undefined && entry.value) {
        entityMap[entry.key] = entry.value;
      }
    }
  } else if (article.entityMap && typeof article.entityMap === 'object') {
    entityMap = article.entityMap;
  }

  if (article.blocks && article.blocks.length > 0) {
    markdown += convertDraftBlocks(article.blocks, entityMap);
  } else if (article.previewText) {
    markdown += `${article.previewText}\n`;
  }

  return markdown;
}

function convertTweet(data) {
  let markdown = '';

  if (data.author?.name) {
    markdown += `**Author**: ${data.author.name} ([@${data.author.handle}](https://x.com/${data.author.handle}))\n`;
  }
  if (data.createdAt) {
    const date = new Date(data.createdAt).toISOString().split('T')[0];
    markdown += `**Date**: ${date}\n`;
  }
  markdown += `**Source**: ${data.url}\n`;

  const stats = [];
  if (data.likes) stats.push(`${formatNumber(data.likes)} likes`);
  if (data.retweets) stats.push(`${formatNumber(data.retweets)} retweets`);
  if (data.views) stats.push(`${formatNumber(data.views)} views`);
  if (stats.length > 0) {
    markdown += `**Engagement**: ${stats.join(' | ')}\n`;
  }

  markdown += '\n---\n\n';

  if (data.text) {
    markdown += `${data.text}\n`;
  } else if (data.rawText) {
    markdown += `${data.rawText}\n`;
  }

  if (Array.isArray(data.media) && data.media.length > 0) {
    markdown += '\n';
    for (const media of data.media) {
      if (media.type === 'photo' || media.type === 'image') {
        markdown += `![${media.altText || 'Image'}](${cleanImageUrl(media.url)})\n\n`;
      } else if (media.type === 'video' || media.type === 'gif') {
        markdown += `[Video](${media.url})\n\n`;
      }
    }
  }

  if (data.quoteTweet) {
    markdown += `\n> **@${data.quoteTweet.authorHandle}** (${data.quoteTweet.authorName}):\n`;
    markdown += `> ${data.quoteTweet.text}\n\n`;
  }

  return markdown;
}

function convertToMarkdown(data) {
  return data.article ? convertArticle(data) : convertTweet(data);
}

function deriveSourceKind(sourceData) {
  return sourceData.article ? 'article' : 'tweet';
}

function deriveSourceTitle(sourceData) {
  if (normalizeText(sourceData.article?.title)) return normalizeText(sourceData.article.title);
  if (normalizeText(sourceData.text)) return summarizeText(sourceData.text, 120);
  if (normalizeText(sourceData.rawText)) return summarizeText(sourceData.rawText, 120);
  return 'Untitled X article';
}

function deriveAuthor(sourceData) {
  return {
    name: normalizeText(sourceData.author?.name),
    handle: normalizeText(sourceData.author?.handle),
  };
}

function deriveSourceCreatedAt(sourceData) {
  return normalizeText(sourceData.article?.createdAt) || normalizeText(sourceData.createdAt);
}

function derivePopularity(sourceData) {
  const snapshot = {};
  for (const key of ['likes', 'retweets', 'replies', 'views', 'bookmarks']) {
    if (sourceData[key] != null) {
      snapshot[key] = sourceData[key];
    }
  }
  return snapshot;
}

function ensureLibraryScaffold(libraryRoot) {
  ensureDir(libraryRoot);
  ensureDir(path.join(libraryRoot, 'archive'));
}

function walkMetadataFiles(rootDir, entries = []) {
  if (!fileExists(rootDir)) return entries;

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkMetadataFiles(absolutePath, entries);
      continue;
    }
    if (entry.isFile() && entry.name === 'metadata.json') {
      entries.push(absolutePath);
    }
  }

  return entries;
}

function buildCatalogEntry(metadataPath) {
  const metadata = readJson(metadataPath);
  const folderPath = path.dirname(metadataPath);
  const articlePath = path.join(folderPath, 'article.md');
  const researchPath = path.join(folderPath, 'research.md');
  const articleText = fileExists(articlePath) ? readText(articlePath) : '';
  const excerpt = summarizeText(articleText, 280);
  const searchText = [
    metadata.title,
    metadata.area,
    metadata.project,
    ...(metadata.tags || []),
    ...(metadata.topics || []),
    metadata.summary,
    metadata.whyItMatters,
    metadata.notes,
    metadata.trimNotes,
    metadata.author?.name,
    metadata.author?.handle,
    excerpt,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return {
    id: metadata.id,
    slug: metadata.slug,
    title: metadata.title,
    area: metadata.area,
    project: metadata.project,
    kind: metadata.kind,
    tags: metadata.tags || [],
    topics: metadata.topics || [],
    summary: metadata.summary || '',
    whyItMatters: metadata.whyItMatters || '',
    notes: metadata.notes || '',
    trimNotes: metadata.trimNotes || '',
    author: metadata.author || { name: null, handle: null },
    sourceUrl: metadata.sourceUrl,
    normalizedUrl: metadata.normalizedUrl,
    createdAt: metadata.createdAt || null,
    ingestedAt: metadata.ingestedAt,
    updatedAt: metadata.updatedAt,
    researchUpdatedAt: metadata.researchUpdatedAt || null,
    popularity: metadata.popularity || {},
    folderPath: displayPath(folderPath),
    overviewPath: displayPath(path.join(folderPath, 'overview.md')),
    articlePath: displayPath(articlePath),
    sourcePath: displayPath(path.join(folderPath, 'source.md')),
    sourceJsonPath: displayPath(path.join(folderPath, 'source.json')),
    researchPath: fileExists(researchPath) ? displayPath(researchPath) : null,
    excerpt,
    searchText,
  };
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || left.ingestedAt || 0) || 0;
    const rightTime = Date.parse(right.updatedAt || right.ingestedAt || 0) || 0;
    return rightTime - leftTime;
  });
}

function buildIndexMarkdown(catalog) {
  const entries = sortEntries(catalog.entries || []);
  const catalogRoot = absolutePath(catalog.libraryRoot);
  const linkToOverview = (entry) =>
    normalizeSlashes(path.relative(catalogRoot, absolutePath(entry.overviewPath)));
  const lines = [
    '# X Article Index',
    '',
    `Generated: ${catalog.generatedAt || nowIso()}`,
    '',
    'This index is maintained by `node scripts/x-articles.js rebuild-index`.',
    '',
  ];

  if (!entries.length) {
    lines.push('_No articles saved yet._', '');
    return lines.join('\n');
  }

  lines.push('## Recently Updated', '');
  for (const entry of entries.slice(0, 20)) {
    const author = entry.author?.handle ? `@${entry.author.handle}` : 'unknown author';
    lines.push(
      `- [${entry.title}](${linkToOverview(entry)}) | ${author} | ${entry.area} | tags: ${humanList(entry.tags, 'none')}`
    );
    if (entry.summary) {
      lines.push(`  Summary: ${entry.summary}`);
    }
  }
  lines.push('');

  const byArea = new Map();
  for (const entry of entries) {
    if (!byArea.has(entry.area)) byArea.set(entry.area, []);
    byArea.get(entry.area).push(entry);
  }

  lines.push('## By Area', '');
  for (const area of [...byArea.keys()].sort()) {
    lines.push(`### ${area}`, '');
    for (const entry of byArea.get(area)) {
      const author = entry.author?.handle ? `@${entry.author.handle}` : 'unknown author';
      lines.push(
        `- [${entry.title}](${linkToOverview(entry)}) | ${author} | tags: ${humanList(entry.tags, 'none')}`
      );
    }
    lines.push('');
  }

  const byTag = new Map();
  for (const entry of entries) {
    for (const tag of entry.tags || []) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(entry);
    }
  }

  lines.push('## By Tag', '');
  if (!byTag.size) {
    lines.push('_No tags yet._', '');
  } else {
    for (const tag of [...byTag.keys()].sort()) {
      const titles = byTag
        .get(tag)
        .map((entry) => `[${entry.title}](${linkToOverview(entry)})`)
        .join(', ');
      lines.push(`- **${tag}**: ${titles}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function rebuildCatalog(libraryRoot) {
  ensureLibraryScaffold(libraryRoot);
  const metadataFiles = walkMetadataFiles(libraryRoot);
  const entries = sortEntries(metadataFiles.map((metadataPath) => buildCatalogEntry(metadataPath)));
  const catalog = {
    generatedAt: nowIso(),
    libraryRoot: displayPath(libraryRoot),
    entries,
  };

  writeJson(resolveCatalogPath(libraryRoot), catalog);
  writeText(resolveIndexPath(libraryRoot), buildIndexMarkdown(catalog));
  return catalog;
}

function loadCatalog(libraryRoot) {
  const catalogPath = resolveCatalogPath(libraryRoot);
  if (!fileExists(catalogPath)) {
    return rebuildCatalog(libraryRoot);
  }
  const catalog = readJson(catalogPath);
  if (!Array.isArray(catalog.entries)) {
    return rebuildCatalog(libraryRoot);
  }
  return catalog;
}

function findCatalogEntryByUrl(catalog, targetUrl) {
  const normalized = normalizeUrl(targetUrl);
  return catalog.entries.find((entry) => entry.normalizedUrl === normalized) || null;
}

function findCatalogEntry(catalog, args) {
  if (args.slug) {
    return catalog.entries.find((entry) => entry.slug === args.slug) || null;
  }
  if (args.url) {
    return findCatalogEntryByUrl(catalog, args.url);
  }
  return null;
}

function ensureUniqueFolder(areaRoot, baseSlug, excludePath = null) {
  const initialSlug = baseSlug || crypto.randomUUID().slice(0, 8);
  let index = 1;
  let candidateSlug = initialSlug;

  while (true) {
    const candidatePath = path.join(areaRoot, candidateSlug);
    if (!fileExists(candidatePath) || normalizeSlashes(candidatePath) === normalizeSlashes(excludePath || '')) {
      return {
        slug: candidateSlug,
        path: candidatePath,
      };
    }
    index += 1;
    candidateSlug = `${initialSlug}-${index}`;
  }
}

function normalizeMeta(meta, sourceData, cleanMarkdown) {
  const title =
    normalizeText(meta.title) ||
    extractMarkdownTitle(cleanMarkdown) ||
    deriveSourceTitle(sourceData);
  const area = slugify(meta.area || '');
  if (!area) {
    throw new Error('The meta file must include an "area".');
  }
  if (!KNOWN_AREAS.includes(area)) {
    throw new Error(`Invalid area "${meta.area}". Use one of: ${KNOWN_AREAS.join(', ')}.`);
  }

  const project = normalizeText(meta.project) ? slugify(meta.project) : null;
  const summary =
    normalizeText(meta.summary) || summarizeText(cleanMarkdown.replace(/^#.+$/m, ''), 260);
  const whyItMatters = normalizeText(meta.whyItMatters) || null;
  const trimNotes = normalizeText(meta.trimNotes) || null;
  const notes = normalizeText(meta.notes) || null;
  const tags = listToArray(meta.tags || [], { slugifyItems: true });
  const topics = listToArray(meta.topics || []);
  const requestedSlug = slugify(meta.slug || title);

  return {
    title,
    area,
    project,
    summary,
    whyItMatters,
    trimNotes,
    notes,
    tags,
    topics,
    requestedSlug,
  };
}

function buildOverviewMarkdown(metadata) {
  const lines = [
    `# X Article: ${metadata.title}`,
    '',
    '## Tracking',
    '',
    `- Area: ${metadata.area}`,
    `- Project: ${metadata.project || 'None'}`,
    `- Type: ${metadata.kind}`,
    `- Author: ${metadata.author?.name || 'Unknown'}${metadata.author?.handle ? ` (@${metadata.author.handle})` : ''}`,
    `- Added: ${metadata.ingestedAt}`,
    `- Updated: ${metadata.updatedAt}`,
    `- Source: ${metadata.sourceUrl}`,
    `- Tags: ${humanList(metadata.tags, 'None')}`,
    `- Topics: ${humanList(metadata.topics, 'None')}`,
  ];

  const popularity = [];
  if (metadata.popularity?.likes != null) popularity.push(`${formatNumber(metadata.popularity.likes)} likes`);
  if (metadata.popularity?.retweets != null) popularity.push(`${formatNumber(metadata.popularity.retweets)} reposts`);
  if (metadata.popularity?.views != null) popularity.push(`${formatNumber(metadata.popularity.views)} views`);
  if (popularity.length) {
    lines.push(`- Engagement snapshot: ${popularity.join(' | ')}`);
  }

  lines.push('', '## Summary', '', metadata.summary || '_No summary yet._', '');

  lines.push('## Why It Matters', '', metadata.whyItMatters || '_No relevance note yet._', '');

  lines.push('## Curation', '', `- Promotional trimming: ${metadata.trimNotes || 'None noted.'}`);
  lines.push(`- Notes: ${metadata.notes || 'None yet.'}`, '');

  lines.push('## Files', '', '- `article.md` for the cleaned, retrieval-friendly copy');
  lines.push('- `source.md` for the raw xtomd Markdown output');
  lines.push('- `source.json` for the raw xtomd response payload');
  lines.push('- `research.md` for follow-up fact-checking and extended research', '');

  return lines.join('\n');
}

async function fetchFromXtomd(inputUrl) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is unavailable in this Node runtime.');
  }

  const normalizedInputUrl = normalizeUrl(inputUrl);
  const response = await fetch('https://xtomd.com/api/fetch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: normalizedInputUrl }),
  });

  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new Error(`xtomd returned a non-JSON response: ${body.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(data.error || `xtomd request failed with status ${response.status}.`);
  }

  return {
    data,
    normalizedInputUrl,
    normalizedSourceUrl: normalizeUrl(data.url || normalizedInputUrl),
  };
}

async function handleFetch(args) {
  const libraryRoot = resolveLibraryRoot(args);
  const requestedUrl = args.url;
  if (!requestedUrl) {
    throw new Error('Missing required --url for fetch.');
  }

  const outDir = args['out-dir']
    ? path.resolve(args['out-dir'])
    : fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-x-article-'));

  ensureDir(outDir);

  const { data, normalizedSourceUrl, normalizedInputUrl } = await fetchFromXtomd(requestedUrl);
  const rawMarkdown = convertToMarkdown(data);
  if (!normalizeText(rawMarkdown)) {
    throw new Error('xtomd returned no Markdown content.');
  }

  const sourceJsonPath = path.join(outDir, 'source.json');
  const rawMarkdownPath = path.join(outDir, 'raw.md');
  writeJson(sourceJsonPath, data);
  writeText(rawMarkdownPath, rawMarkdown);

  const author = deriveAuthor(data);
  const title = deriveSourceTitle(data);
  const catalog = loadCatalog(libraryRoot);
  const existing = findCatalogEntryByUrl(catalog, normalizedSourceUrl);
  const suggestedSlug =
    slugify(title) ||
    slugify(`${author.handle || 'x'}-${data.article?.id || data.id || Date.now()}`);

  return {
    inputUrl: normalizedInputUrl,
    normalizedUrl: normalizedSourceUrl,
    kind: deriveSourceKind(data),
    title,
    author,
    createdAt: deriveSourceCreatedAt(data),
    cached: Boolean(data.cached),
    popularity: derivePopularity(data),
    outDir,
    sourceJsonPath,
    rawMarkdownPath,
    suggestedSlug,
    existing: existing
      ? {
          slug: existing.slug,
          area: existing.area,
          folderPath: existing.folderPath,
          overviewPath: existing.overviewPath,
        }
      : null,
  };
}

function ingestEntry(args) {
  const libraryRoot = resolveLibraryRoot(args);
  ensureLibraryScaffold(libraryRoot);

  const sourceJsonPath = path.resolve(args['source-json'] || '');
  const rawMarkdownPath = path.resolve(args['raw-markdown'] || '');
  const cleanMarkdownPath = path.resolve(args['clean-markdown'] || '');
  const metaPath = path.resolve(args.meta || '');

  if (!fileExists(sourceJsonPath)) {
    throw new Error('Missing required --source-json file for ingest.');
  }
  if (!fileExists(rawMarkdownPath)) {
    throw new Error('Missing required --raw-markdown file for ingest.');
  }
  if (!fileExists(cleanMarkdownPath)) {
    throw new Error('Missing required --clean-markdown file for ingest.');
  }
  if (!fileExists(metaPath)) {
    throw new Error('Missing required --meta file for ingest.');
  }

  const sourceData = readJson(sourceJsonPath);
  const rawMarkdown = readText(rawMarkdownPath);
  const cleanMarkdown = readText(cleanMarkdownPath);
  const meta = readJson(metaPath);
  const normalizedMeta = normalizeMeta(meta, sourceData, cleanMarkdown);
  const normalizedUrl = normalizeUrl(sourceData.url || meta.url || '');

  const catalog = loadCatalog(libraryRoot);
  const existing = findCatalogEntryByUrl(catalog, normalizedUrl);

  const areaRoot = path.join(libraryRoot, normalizedMeta.area);
  ensureDir(areaRoot);

  let entryRoot = null;
  let slug = normalizedMeta.requestedSlug || crypto.randomUUID().slice(0, 8);

  if (existing) {
    const currentRoot = absolutePath(existing.folderPath);
    const currentArea = existing.area;
    const areaChanged = currentArea !== normalizedMeta.area;
    const slugChanged = existing.slug !== slug && slug;

    if (!areaChanged && !slugChanged) {
      entryRoot = currentRoot;
      slug = existing.slug;
    } else {
      const nextFolder = ensureUniqueFolder(
        areaRoot,
        slug || existing.slug,
        currentRoot
      );
      slug = nextFolder.slug;
      entryRoot = nextFolder.path;
      if (normalizeSlashes(currentRoot) !== normalizeSlashes(entryRoot)) {
        ensureDir(path.dirname(entryRoot));
        if (fileExists(currentRoot)) {
          fs.renameSync(currentRoot, entryRoot);
        }
      }
    }
  } else {
    const nextFolder = ensureUniqueFolder(areaRoot, slug);
    slug = nextFolder.slug;
    entryRoot = nextFolder.path;
  }

  ensureDir(entryRoot);

  const existingMetadataPath = path.join(entryRoot, 'metadata.json');
  const existingMetadata = fileExists(existingMetadataPath) ? readJson(existingMetadataPath) : null;
  const now = nowIso();

  const metadata = {
    id: existingMetadata?.id || crypto.randomUUID(),
    slug,
    title: normalizedMeta.title,
    kind: deriveSourceKind(sourceData),
    area: normalizedMeta.area,
    project: normalizedMeta.project,
    tags: normalizedMeta.tags,
    topics: normalizedMeta.topics,
    summary: normalizedMeta.summary,
    whyItMatters: normalizedMeta.whyItMatters,
    trimNotes: normalizedMeta.trimNotes,
    notes: normalizedMeta.notes,
    author: deriveAuthor(sourceData),
    sourceUrl: normalizeUrl(sourceData.url || normalizedUrl),
    normalizedUrl,
    createdAt: deriveSourceCreatedAt(sourceData),
    ingestedAt: existingMetadata?.ingestedAt || now,
    updatedAt: now,
    researchUpdatedAt: existingMetadata?.researchUpdatedAt || null,
    popularity: derivePopularity(sourceData),
  };

  writeJson(path.join(entryRoot, 'source.json'), sourceData);
  writeText(path.join(entryRoot, 'source.md'), rawMarkdown);
  writeText(path.join(entryRoot, 'article.md'), cleanMarkdown);
  writeJson(existingMetadataPath, metadata);
  writeText(path.join(entryRoot, 'overview.md'), buildOverviewMarkdown(metadata));

  const rebuiltCatalog = rebuildCatalog(libraryRoot);
  const catalogEntry = rebuiltCatalog.entries.find((entry) => entry.normalizedUrl === normalizedUrl);

  return {
    metadata,
    entry: catalogEntry,
    folderPath: displayPath(entryRoot),
    overviewPath: displayPath(path.join(entryRoot, 'overview.md')),
    articlePath: displayPath(path.join(entryRoot, 'article.md')),
    sourcePath: displayPath(path.join(entryRoot, 'source.md')),
    sourceJsonPath: displayPath(path.join(entryRoot, 'source.json')),
    catalogPath: displayPath(resolveCatalogPath(libraryRoot)),
    indexPath: displayPath(resolveIndexPath(libraryRoot)),
  };
}

function scoreEntry(entry, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 1;

  const terms = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;

  let score = 0;
  const title = entry.title.toLowerCase();
  const summary = (entry.summary || '').toLowerCase();
  const tags = (entry.tags || []).map((tag) => tag.toLowerCase());
  const topics = (entry.topics || []).map((topic) => topic.toLowerCase());
  const project = (entry.project || '').toLowerCase();
  const authorHandle = (entry.author?.handle || '').toLowerCase();
  const authorName = (entry.author?.name || '').toLowerCase();
  const searchText = (entry.searchText || '').toLowerCase();

  for (const term of terms) {
    if (title.includes(term)) score += 8;
    if (summary.includes(term)) score += 6;
    if (entry.area === term) score += 5;
    if (project && project.includes(term)) score += 5;
    if (tags.some((tag) => tag.includes(term))) score += 10;
    if (topics.some((topic) => topic.includes(term))) score += 7;
    if (authorHandle.includes(term) || authorName.includes(term)) score += 4;
    if (searchText.includes(term)) score += 2;
  }

  return score;
}

function runSearch(args) {
  const libraryRoot = resolveLibraryRoot(args);
  const catalog = loadCatalog(libraryRoot);
  const limit = parseInteger(args.limit, '--limit') || 10;
  const query = normalizeText(args.query);
  const area = normalizeText(args.area) ? slugify(args.area) : null;
  const project = normalizeText(args.project) ? slugify(args.project) : null;
  const author = normalizeText(args.author)
    ? normalizeText(args.author).replace(/^@/, '').toLowerCase()
    : null;
  const tags = listToArray(args.tag || '', { slugifyItems: true });

  const matches = catalog.entries
    .filter((entry) => {
      if (area && entry.area !== area) return false;
      if (project && entry.project !== project) return false;
      if (author && (entry.author?.handle || '').toLowerCase() !== author) return false;
      if (tags.length && !tags.every((tag) => (entry.tags || []).includes(tag))) return false;
      const score = scoreEntry(entry, query);
      return !query || score > 0;
    })
    .map((entry) => ({
      ...entry,
      score: scoreEntry(entry, query),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
    })
    .slice(0, limit)
    .map(({ searchText, ...entry }) => entry);

  return {
    query,
    area,
    project,
    author,
    tags,
    count: matches.length,
    results: matches,
  };
}

function showEntry(args) {
  const libraryRoot = resolveLibraryRoot(args);
  const catalog = loadCatalog(libraryRoot);
  const match = findCatalogEntry(catalog, args);
  if (!match) {
    return null;
  }
  const { searchText, ...entry } = match;
  return entry;
}

function attachResearch(args) {
  const libraryRoot = resolveLibraryRoot(args);
  const catalog = loadCatalog(libraryRoot);
  const match = findCatalogEntry(catalog, args);
  if (!match) {
    throw new Error('Could not find a stored X article entry for the given slug or URL.');
  }

  const researchFile = path.resolve(args.file || '');
  if (!fileExists(researchFile)) {
    throw new Error('Missing required --file for attach-research.');
  }

  const researchMarkdown = readText(researchFile);
  if (!normalizeText(researchMarkdown)) {
    throw new Error('The research file is empty.');
  }

  const entryRoot = absolutePath(match.folderPath);
  const metadataPath = path.join(entryRoot, 'metadata.json');
  const metadata = readJson(metadataPath);
  const now = nowIso();

  writeText(path.join(entryRoot, 'research.md'), researchMarkdown);
  metadata.researchUpdatedAt = now;
  metadata.updatedAt = now;
  writeJson(metadataPath, metadata);
  writeText(path.join(entryRoot, 'overview.md'), buildOverviewMarkdown(metadata));

  rebuildCatalog(libraryRoot);

  return {
    slug: metadata.slug,
    title: metadata.title,
    folderPath: displayPath(entryRoot),
    researchPath: displayPath(path.join(entryRoot, 'research.md')),
    updatedAt: now,
  };
}

function renderTextResult(command, result) {
  switch (command) {
    case 'fetch':
      return [
        `Fetched ${result.kind}: ${result.title}`,
        `Temp dir: ${result.outDir}`,
        `Raw Markdown: ${result.rawMarkdownPath}`,
        `Source JSON: ${result.sourceJsonPath}`,
        result.existing ? `Already stored at: ${result.existing.overviewPath}` : 'Not yet stored in the library.',
      ].join('\n');
    case 'ingest':
      return [
        `Stored X article: ${result.metadata.title}`,
        `Folder: ${result.folderPath}`,
        `Overview: ${result.overviewPath}`,
        `Article: ${result.articlePath}`,
        `Source: ${result.sourcePath}`,
      ].join('\n');
    case 'search':
      if (!result.results.length) {
        return 'No matching X articles found.';
      }
      return result.results
        .map((entry) => {
          const author = entry.author?.handle ? `@${entry.author.handle}` : 'unknown author';
          return `${entry.score} | ${entry.area} | ${author} | ${entry.title} | ${entry.overviewPath}`;
        })
        .join('\n');
    case 'show':
      if (!result) return 'No matching X article entry found.';
      return [
        result.title,
        `Overview: ${result.overviewPath}`,
        `Article: ${result.articlePath}`,
        `Source: ${result.sourcePath}`,
        `Tags: ${humanList(result.tags, 'none')}`,
      ].join('\n');
    case 'attach-research':
      return [
        `Updated research for: ${result.title}`,
        `Folder: ${result.folderPath}`,
        `Research: ${result.researchPath}`,
      ].join('\n');
    case 'rebuild-index':
      return `Indexed ${result.entries.length} X article(s).`;
    default:
      return JSON.stringify(result, null, 2);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'help';
  const asJson = Boolean(args.json);

  let result;
  if (command === 'help') {
    usage();
    return;
  }
  if (command === 'fetch') {
    result = await handleFetch(args);
  } else if (command === 'ingest') {
    result = ingestEntry(args);
  } else if (command === 'search') {
    result = runSearch(args);
  } else if (command === 'show') {
    result = showEntry(args);
  } else if (command === 'attach-research') {
    result = attachResearch(args);
  } else if (command === 'rebuild-index') {
    result = rebuildCatalog(resolveLibraryRoot(args));
  } else {
    usage();
    process.exitCode = 1;
    return;
  }

  if (asJson) {
    writeStdout(JSON.stringify(result, null, 2));
    return;
  }

  writeStdout(renderTextResult(command, result));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
