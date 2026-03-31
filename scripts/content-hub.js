#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.resolve(WORKSPACE, '..');
const CONTENT_ROOT = path.join(OPENCLAW_HOME, 'knowledge', 'content');
const ITEMS_ROOT = path.join(CONTENT_ROOT, 'items');
const LEGACY_DRAFTS_ROOT = path.join(CONTENT_ROOT, 'drafts');
const HUB_PATH = path.join(CONTENT_ROOT, 'HUB.md');
const IDEAS_PATH = path.join(CONTENT_ROOT, 'IDEAS.md');
const LEGACY_IDEAS_PATH = path.join(LEGACY_DRAFTS_ROOT, 'IDEAS.md');
const STATE_ROOT = path.join(OPENCLAW_HOME, 'workspace', 'state', 'content-hub');
const INDEX_PATH = path.join(STATE_ROOT, 'index.json');

const ITEM_STATES = [
  'idea',
  'drafting',
  'review',
  'changes_requested',
  'approved',
  'posted',
  'rejected',
  'archived',
];
const REVIEW_DECISIONS = ['approve', 'reject', 'changes_requested'];
const PLATFORM_DISPLAY = {
  x: 'X',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
};
const PLATFORM_ALIASES = {
  x: 'x',
  twitter: 'x',
  'x-twitter': 'x',
  'x-twitter-thread': 'x',
  'x-thread': 'x',
  linkedin: 'linkedin',
  reddit: 'reddit',
  base: 'base',
};

function usage() {
  console.log(`OpenClaw markdown-native content hub

Commands:
  summary [--json]
  scan [--json]
  list [--json] [--state <value>] [--channel-state <value>] [--platform <name>] [--review <decision>] [--limit <n>]
  create --title "<title>" [--slug <slug>] [--type <post|thread|note>] [--state <value>] [--project <label>] [--source "<text>"] [--platform <name>] [--series <label>] [--campaign <label>] [--theme <label>] [--persona <label>] [--tag <label>] [--intent "<text>"] [--json]
  review --slug <slug> [--target base|<platform>] [--platform <name>] --decision <approve|reject|changes_requested> [--reviewer <name>] [--summary "<text>"] [--notes "<text>"] [--applies-to <label>] [--json]
  approve --slug <slug> [--target base|<platform>] [--platform <name>] [--reviewer <name>] [--summary "<text>"] [--notes "<text>"] [--json]
  reject --slug <slug> [--target base|<platform>] [--platform <name>] [--reviewer <name>] [--summary "<text>"] [--notes "<text>"] [--json]
  suggest-edits --slug <slug> [--target base|<platform>] [--platform <name>] [--reviewer <name>] [--summary "<text>"] [--notes "<text>"] [--json]
  mark-posted --slug <slug> --platform <name> [--posted-at <iso>] [--url <url>] [--analytics-ref <ref>] [--json]
  migrate-legacy [--json]
`);
}

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return nowIso().slice(0, 10);
}

function normalizePath(targetPath) {
  return String(targetPath || '').split(path.sep).join('/');
}

function relativeToOpenclaw(absolutePath) {
  return normalizePath(path.relative(OPENCLAW_HOME, absolutePath));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n') : null;
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content.replace(/\r\n/g, '\n'), 'utf8');
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function humanizeSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeNullable(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const lowered = text.toLowerCase();
  if (['none', 'null', 'n/a', 'na', 'unscheduled', '--'].includes(lowered)) {
    return null;
  }
  return text;
}

function normalizeState(value, fallback = 'idea') {
  const normalized = normalizeText(value)?.toLowerCase().replace(/\s+/g, '_') || fallback;
  const mapped =
    {
      draft: 'drafting',
      in_progress: 'drafting',
      inprogress: 'drafting',
      needs_review: 'review',
      changes_requested: 'changes_requested',
      changesrequested: 'changes_requested',
      approved: 'approved',
      published: 'posted',
    }[normalized] || normalized;

  if (!ITEM_STATES.includes(mapped)) {
    throw new Error(`Invalid state "${value}". Use one of: ${ITEM_STATES.join(', ')}.`);
  }
  return mapped;
}

function normalizeDecision(value) {
  const normalized = normalizeText(value)?.toLowerCase().replace(/\s+/g, '_');
  const mapped =
    {
      approve: 'approve',
      approved: 'approve',
      reject: 'reject',
      rejected: 'reject',
      changes_requested: 'changes_requested',
      needs_edits: 'changes_requested',
      edits_requested: 'changes_requested',
      suggest_edits: 'changes_requested',
    }[normalized] || normalized;

  if (!REVIEW_DECISIONS.includes(mapped)) {
    throw new Error(`Invalid review decision "${value}". Use one of: ${REVIEW_DECISIONS.join(', ')}.`);
  }
  return mapped;
}

function stateFromDecision(decision) {
  if (decision === 'approve') return 'approved';
  if (decision === 'reject') return 'rejected';
  return 'changes_requested';
}

function canonicalPlatform(value) {
  const normalized = normalizeText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || null;
  if (!normalized) return null;
  return PLATFORM_ALIASES[normalized] || normalized;
}

function platformLabel(platform) {
  return PLATFORM_DISPLAY[platform] || humanizeSlug(platform);
}

function parseCsvValue(value) {
  const text = normalizeNullable(value);
  if (!text) return [];
  return text
    .split(',')
    .map((entry) => normalizeNullable(entry))
    .filter(Boolean);
}

