#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const db = require('./db');

const IDEAS_STATE_PATH = path.join(db.WORKSPACE, 'state', 'ideas.json');
const IDEAS_ROOT = path.join(db.OPENCLAW_HOME, 'knowledge', 'ideas');

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
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

function normalizeText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeStatus(value) {
  const status = normalizeText(value);
  if (!status) return 'inbox';
  return status === 'noted' ? 'promoted' : status;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function trimAtWordBoundary(text, max = 72) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  const slice = value.slice(0, max);
  const breakAt = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('-'));
  return (breakAt > max * 0.5 ? slice.slice(0, breakAt) : slice).trim();
}

function truncate(text, max = 120) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}...`;
}

function deriveIdeaTitle(text) {
  const firstLine =
    String(text || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || 'Untitled idea';

  const cleaned = firstLine
    .replace(/^[\s\-*]+/, '')
    .replace(/^idea[:\-\s]+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return trimAtWordBoundary(cleaned || 'Untitled idea');
}

function quoteLines(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function defaultIdeasState() {
  return {
    version: 2,
    lastUpdated: db.nowIso(),
    lastSurfacedAt: null,
    ideas: [],
  };
}

function sanitizeIdea(idea) {
  const text = normalizeText(idea.text) || normalizeText(idea.rawText) || '';
  const rawText = normalizeText(idea.rawText);

  const sanitized = {
    id: idea.id,
    sourceMessageId: normalizeText(idea.sourceMessageId),
    capturedAt: normalizeText(idea.capturedAt),
    area: normalizeText(idea.area),
    status: normalizeStatus(idea.status),
    title: normalizeText(idea.title),
    text,
  };

  if (rawText && rawText !== text) {
    sanitized.rawText = rawText;
  }
  if (normalizeText(idea.promotedTo)) {
    sanitized.promotedTo = normalizeText(idea.promotedTo);
  }
  if (normalizeText(idea.promotedAt)) {
    sanitized.promotedAt = normalizeText(idea.promotedAt);
  }

  return sanitized;
}

function ensureIdeasFoundation() {
  ensureDir(path.dirname(IDEAS_STATE_PATH));
  ensureDir(IDEAS_ROOT);
}

function loadIdeasState() {
  ensureIdeasFoundation();
  if (!fs.existsSync(IDEAS_STATE_PATH)) {
    return defaultIdeasState();
  }

  const raw = fs.readFileSync(IDEAS_STATE_PATH, 'utf8');
  const parsed = raw.trim() ? JSON.parse(raw) : defaultIdeasState();
  const state = defaultIdeasState();
  state.version = Number.isInteger(parsed.version) ? parsed.version : 2;
  state.lastUpdated = normalizeText(parsed.lastUpdated) || state.lastUpdated;
  state.lastSurfacedAt = normalizeText(parsed.lastSurfacedAt);
  state.ideas = Array.isArray(parsed.ideas) ? parsed.ideas.map(sanitizeIdea) : [];
  return state;
}

function saveIdeasState(state) {
  ensureIdeasFoundation();
  const payload = {
    version: 2,
    lastUpdated: db.nowIso(),
    lastSurfacedAt: normalizeText(state.lastSurfacedAt),
    ideas: (Array.isArray(state.ideas) ? state.ideas : []).map(sanitizeIdea),
  };
  fs.writeFileSync(IDEAS_STATE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function summarizeIdea(idea) {
  const title = idea.title || deriveIdeaTitle(idea.text || idea.rawText || '');
  return {
    id: idea.id,
    title,
    status: normalizeStatus(idea.status),
    area: idea.area || null,
    capturedAt: idea.capturedAt || null,
    promotedTo: idea.promotedTo || null,
    preview: truncate(idea.text || idea.rawText || '', 120),
  };
}

function listIdeas({ status, limit } = {}) {
  const ideasState = loadIdeasState();
  let ideas = [...(ideasState.ideas || [])];

  if (status) {
    ideas = ideas.filter((idea) => normalizeStatus(idea.status) === normalizeStatus(status));
  }

  ideas.sort((left, right) => String(right.capturedAt || '').localeCompare(String(left.capturedAt || '')));

  if (Number.isInteger(limit) && limit > 0) {
    ideas = ideas.slice(0, limit);
  }

  return ideas.map(summarizeIdea);
}

function listIdeaNoteFiles() {
  ensureIdeasFoundation();
  return fs
    .readdirSync(IDEAS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map((entry) => entry.name);
}

function findExistingIdeaNote(title, originalText) {
  const titleLine = `# Idea: ${title}`;
  const textNeedle = normalizeText(originalText);

  for (const fileName of listIdeaNoteFiles()) {
    const absolutePath = path.join(IDEAS_ROOT, fileName);
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (content.startsWith(`${titleLine}\n`)) {
      return {
        relativePath: path.join('knowledge', 'ideas', fileName),
        absolutePath,
      };
    }
    if (textNeedle && content.includes(textNeedle.slice(0, 120))) {
      return {
        relativePath: path.join('knowledge', 'ideas', fileName),
        absolutePath,
      };
    }
  }

  return null;
}