function uniqueList(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseBooleanFlag(value, fallback = false) {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (['yes', 'true', '1'].includes(text.toLowerCase())) return true;
  if (['no', 'false', '0'].includes(text.toLowerCase())) return false;
  return fallback;
}

function formatNullable(value, fallback = 'none') {
  return normalizeNullable(value) || fallback;
}

function formatCsv(values) {
  return values && values.length ? values.join(', ') : 'none';
}

function sectionHeading(heading) {
  return `## ${heading}`;
}

function extractHeadingBody(text, heading, options = {}) {
  const source = String(text || '').replace(/\r\n/g, '\n');
  const lines = source.split('\n');
  const headingLine = sectionHeading(heading);
  const start = lines.findIndex((line) => line.trim() === headingLine);
  if (start === -1) return '';

  const { nextHeadings = null, untilEof = false } = options;
  let end = lines.length;

  if (!untilEof) {
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line.startsWith('## ')) continue;
      if (!nextHeadings || nextHeadings.includes(line.slice(3))) {
        end = index;
        break;
      }
    }
  }

  return trimBlankLines(lines.slice(start + 1, end).join('\n'));
}

function trimBlankLines(text) {
  return String(text || '').replace(/^\n+|\n+$/g, '');
}

function extractTitle(text) {
  const match = String(text || '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function parseMetadata(text) {
  const metadata = {};
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2];
    metadata[key] = value.trim();
  }
  return metadata;
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/^#+\s+/gm, '')
    .replace(/[`*_>\[\]\(\)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text) {
  const words = stripMarkdown(text).split(/\s+/).filter(Boolean);
  return words.length;
}

function excerpt(text, maxLength = 160) {
  const plain = stripMarkdown(text);
  if (!plain) return null;
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength - 1).trim()}…`;
}

function listDirectories(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listMarkdownFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
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
    const value = !next || next.startsWith('--') ? true : next;
    if (value !== true) index += 1;

    if (args[key] === undefined) {
      args[key] = value;
    } else if (Array.isArray(args[key])) {
      args[key].push(value);
    } else {
      args[key] = [args[key], value];
    }
  }

  return args;
}

function readMultiValue(args, key) {
  const value = args[key];
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => (entry === true ? [] : [entry]))
      .map((entry) => String(entry));
  }
  return value === true ? [] : [String(value)];
}

function firstValue(value, fallback = null) {
  if (Array.isArray(value)) return value.length ? value[value.length - 1] : fallback;
  if (value === undefined || value === true) return fallback;
  return value;
}

function ensureScaffold() {
  ensureDir(CONTENT_ROOT);
  ensureDir(ITEMS_ROOT);
  ensureDir(path.join(CONTENT_ROOT, 'archive'));
  ensureDir(path.join(CONTENT_ROOT, '_archive'));
  ensureDir(STATE_ROOT);
}

function seedIdeasBoard(summary = null) {
  if (!fs.existsSync(LEGACY_IDEAS_PATH)) return 'missing_legacy';
  const legacy = readText(LEGACY_IDEAS_PATH);
  const existing = readText(IDEAS_PATH);
  if (existing === legacy) {
    if (summary) summary.unchanged.push(relativeToOpenclaw(IDEAS_PATH));
    return 'unchanged';
  }
  if (existing != null && existing !== legacy) {
    if (summary) summary.skipped.push(relativeToOpenclaw(IDEAS_PATH));
    return 'skipped';
  }
  writeText(IDEAS_PATH, legacy);
  if (summary) summary.created.push(relativeToOpenclaw(IDEAS_PATH));
  return 'created';
}

function renderOverview(item) {
  return `# Content Item: ${item.title}

## Metadata
ID: ${item.id}
Slug: ${item.slug}
Type: ${item.type}
State: ${item.state}
Parent Item: ${formatNullable(item.parentItem)}
Project: ${formatNullable(item.project)}
Platforms: ${formatCsv(item.platforms)}
Series: ${formatNullable(item.series)}
Campaign: ${formatNullable(item.campaign)}
Theme: ${formatNullable(item.theme)}
Persona: ${formatNullable(item.persona)}
Tags: ${formatCsv(item.tags)}
Source: ${formatNullable(item.source)}
Created: ${item.created}
Updated: ${item.updated}
Legacy Path: ${formatNullable(item.legacyPath)}
Legacy Status: ${formatNullable(item.legacyStatus)}
Legacy Review: ${formatNullable(item.legacyReview)}

## Intent
${trimBlankLines(item.intent) || 'Summarize the angle, audience, and intended outcome here.'}

## Workflow
- Base draft lives in \`draft.md\`
- Working notes live in \`notes.md\`
- Channel variants live in \`channels/\`
- Review history lives in \`reviews/\`

## Origin
${trimBlankLines(item.origin) || `Managed by \`workspace/scripts/content-hub.js\` on ${todayDate()}.`}
`;
}

function renderChannel(channel) {
  return `# Channel Variant: ${platformLabel(channel.platform)}

## Metadata
Platform: ${channel.platform}
State: ${channel.state}
Uses Base Draft: ${channel.usesBaseDraft ? 'yes' : 'no'}
Scheduled For: ${formatNullable(channel.scheduledFor)}
Posted At: ${formatNullable(channel.postedAt)}
Post URL: ${formatNullable(channel.postUrl)}
Analytics Ref: ${formatNullable(channel.analyticsRef)}
Created: ${channel.created}
Updated: ${channel.updated}

## Notes
${trimBlankLines(channel.notes) ||
  'Start from `../draft.md` and only add custom copy below when the platform genuinely needs a rewrite.'}

## Copy
${trimBlankLines(channel.copyBody)}
`;
}

function renderReview(review) {
  return `# Review Event: ${review.decision} for ${review.target}

## Metadata
Timestamp: ${review.timestamp}
Decision: ${review.decision}
Target: ${review.target}
Reviewer: ${review.reviewer}
State After Review: ${review.stateAfterReview}
Summary: ${formatNullable(review.summary)}
Applies To: ${formatNullable(review.appliesTo)}

## Notes
${trimBlankLines(review.notes) || '_No additional notes._'}
`;
}

function defaultDraftContent(title) {
  return `# Draft: ${title}

`;
}

function defaultNotesContent(title) {
  return `# Notes: ${title}

## Sources

## Research

## Rewrite Notes
`;
}

function parseLegacyTrackingValue(trackingSection, label) {
  const match = String(trackingSection || '').match(new RegExp(`^-\\s+${label}:\\s*(.*)$`, 'mi'));
  return match ? match[1].trim() : null;
}

function mapLegacyState(legacyStatus) {
  const lowered = normalizeText(legacyStatus)?.toLowerCase() || 'draft';
  if (lowered === 'idea') return 'idea';
  if (lowered === 'draft') return 'drafting';
  if (lowered === 'review') return 'review';
  if (lowered === 'changes requested') return 'changes_requested';
  if (lowered === 'approved') return 'approved';
  if (lowered === 'published') return 'posted';
  if (lowered === 'rejected') return 'rejected';
  if (lowered === 'archived') return 'archived';
  return 'drafting';
}

function mapLegacyDecision(legacyReview) {
  const lowered = normalizeText(legacyReview)?.toLowerCase() || '';
  if (!lowered || lowered === 'none') return null;
  if (lowered.includes('reject')) return 'reject';
  if (lowered.includes('approve')) return 'approve';
  if (lowered.includes('change') || lowered.includes('edit')) return 'changes_requested';
  return null;
}

function inferLegacyDates(folderPath) {
  const files = ['overview.md', 'draft.md', 'notes.md']
    .map((name) => path.join(folderPath, name))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.statSync(filePath).mtime.getTime());

  if (!files.length) {
    return { created: nowIso(), updated: nowIso() };
  }

  return {
    created: new Date(Math.min(...files)).toISOString(),
    updated: new Date(Math.max(...files)).toISOString(),
  };
}

function parseLegacyOverview(text, slug, folderPath) {
  const title = extractTitle(text)?.replace(/^Content Item:\s*/, '') || humanizeSlug(slug);
  const tracking = extractHeadingBody(text, 'Tracking');
  const intent = extractHeadingBody(text, 'Intent', { nextHeadings: ['Source'] });
  const sourceSection = extractHeadingBody(text, 'Source');
  const legacyStatus = parseLegacyTrackingValue(tracking, 'Status') || 'Draft';
  const legacyReview = parseLegacyTrackingValue(tracking, 'Review') || 'None';
  const legacyType = parseLegacyTrackingValue(tracking, 'Asset type') || 'Post';
  const project = normalizeNullable(parseLegacyTrackingValue(tracking, 'Project'));
  const platforms = uniqueList(
    parseCsvValue(parseLegacyTrackingValue(tracking, 'Platforms')).map((platform) => canonicalPlatform(platform))
  );
  const sourceFromTracking = normalizeNullable(parseLegacyTrackingValue(tracking, 'Source'));
  const source = sourceFromTracking || normalizeNullable(sourceSection);
  const publishDate = normalizeNullable(parseLegacyTrackingValue(tracking, 'Publish date'));
  const dates = inferLegacyDates(folderPath);

  return {
    id: slug,
    slug,
    title,
    type: slugify(legacyType) || 'post',
    state: mapLegacyState(legacyStatus),
    parentItem: null,
    project,
    platforms,
    series: null,
    campaign: null,
    theme: null,
    persona: null,
    tags: [],
    source,
    created: dates.created,
    updated: dates.updated,
    intent,
    origin: `Migrated from \`${normalizePath(path.join('knowledge', 'content', 'drafts', slug))}\` on ${todayDate()}.`,
    legacyPath: normalizePath(path.join('knowledge', 'content', 'drafts', slug)),
    legacyStatus,
    legacyReview,
    publishDate,
    legacySourceSection: sourceSection,
  };
}

function loadChannel(itemDir, fileName) {
  const channelPath = path.join(itemDir, 'channels', fileName);
  const text = readText(channelPath);
  if (!text) return null;

  const metadata = parseMetadata(extractHeadingBody(text, 'Metadata'));
  const platform = canonicalPlatform(metadata.Platform || path.basename(fileName, '.md'));
  const state = normalizeState(metadata.State || 'drafting', 'drafting');

  return {
    platform,
    state,
    usesBaseDraft: parseBooleanFlag(metadata['Uses Base Draft'], true),
    scheduledFor: normalizeNullable(metadata['Scheduled For']),
    postedAt: normalizeNullable(metadata['Posted At']),
    postUrl: normalizeNullable(metadata['Post URL']),
    analyticsRef: normalizeNullable(metadata['Analytics Ref']),
    created: normalizeNullable(metadata.Created) || nowIso(),
    updated: normalizeNullable(metadata.Updated) || nowIso(),
    notes: extractHeadingBody(text, 'Notes', { nextHeadings: ['Copy'] }),
    copyBody: extractHeadingBody(text, 'Copy', { untilEof: true }),
    path: relativeToOpenclaw(channelPath),
  };
}

function loadReview(itemDir, fileName) {
  const reviewPath = path.join(itemDir, 'reviews', fileName);
  const text = readText(reviewPath);
  if (!text) return null;

  const metadata = parseMetadata(extractHeadingBody(text, 'Metadata'));
  const timestamp = normalizeNullable(metadata.Timestamp) || nowIso();
  const decision = normalizeDecision(metadata.Decision || 'changes_requested');
  const target = canonicalPlatform(metadata.Target) || 'base';

  return {
    timestamp,
    decision,
    target,
    reviewer: normalizeNullable(metadata.Reviewer) || 'agent',
    stateAfterReview: normalizeState(metadata['State After Review'] || stateFromDecision(decision)),
    summary: normalizeNullable(metadata.Summary),
    appliesTo: normalizeNullable(metadata['Applies To']),
    notes: extractHeadingBody(text, 'Notes', { untilEof: true }),
    path: relativeToOpenclaw(reviewPath),
  };
}

function getLatestReviewMap(reviews) {
  const latest = {};
  const sorted = [...reviews].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  for (const review of sorted) {
    latest[review.target] = review;
  }
  return latest;
}

function compareDesc(left, right) {
  return String(right || '').localeCompare(String(left || ''));
}