function resolveIdeaNotePath(idea, title, slugOverride) {
  if (idea.promotedTo) {
    return {
      relativePath: idea.promotedTo,
      absolutePath: path.join(db.OPENCLAW_HOME, idea.promotedTo),
    };
  }

  const existing = findExistingIdeaNote(title, idea.rawText || idea.text || '');
  if (existing) {
    return existing;
  }

  const baseSlug =
    slugOverride ||
    slugify(title) ||
    `idea-${String(idea.id || '').replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase()}`;

  let relativePath = path.join('knowledge', 'ideas', `${baseSlug}.md`);
  let absolutePath = path.join(db.OPENCLAW_HOME, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return { relativePath, absolutePath };
  }

  const suffix =
    String(idea.id || idea.sourceMessageId || '')
      .replace(/[^a-z0-9]/gi, '')
      .slice(-8)
      .toLowerCase() || 'idea';
  relativePath = path.join('knowledge', 'ideas', `${baseSlug}-${suffix}.md`);
  absolutePath = path.join(db.OPENCLAW_HOME, relativePath);
  return { relativePath, absolutePath };
}

function buildIdeaNote(idea, title) {
  const area = idea.area || 'personal';
  const sourceMessageId = idea.sourceMessageId || 'unknown';
  const capturedAt = idea.capturedAt || db.nowIso();
  const originalText = idea.rawText || idea.text || '';

  return `# Idea: ${title}

## Problem or itch

${idea.text || originalText || 'Captured from chat. Needs expansion.'}

## Why it might matter

This was promoted from the local idea inbox into the idea garden so it can stay durable without becoming an immediate task.

## Signals or evidence

- Captured at: ${capturedAt}
- Area hint: ${area}
- Source message id: ${sourceMessageId}
- Original note:

${quoteLines(originalText || idea.text || '')}

## What would make this worth pursuing?

- A clearer user problem or repeated signal
- A believable first version or experiment
- Some reason to act on it now instead of leaving it parked

## Next move

- Keep parked
- Research
- Promote to task

## Source

Promoted from \`workspace/state/ideas.json\`.
`;
}

function promoteIdea({ id, title, slug } = {}) {
  if (!id) {
    throw new Error('Idea id is required. Use: node scripts/ideas.js promote --id <idea-id>');
  }

  const ideasState = loadIdeasState();
  const idea = (ideasState.ideas || []).find((entry) => entry.id === id);
  if (!idea) {
    throw new Error(`Idea not found: ${id}`);
  }

  const finalTitle = title || idea.title || deriveIdeaTitle(idea.text || idea.rawText || '');
  const { relativePath, absolutePath } = resolveIdeaNotePath(idea, finalTitle, slug);
  const noteContent = buildIdeaNote(idea, finalTitle);

  if (!fs.existsSync(absolutePath)) {
    fs.writeFileSync(absolutePath, noteContent, 'utf8');
  }

  idea.title = finalTitle;
  idea.status = 'promoted';
  idea.promotedTo = relativePath;
  idea.promotedAt = db.nowIso();
  saveIdeasState(ideasState);

  return {
    id: idea.id,
    title: finalTitle,
    relativePath,
    status: idea.status,
  };
}

function printUsage() {
  console.log(`OpenClaw ideas helper

Commands:
  list [--status <status>] [--limit <n>] [--json]
  promote --id <idea-id> [--title "Idea title"] [--slug <slug>] [--json]
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'list';
  const asJson = Boolean(args.json);

  try {
    if (command === 'list') {
      const limit = args.limit ? Number.parseInt(args.limit, 10) : null;
      const ideas = listIdeas({
        status: typeof args.status === 'string' ? args.status : null,
        limit: Number.isInteger(limit) ? limit : null,
      });

      if (asJson) {
        console.log(JSON.stringify({ ideas }, null, 2));
        return;
      }

      if (!ideas.length) {
        console.log('No ideas matched.');
        return;
      }

      ideas.forEach((idea) => {
        const destination = idea.promotedTo ? ` -> ${idea.promotedTo}` : '';
        console.log(`[${idea.status}] ${idea.id} | ${idea.title}${destination}`);
      });
      return;
    }

    if (command === 'promote') {
      const result = promoteIdea({
        id: args.id,
        title: typeof args.title === 'string' ? args.title : null,
        slug: typeof args.slug === 'string' ? args.slug : null,
      });

      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Promoted ${result.id} -> ${result.relativePath}`);
      return;
    }

    printUsage();
    process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  IDEAS_ROOT,
  IDEAS_STATE_PATH,
  buildIdeaNote,
  deriveIdeaTitle,
  listIdeas,
  loadIdeasState,
  promoteIdea,
  saveIdeasState,
};

if (require.main === module) {
  main();
}