function loadItem(itemDirName) {
  const itemDir = path.join(ITEMS_ROOT, itemDirName);
  const overviewPath = path.join(itemDir, 'overview.md');
  const overviewText = readText(overviewPath);
  if (!overviewText) return null;

  const metadata = parseMetadata(extractHeadingBody(overviewText, 'Metadata'));
  const slug = normalizeNullable(metadata.Slug) || itemDirName;
  const channels = listMarkdownFiles(path.join(itemDir, 'channels'))
    .map((fileName) => loadChannel(itemDir, fileName))
    .filter(Boolean)
    .sort((left, right) => left.platform.localeCompare(right.platform));
  const reviews = listMarkdownFiles(path.join(itemDir, 'reviews'))
    .map((fileName) => loadReview(itemDir, fileName))
    .filter(Boolean)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const latestReviews = getLatestReviewMap(reviews);
  const platforms = uniqueList([
    ...parseCsvValue(metadata.Platforms).map((platform) => canonicalPlatform(platform)),
    ...channels.map((channel) => channel.platform),
  ]);
  const title = extractTitle(overviewText)?.replace(/^Content Item:\s*/, '') || humanizeSlug(slug);

  const hydratedChannels = [...channels];
  for (const platform of platforms) {
    if (hydratedChannels.some((channel) => channel.platform === platform)) continue;
    hydratedChannels.push({
      platform,
      state: 'drafting',
      usesBaseDraft: true,
      scheduledFor: null,
      postedAt: null,
      postUrl: null,
      analyticsRef: null,
      created: normalizeNullable(metadata.Created) || nowIso(),
      updated: normalizeNullable(metadata.Updated) || nowIso(),
      notes: '',
      copyBody: '',
      path: null,
      synthetic: true,
    });
  }

  hydratedChannels.sort((left, right) => left.platform.localeCompare(right.platform));

  const item = {
    id: normalizeNullable(metadata.ID) || slug,
    slug,
    title,
    type: normalizeNullable(metadata.Type) || 'post',
    state: normalizeState(metadata.State || 'drafting', 'drafting'),
    parentItem: normalizeNullable(metadata['Parent Item']),
    project: normalizeNullable(metadata.Project),
    platforms,
    series: normalizeNullable(metadata.Series),
    campaign: normalizeNullable(metadata.Campaign),
    theme: normalizeNullable(metadata.Theme),
    persona: normalizeNullable(metadata.Persona),
    tags: parseCsvValue(metadata.Tags),
    source: normalizeNullable(metadata.Source),
    created: normalizeNullable(metadata.Created) || nowIso(),
    updated: normalizeNullable(metadata.Updated) || nowIso(),
    legacyPath: normalizeNullable(metadata['Legacy Path']),
    legacyStatus: normalizeNullable(metadata['Legacy Status']),
    legacyReview: normalizeNullable(metadata['Legacy Review']),
    intent: extractHeadingBody(overviewText, 'Intent', { nextHeadings: ['Workflow', 'Origin'] }),
    origin: extractHeadingBody(overviewText, 'Origin', { untilEof: true }),
    path: relativeToOpenclaw(itemDir),
    overviewPath: relativeToOpenclaw(overviewPath),
    draftPath: relativeToOpenclaw(path.join(itemDir, 'draft.md')),
    notesPath: relativeToOpenclaw(path.join(itemDir, 'notes.md')),
    draftBody: readText(path.join(itemDir, 'draft.md')) || '',
    notesBody: readText(path.join(itemDir, 'notes.md')) || '',
    channels: hydratedChannels.map((channel) => ({
      ...channel,
      latestReview: latestReviews[channel.platform] || null,
    })),
    reviews,
    latestReview: latestReviews.base || null,
  };

  return item;
}

function summarizeCounts(items) {
  const counts = {
    totalItems: items.length,
    baseStates: Object.fromEntries(ITEM_STATES.map((state) => [state, 0])),
    reviewDecisions: Object.fromEntries([...REVIEW_DECISIONS, 'none'].map((decision) => [decision, 0])),
    channelStates: Object.fromEntries(ITEM_STATES.map((state) => [state, 0])),
    channelsByPlatform: {},
    postedByPlatform: {},
  };

  for (const item of items) {
    counts.baseStates[item.state] = (counts.baseStates[item.state] || 0) + 1;
    const reviewDecision = item.latestReview?.decision || 'none';
    counts.reviewDecisions[reviewDecision] = (counts.reviewDecisions[reviewDecision] || 0) + 1;

    for (const channel of item.channels) {
      counts.channelStates[channel.state] = (counts.channelStates[channel.state] || 0) + 1;
      counts.channelsByPlatform[channel.platform] = (counts.channelsByPlatform[channel.platform] || 0) + 1;
      if (channel.state === 'posted') {
        counts.postedByPlatform[channel.platform] = (counts.postedByPlatform[channel.platform] || 0) + 1;
      }
    }
  }

  return counts;
}

function queueEntry(kind, item, channel = null) {
  return {
    kind,
    slug: item.slug,
    title: item.title,
    itemState: item.state,
    platform: channel?.platform || null,
    state: channel?.state || item.state,
    summary: channel?.latestReview?.summary || item.latestReview?.summary || null,
    postedAt: channel?.postedAt || null,
    path: channel?.path || item.path,
  };
}

function buildBuckets(items) {
  const buckets = {
    needsReview: [],
    changesRequested: [],
    readyToPost: [],
    approvedBase: [],
    activeDrafts: [],
    recentlyPosted: [],
  };

  for (const item of items) {
    if (item.state === 'review') buckets.needsReview.push(queueEntry('base', item));
    if (item.state === 'changes_requested') buckets.changesRequested.push(queueEntry('base', item));
    if (item.state === 'approved') buckets.approvedBase.push(queueEntry('base', item));
    if (['idea', 'drafting', 'review', 'changes_requested', 'approved'].includes(item.state)) {
      buckets.activeDrafts.push(queueEntry('base', item));
    }

    for (const channel of item.channels) {
      if (channel.state === 'review') buckets.needsReview.push(queueEntry('channel', item, channel));
      if (channel.state === 'changes_requested') buckets.changesRequested.push(queueEntry('channel', item, channel));
      if (channel.state === 'approved') buckets.readyToPost.push(queueEntry('channel', item, channel));
      if (channel.state === 'posted') buckets.recentlyPosted.push(queueEntry('channel', item, channel));
    }
  }

  buckets.activeDrafts.sort((left, right) => left.title.localeCompare(right.title));
  buckets.needsReview.sort((left, right) => left.title.localeCompare(right.title));
  buckets.changesRequested.sort((left, right) => left.title.localeCompare(right.title));
  buckets.readyToPost.sort((left, right) => left.title.localeCompare(right.title));
  buckets.approvedBase.sort((left, right) => left.title.localeCompare(right.title));
  buckets.recentlyPosted.sort((left, right) => compareDesc(left.postedAt, right.postedAt));

  return buckets;
}

function serializeItem(item) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    type: item.type,
    state: item.state,
    latestReviewDecision: item.latestReview?.decision || 'none',
    latestReviewSummary: item.latestReview?.summary || null,
    parentItem: item.parentItem,
    project: item.project,
    platforms: item.platforms,
    series: item.series,
    campaign: item.campaign,
    theme: item.theme,
    persona: item.persona,
    tags: item.tags,
    source: item.source,
    created: item.created,
    updated: item.updated,
    path: item.path,
    overviewPath: item.overviewPath,
    draftPath: item.draftPath,
    notesPath: item.notesPath,
    intent: item.intent,
    draftStats: {
      words: wordCount(item.draftBody),
      excerpt: excerpt(item.draftBody),
    },
    notesStats: {
      words: wordCount(item.notesBody),
      excerpt: excerpt(item.notesBody),
    },
    channels: item.channels.map((channel) => ({
      platform: channel.platform,
      state: channel.state,
      usesBaseDraft: channel.usesBaseDraft,
      scheduledFor: channel.scheduledFor,
      postedAt: channel.postedAt,
      postUrl: channel.postUrl,
      analyticsRef: channel.analyticsRef,
      created: channel.created,
      updated: channel.updated,
      hasCustomCopy: Boolean(trimBlankLines(channel.copyBody)),
      copyStats: {
        words: wordCount(channel.copyBody),
        excerpt: excerpt(channel.copyBody),
      },
      latestReviewDecision: channel.latestReview?.decision || 'none',
      latestReviewSummary: channel.latestReview?.summary || null,
      path: channel.path,
      synthetic: Boolean(channel.synthetic),
    })),
    reviews: item.reviews.map((review) => ({
      timestamp: review.timestamp,
      decision: review.decision,
      target: review.target,
      reviewer: review.reviewer,
      stateAfterReview: review.stateAfterReview,
      summary: review.summary,
      appliesTo: review.appliesTo,
      path: review.path,
    })),
  };
}

function buildIndex(items) {
  const sortedItems = [...items].sort((left, right) => {
    const updatedSort = compareDesc(left.updated, right.updated);
    if (updatedSort !== 0) return updatedSort;
    return left.title.localeCompare(right.title);
  });

  const counts = summarizeCounts(sortedItems);
  const buckets = buildBuckets(sortedItems);

  return {
    generatedAt: nowIso(),
    openclawHome: OPENCLAW_HOME,
    contentRoot: relativeToOpenclaw(CONTENT_ROOT),
    itemsRoot: relativeToOpenclaw(ITEMS_ROOT),
    hubPath: relativeToOpenclaw(HUB_PATH),
    ideasPath: fs.existsSync(IDEAS_PATH) ? relativeToOpenclaw(IDEAS_PATH) : null,
    indexPath: relativeToOpenclaw(INDEX_PATH),
    counts,
    buckets,
    items: sortedItems.map(serializeItem),
  };
}

function renderBucket(label, entries, formatter, limit = null) {
  const lines = [`## ${label}`, ''];
  if (!entries.length) {
    lines.push('_None._', '');
    return lines.join('\n');
  }

  const sliced = limit == null ? entries : entries.slice(0, limit);
  for (const entry of sliced) {
    lines.push(formatter(entry));
  }
  if (limit != null && entries.length > limit) {
    lines.push(`- +${entries.length - limit} more in \`workspace/state/content-hub/index.json\``);
  }
  lines.push('');
  return lines.join('\n');
}

function formatBucketEntry(entry) {
  if (entry.kind === 'channel') {
    const summary = entry.summary ? ` | latest: ${entry.summary}` : '';
    return `- Channel | ${entry.state} | ${platformLabel(entry.platform)} | \`${entry.slug}\` | ${entry.title}${summary}`;
  }
  const summary = entry.summary ? ` | latest: ${entry.summary}` : '';
  return `- Base | ${entry.state} | \`${entry.slug}\` | ${entry.title}${summary}`;
}

function renderHub(index) {
  const baseStates = ITEM_STATES.map((state) => `${state}=${index.counts.baseStates[state] || 0}`).join(', ');
  const channelStates = ITEM_STATES.map((state) => `${state}=${index.counts.channelStates[state] || 0}`).join(', ');
  const postedByPlatform = Object.keys(index.counts.postedByPlatform).length
    ? Object.entries(index.counts.postedByPlatform)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([platform, count]) => `${platform}=${count}`)
        .join(', ')
    : 'none';

  return `# Content Hub

Updated: ${index.generatedAt}

## Snapshot

- Source of truth: \`knowledge/content/items/\`
- Generated hub: \`knowledge/content/HUB.md\`
- Generated index: \`workspace/state/content-hub/index.json\`
- Ideas board: ${index.ideasPath ? `\`${index.ideasPath}\`` : 'none'}
- Items: ${index.counts.totalItems}
- Base states: ${baseStates}
- Channel states: ${channelStates}
- Posted by platform: ${postedByPlatform}

${renderBucket('Needs Review', index.buckets.needsReview, formatBucketEntry)}
${renderBucket('Changes Requested', index.buckets.changesRequested, formatBucketEntry)}
${renderBucket('Ready To Post', index.buckets.readyToPost, formatBucketEntry)}
${renderBucket('Approved Base Drafts', index.buckets.approvedBase, formatBucketEntry)}
${renderBucket('Active Drafts', index.buckets.activeDrafts, formatBucketEntry, 16)}
${renderBucket('Recently Posted', index.buckets.recentlyPosted, formatBucketEntry, 16)}`.trimEnd();
}

function scanHub(options = {}) {
  ensureScaffold();
  seedIdeasBoard();

  const items = listDirectories(ITEMS_ROOT)
    .map((dirName) => loadItem(dirName))
    .filter(Boolean);
  const index = buildIndex(items);

  if (options.writeOutputs) {
    writeText(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
    writeText(HUB_PATH, `${renderHub(index)}\n`);
  }

  return index;
}

function getItemDir(slug) {
  return path.join(ITEMS_ROOT, slug);
}

function writeItemFiles(item, channelsToWrite = null) {
  const itemDir = getItemDir(item.slug);
  ensureDir(itemDir);
  ensureDir(path.join(itemDir, 'channels'));
  ensureDir(path.join(itemDir, 'reviews'));

  writeText(path.join(itemDir, 'overview.md'), `${renderOverview(item)}\n`);
  if (!fs.existsSync(path.join(itemDir, 'draft.md'))) {
    writeText(path.join(itemDir, 'draft.md'), `${defaultDraftContent(item.title)}\n`);
  }
  if (!fs.existsSync(path.join(itemDir, 'notes.md'))) {
    writeText(path.join(itemDir, 'notes.md'), `${defaultNotesContent(item.title)}\n`);
  }

  const channels = channelsToWrite || item.channels || [];
  for (const channel of channels) {
    if (!channel.platform) continue;
    writeText(path.join(itemDir, 'channels', `${channel.platform}.md`), `${renderChannel(channel)}\n`);
  }
}

function getItemOrThrow(slug) {
  const item = loadItem(slug);
  if (!item) {
    throw new Error(`Content item "${slug}" was not found under ${relativeToOpenclaw(ITEMS_ROOT)}.`);
  }
  return item;
}

function ensureChannel(item, platform) {
  const canonical = canonicalPlatform(platform);
  if (!canonical || canonical === 'base') {
    throw new Error('A non-base platform is required.');
  }

  const existing = item.channels.find((channel) => channel.platform === canonical);
  if (existing) return existing;

  const createdAt = nowIso();
  const channel = {
    platform: canonical,
    state: 'drafting',
    usesBaseDraft: true,
    scheduledFor: null,
    postedAt: null,
    postUrl: null,
    analyticsRef: null,
    created: createdAt,
    updated: createdAt,
    notes: 'Start from `../draft.md` and only add custom copy below when the platform genuinely needs a rewrite.',
    copyBody: '',
    path: relativeToOpenclaw(path.join(getItemDir(item.slug), 'channels', `${canonical}.md`)),
    synthetic: false,
  };

  item.channels.push(channel);
  item.platforms = uniqueList([...item.platforms, canonical]);
  return channel;
}

function createContentItem(args) {
  ensureScaffold();
  seedIdeasBoard();

  const title = normalizeText(firstValue(args.title));
  if (!title) {
    throw new Error('Missing required --title for create.');
  }

  const slug = slugify(firstValue(args.slug) || title);
  if (!slug) {
    throw new Error('Could not derive a slug from the title. Pass --slug explicitly.');
  }
  if (fs.existsSync(getItemDir(slug))) {
    throw new Error(`Content item "${slug}" already exists.`);
  }

  const createdAt = nowIso();
  const platforms = uniqueList(readMultiValue(args, 'platform').map((platform) => canonicalPlatform(platform)));
  const item = {
    id: slug,
    slug,
    title,
    type: normalizeNullable(firstValue(args.type)) || 'post',
    state: normalizeState(firstValue(args.state) || 'idea'),
    parentItem: normalizeNullable(firstValue(args.parent)),
    project: normalizeNullable(firstValue(args.project)),
    platforms,
    series: normalizeNullable(firstValue(args.series)),
    campaign: normalizeNullable(firstValue(args.campaign)),
    theme: normalizeNullable(firstValue(args.theme)),
    persona: normalizeNullable(firstValue(args.persona)),
    tags: uniqueList(readMultiValue(args, 'tag').map((tag) => normalizeNullable(tag)).filter(Boolean)),
    source: normalizeNullable(firstValue(args.source)),
    created: createdAt,
    updated: createdAt,
    legacyPath: null,
    legacyStatus: null,
    legacyReview: null,
    intent: normalizeNullable(firstValue(args.intent)) || '',
    origin: `Created with \`workspace/scripts/content-hub.js\` on ${todayDate()}.`,
    channels: [],
  };

  for (const platform of platforms) {
    item.channels.push({
      platform,
      state: 'drafting',
      usesBaseDraft: true,
      scheduledFor: null,
      postedAt: null,
      postUrl: null,
      analyticsRef: null,
      created: createdAt,
      updated: createdAt,
      notes: 'Start from `../draft.md` and only add custom copy below when the platform genuinely needs a rewrite.',
      copyBody: '',
      path: relativeToOpenclaw(path.join(getItemDir(slug), 'channels', `${platform}.md`)),
      synthetic: false,
    });
  }

  writeItemFiles(item);
  writeText(path.join(getItemDir(slug), 'draft.md'), `${defaultDraftContent(title)}\n`);
  writeText(path.join(getItemDir(slug), 'notes.md'), `${defaultNotesContent(title)}\n`);

  const index = scanHub({ writeOutputs: true });
  return {
    item: index.items.find((entry) => entry.slug === slug),
    hubPath: relativeToOpenclaw(HUB_PATH),
    indexPath: relativeToOpenclaw(INDEX_PATH),
  };
}

function appendReview(item, target, decision, options = {}) {
  const timestamp = nowIso();
  const safeTarget = target === 'base' ? 'base' : canonicalPlatform(target);
  const review = {
    timestamp,
    decision,
    target: safeTarget,
    reviewer: normalizeNullable(options.reviewer) || 'agent',
    stateAfterReview: stateFromDecision(decision),
    summary: normalizeNullable(options.summary),
    appliesTo: normalizeNullable(options.appliesTo) || 'current',
    notes: normalizeNullable(options.notes) || '',
  };

  const fileName = `${timestamp.replace(/[:.]/g, '-')}-${safeTarget}-${decision}.md`;
  writeText(path.join(getItemDir(item.slug), 'reviews', fileName), `${renderReview(review)}\n`);
  return review;
}

function resolveReviewTarget(args) {
  const platform = canonicalPlatform(firstValue(args.platform));
  if (platform && platform !== 'base') return platform;
  const target = canonicalPlatform(firstValue(args.target)) || normalizeNullable(firstValue(args.target));
  if (!target) return 'base';
  return target;
}

function applyReview(args, explicitDecision = null) {
  const slug = normalizeText(firstValue(args.slug));
  if (!slug) throw new Error('Missing required --slug.');

  const decision = explicitDecision || normalizeDecision(firstValue(args.decision));
  const target = resolveReviewTarget(args);
  const item = getItemOrThrow(slug);
  const updatedAt = nowIso();

  if (target === 'base') {
    item.state = stateFromDecision(decision);
  } else {
    const channel = ensureChannel(item, target);
    channel.state = stateFromDecision(decision);
    channel.updated = updatedAt;
  }

  item.updated = updatedAt;
  writeItemFiles(item, item.channels.map((channel) => ({ ...channel, synthetic: false })));
  appendReview(item, target, decision, {
    reviewer: firstValue(args.reviewer),
    summary: firstValue(args.summary),
    notes: firstValue(args.notes),
    appliesTo: firstValue(args['applies-to']),
  });

  const index = scanHub({ writeOutputs: true });
  const refreshed = index.items.find((entry) => entry.slug === slug);
  return {
    item: refreshed,
    decision,
    target,
  };
}

function markPosted(args) {
  const slug = normalizeText(firstValue(args.slug));
  const platform = canonicalPlatform(firstValue(args.platform));
  if (!slug) throw new Error('Missing required --slug.');
  if (!platform || platform === 'base') throw new Error('Missing required non-base --platform.');

  const item = getItemOrThrow(slug);
  const channel = ensureChannel(item, platform);
  const updatedAt = nowIso();
  channel.state = 'posted';
  channel.postedAt = normalizeNullable(firstValue(args['posted-at'])) || updatedAt;
  channel.postUrl = normalizeNullable(firstValue(args.url));
  channel.analyticsRef = normalizeNullable(firstValue(args['analytics-ref']));
  channel.updated = updatedAt;
  item.updated = updatedAt;

  writeItemFiles(item, item.channels.map((entry) => ({ ...entry, synthetic: false })));
  const index = scanHub({ writeOutputs: true });
  return {
    item: index.items.find((entry) => entry.slug === slug),
    platform,
  };
}

function migrateLegacy() {
  ensureScaffold();

  const fileSummary = {
    created: [],
    unchanged: [],
    skipped: [],
  };
  const items = [];
  seedIdeasBoard(fileSummary);

  for (const dirName of listDirectories(LEGACY_DRAFTS_ROOT)) {
    const legacyDir = path.join(LEGACY_DRAFTS_ROOT, dirName);
    const overviewPath = path.join(legacyDir, 'overview.md');
    if (!fs.existsSync(overviewPath)) continue;

    const slug = slugify(dirName) || dirName;
    const destinationDir = getItemDir(slug);
    if (fs.existsSync(destinationDir)) {
      fileSummary.skipped.push(relativeToOpenclaw(destinationDir));
      continue;
    }

    const legacyOverview = readText(overviewPath);
    const legacyDraft = readText(path.join(legacyDir, 'draft.md')) || defaultDraftContent(humanizeSlug(slug));
    const legacyNotes = readText(path.join(legacyDir, 'notes.md')) || defaultNotesContent(humanizeSlug(slug));
    const item = parseLegacyOverview(legacyOverview, slug, legacyDir);

    ensureDir(destinationDir);
    ensureDir(path.join(destinationDir, 'channels'));
    ensureDir(path.join(destinationDir, 'reviews'));

    writeText(path.join(destinationDir, 'overview.md'), `${renderOverview(item)}\n`);
    writeText(path.join(destinationDir, 'draft.md'), `${trimBlankLines(legacyDraft)}\n`);
    writeText(path.join(destinationDir, 'notes.md'), `${trimBlankLines(legacyNotes)}\n`);
    fileSummary.created.push(relativeToOpenclaw(path.join(destinationDir, 'overview.md')));
    fileSummary.created.push(relativeToOpenclaw(path.join(destinationDir, 'draft.md')));
    fileSummary.created.push(relativeToOpenclaw(path.join(destinationDir, 'notes.md')));

    const seededPlatforms = item.platforms.length ? item.platforms : [];
    for (const platform of seededPlatforms) {
      const initialState = item.state === 'posted' ? 'posted' : 'drafting';
      const channel = {
        platform,
        state: initialState,
        usesBaseDraft: true,
        scheduledFor: item.publishDate,
        postedAt: item.state === 'posted' ? item.publishDate || item.updated : null,
        postUrl: null,
        analyticsRef: null,
        created: item.created,
        updated: item.updated,
        notes: `Seeded from the legacy platforms list during migration on ${todayDate()}.`,
        copyBody: '',
      };
      writeText(path.join(destinationDir, 'channels', `${platform}.md`), `${renderChannel(channel)}\n`);
      fileSummary.created.push(relativeToOpenclaw(path.join(destinationDir, 'channels', `${platform}.md`)));
    }

    const migratedReview = mapLegacyDecision(item.legacyReview);
    if (migratedReview) {
      const review = {
        timestamp: item.updated,
        decision: migratedReview,
        target: 'base',
        reviewer: 'migration',
        stateAfterReview: stateFromDecision(migratedReview),
        summary: `Migrated from legacy review field (${item.legacyReview}).`,
        appliesTo: 'legacy',
        notes:
          item.legacySourceSection ||
          `Imported from the pre-item overview during migration on ${todayDate()}.`,
      };
      const fileName = `${item.updated.replace(/[:.]/g, '-')}-base-${migratedReview}.md`;
      writeText(path.join(destinationDir, 'reviews', fileName), `${renderReview(review)}\n`);
      fileSummary.created.push(relativeToOpenclaw(path.join(destinationDir, 'reviews', fileName)));
    }

    items.push({ slug, title: item.title, path: relativeToOpenclaw(destinationDir) });
  }

  const index = scanHub({ writeOutputs: true });
  return {
    migrated: items,
    files: fileSummary,
    summary: {
      migratedCount: items.length,
      itemCount: index.counts.totalItems,
      hubPath: relativeToOpenclaw(HUB_PATH),
      indexPath: relativeToOpenclaw(INDEX_PATH),
    },
  };
}

function listContent(args) {
  const index = scanHub({ writeOutputs: false });
  let items = index.items;

  const state = normalizeNullable(firstValue(args.state));
  const platform = canonicalPlatform(firstValue(args.platform));
  const channelState = normalizeNullable(firstValue(args['channel-state']));
  const review = normalizeNullable(firstValue(args.review));
  const limit = normalizeNullable(firstValue(args.limit)) ? Number.parseInt(firstValue(args.limit), 10) : null;

  if (state) {
    items = items.filter((item) => item.state === normalizeState(state));
  }
  if (platform) {
    items = items.filter((item) => item.platforms.includes(platform));
  }
  if (channelState) {
    items = items.filter((item) =>
      item.channels.some((channel) => channel.state === normalizeState(channelState, 'drafting'))
    );
  }
  if (review) {
    const decision = normalizeDecision(review);
    items = items.filter(
      (item) =>
        item.latestReviewDecision === decision ||
        item.channels.some((channel) => channel.latestReviewDecision === decision)
    );
  }
  if (Number.isInteger(limit) && limit > 0) {
    items = items.slice(0, limit);
  }

  return {
    counts: index.counts,
    items,
  };
}

function printSummary(index) {
  const baseStates = ITEM_STATES.map((state) => `${state}=${index.counts.baseStates[state] || 0}`).join(', ');
  const channelStates = ITEM_STATES.map((state) => `${state}=${index.counts.channelStates[state] || 0}`).join(', ');
  const reviewStates = ['approve', 'reject', 'changes_requested', 'none']
    .map((decision) => `${decision}=${index.counts.reviewDecisions[decision] || 0}`)
    .join(', ');

  console.log(`Content items: ${index.counts.totalItems}`);
  console.log(`Base states: ${baseStates}`);
  console.log(`Latest base reviews: ${reviewStates}`);
  console.log(`Channel states: ${channelStates}`);
  console.log(`Hub: ${relativeToOpenclaw(HUB_PATH)}`);
  console.log(`Index: ${relativeToOpenclaw(INDEX_PATH)}`);
}

function printList(payload) {
  if (!payload.items.length) {
    console.log('No content items matched.');
    return;
  }

  for (const item of payload.items) {
    const channels = item.channels.map((channel) => `${channel.platform}=${channel.state}`).join(', ') || 'none';
    console.log(`${item.state} | ${item.slug} | ${item.title} | channels: ${channels}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'summary';
  const asJson = Boolean(args.json);

  try {
    if (command === 'summary') {
      const index = scanHub({ writeOutputs: false });
      if (asJson) {
        console.log(JSON.stringify(index, null, 2));
      } else {
        printSummary(index);
      }
      return;
    }

    if (command === 'scan') {
      const index = scanHub({ writeOutputs: true });
      if (asJson) {
        console.log(JSON.stringify(index, null, 2));
      } else {
        printSummary(index);
      }
      return;
    }

    if (command === 'list') {
      const payload = listContent(args);
      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        printList(payload);
      }
      return;
    }

    if (command === 'create') {
      const payload = createContentItem(args);
      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Created content item: ${payload.item.title}`);
        console.log(`Path: ${payload.item.path}`);
      }
      return;
    }

    if (command === 'review') {
      const payload = applyReview(args);
      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Reviewed ${payload.target} for ${payload.item.title}: ${payload.decision}`);
      }
      return;
    }

    if (command === 'approve') {
      const payload = applyReview(args, 'approve');
      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Approved ${payload.target} for ${payload.item.title}`);
      }
      return;
    }

    if (command === 'reject') {
      const payload = applyReview(args, 'reject');
      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Rejected ${payload.target} for ${payload.item.title}`);
      }
      return;
    }

    if (command === 'suggest-edits') {
      const payload = applyReview(args, 'changes_requested');
      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Requested changes for ${payload.target} on ${payload.item.title}`);
      }
      return;
    }

    if (command === 'mark-posted') {
      const payload = markPosted(args);
      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Marked ${payload.platform} as posted for ${payload.item.title}`);
      }
      return;
    }

    if (command === 'migrate-legacy') {
      const payload = migrateLegacy();
      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`Migrated ${payload.summary.migratedCount} legacy content items.`);
        console.log(`Hub: ${payload.summary.hubPath}`);
        console.log(`Index: ${payload.summary.indexPath}`);
      }
      return;
    }

    usage();
    process.exitCode = 1;
  } catch (error) {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
