#!/usr/bin/env node

const fs = require('fs');
const https = require('https');
const path = require('path');
const { randomUUID } = require('crypto');

const db = require('./db');

const NOTION_VERSION = '2025-09-03';
const OMNI_CONTENT_DATA_SOURCE_ID = '3467f292-8dcd-4e4f-8486-8c44e80495bc';
const CONTENT_ROOT = path.join(db.OPENCLAW_HOME, 'knowledge', 'content');

const PROJECT_DIRS = {
  Fence: 'fence',
  'Personal Brand': 'personal-brand',
  Other: 'other',
};

function usage() {
  console.log(`OpenClaw content hub

Commands:
  summary [--json]
  list [--json] [--status <value>] [--review <value>] [--project <label>]
  create --title "<title>" [--project <label>] [--status <value>] [--review <value>] [--asset-type <value>] [--platform <name>] [--publish-date YYYY-MM-DD] [--source "<label>"] [--slug <slug>] [--json]
  migrate-notion [--json]
`);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePath(relativePath) {
  return String(relativePath).split(path.sep).join('/');
}

function relativeToOpenclaw(absolutePath) {
  return normalizePath(path.relative(db.OPENCLAW_HOME, absolutePath));
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function writeFileSafely(filePath, content, summary) {
  ensureDir(path.dirname(filePath));
  const relativePath = relativeToOpenclaw(filePath);
  const existing = readText(filePath);

  if (existing == null) {
    fs.writeFileSync(filePath, content, 'utf8');
    summary.created.push(relativePath);
    return 'created';
  }

  if (existing === content) {
    summary.unchanged.push(relativePath);
    return 'unchanged';
  }

  summary.skipped.push(relativePath);
  return 'skipped';
}

function ensureContentHubScaffold() {
  ensureDir(CONTENT_ROOT);
  for (const dir of Object.values(PROJECT_DIRS)) {
    ensureDir(path.join(CONTENT_ROOT, dir));
  }
  ensureDir(path.join(CONTENT_ROOT, 'archive'));
}

function projectLabelToDir(projectLabel) {
  if (PROJECT_DIRS[projectLabel]) return PROJECT_DIRS[projectLabel];
  const fallback = slugify(projectLabel || 'other');
  return fallback || 'other';
}

function projectLabelToProjectId(projectLabel) {
  if (projectLabel === 'Fence') return 'project:fence';
  if (projectLabel === 'OpenClaw') return 'project:openclaw';
  return null;
}

function buildKnowledgePath(projectLabel, slug) {
  return normalizePath(path.join('knowledge', 'content', projectLabelToDir(projectLabel), slug));
}

function deriveUniqueSlug(baseSlug, stableId, existingItem = null) {
  const normalizedBase = baseSlug || String(stableId || 'item').replace(/-/g, '').slice(0, 8);
  const bySlug = db.getContentItem(normalizedBase);
  if (!bySlug || (existingItem && bySlug.id === existingItem.id)) {
    return normalizedBase;
  }

  const suffix = String(stableId || bySlug.id || '').replace(/-/g, '').slice(0, 8);
  const candidate = `${normalizedBase}-${suffix}`.slice(0, 80);
  const byCandidate = db.getContentItem(candidate);
  if (!byCandidate || (existingItem && byCandidate.id === existingItem.id)) {
    return candidate;
  }

  return `${candidate}-${randomUUID().slice(0, 6)}`.slice(0, 80);
}

function formatBulletValue(value, fallback = 'None') {
  return value ? String(value) : fallback;
}

function titleText(property) {
  return (property?.title || []).map((item) => item.plain_text || '').join('');
}

function richText(property) {
  return (property?.rich_text || []).map((item) => item.plain_text || '').join('');
}

function richTextArrayText(items) {
  return (items || []).map((item) => item.plain_text || '').join('');
}

function loadNotionApiKey() {
  if (process.env.NOTION_KEY) return process.env.NOTION_KEY.trim();

  const keyPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'notion', 'api_key');
  if (!keyPath || !fs.existsSync(keyPath)) {
    throw new Error('Missing Notion API key. Set NOTION_KEY or configure ~/.config/notion/api_key.');
  }

  return fs.readFileSync(keyPath, 'utf8').trim();
}

function notionRequestFactory(apiKey) {
  return function notionRequest(method, apiPath, body = null) {
    return new Promise((resolve, reject) => {
      const request = https.request(
        {
          hostname: 'api.notion.com',
          port: 443,
          path: apiPath,
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
          },
        },
        (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => {
            let parsed = null;
            try {
              parsed = data ? JSON.parse(data) : {};
            } catch (error) {
              reject(new Error(`Failed to parse Notion response: ${data}`));
              return;
            }

            if (response.statusCode < 200 || response.statusCode >= 300) {
              reject(
                new Error(
                  parsed?.message || `Notion request failed with status ${response.statusCode || 'unknown'}`
                )
              );
              return;
            }

            resolve(parsed);
          });
        }
      );

      request.on('error', reject);
      if (body) {
        request.write(JSON.stringify(body));
      }
      request.end();
    });
  };
}

async function queryAllDataSource(notionRequest, dataSourceId) {
  const rows = [];
  let cursor = null;

  while (true) {
    const payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    const response = await notionRequest('POST', `/v1/data_sources/${dataSourceId}/query`, payload);
    rows.push(...(response.results || []));
    if (!response.has_more || !response.next_cursor) break;
    cursor = response.next_cursor;
  }

  return rows;
}

async function fetchBlockChildren(notionRequest, blockId) {
  const blocks = [];
  let cursor = null;

  while (true) {
    const suffix = cursor ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}` : '?page_size=100';
    const response = await notionRequest('GET', `/v1/blocks/${blockId}/children${suffix}`);
    blocks.push(...(response.results || []));
    if (!response.has_more || !response.next_cursor) break;
    cursor = response.next_cursor;
  }

  for (const block of blocks) {
    if (block.has_children) {
      block.children = await fetchBlockChildren(notionRequest, block.id);
    }
  }

  return blocks;
}

function paragraphize(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderBlock(block, depth = 0) {
  const data = block?.[block.type] || {};
  const text = richTextArrayText(data.rich_text || []);
  const listIndent = '  '.repeat(depth);
  let rendered = '';

  switch (block.type) {
    case 'paragraph':
      rendered = text;
      break;
    case 'heading_1':
      rendered = text ? `# ${text}` : '';
      break;
    case 'heading_2':
      rendered = text ? `## ${text}` : '';
      break;
    case 'heading_3':
      rendered = text ? `### ${text}` : '';
      break;
    case 'bulleted_list_item':
      rendered = text ? `${listIndent}- ${text}` : '';
      break;
    case 'numbered_list_item':
      rendered = text ? `${listIndent}1. ${text}` : '';
      break;
    case 'to_do':
      rendered = `${listIndent}- [${data.checked ? 'x' : ' '}] ${text}`.trimEnd();
      break;
    case 'quote':
      rendered = text ? `> ${text}` : '';
      break;
    case 'callout':
      rendered = text ? `> ${text}` : '';
      break;
    case 'divider':
      rendered = '---';
      break;
    case 'code':
      rendered = `\`\`\`${data.language || ''}\n${text}\n\`\`\``;
      break;
    case 'bookmark':
      rendered = data.url || '';
      break;
    case 'link_preview':
      rendered = data.url || '';
      break;
    case 'embed':
      rendered = data.url || '';
      break;
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
    case 'pdf': {
      const fileUrl = data.file?.url || data.external?.url || '';
      rendered = fileUrl || '';
      break;
    }
    case 'toggle':
      rendered = text ? `### ${text}` : '';
      break;
    default:
      rendered = text || '';
      break;
  }

  if (!block.has_children || !Array.isArray(block.children) || !block.children.length) {
    return rendered;
  }

  const childDepth =
    block.type === 'bulleted_list_item' || block.type === 'numbered_list_item' || block.type === 'to_do'
      ? depth + 1
      : depth;
  const childText = renderBlocks(block.children, childDepth);
  if (!childText) return rendered;
  if (!rendered) return childText;
  return `${rendered}\n${childText}`;
}

function renderBlocks(blocks, depth = 0) {
  const parts = [];
  for (const block of blocks || []) {
    const rendered = renderBlock(block, depth);
    if (rendered) parts.push(rendered);
  }
  return paragraphize(parts.join('\n\n'));
}

function normalizeOmniContentRow(page) {
  const properties = page.properties || {};
  return {
    id: page.id,
    url: page.url,
    title: titleText(properties.Name),
    status: properties.Status?.select?.name || 'Idea',
    reviewStatus: properties.Review?.select?.name || 'None',
    assetType: properties['Asset Type']?.select?.name || 'Note',
    projectLabel: properties.Project?.select?.name || 'Other',
    platforms: Array.isArray(properties.Platforms?.multi_select)
      ? properties.Platforms.multi_select.map((entry) => entry.name).filter(Boolean)
      : [],
    publishDate: properties['Publish Date']?.date?.start || null,
    sourceRef: richText(properties.Source) || null,
    draftField: richText(properties.Draft) || null,
    feedback: richText(properties.Feedback) || null,
    createdAt: page.created_time || nowIso(),
    updatedAt: page.last_edited_time || nowIso(),
  };
}

function buildDraftContent(item, draftBody) {
  const body = paragraphize(draftBody || item.draftField || '');
  return `# Draft: ${item.title}

${body || '_No draft body was present in Notion at migration time._'}
`;
}

function buildNotesContent(item, draftBody) {
  const sections = [
    `# Notes: ${item.title}`,
    '',
    '## Migration Context',
    '',
    `- Migrated from Notion \`Omni Content Pipeline\` on ${new Date().toISOString().slice(0, 10)}`,
    `- Legacy status: ${formatBulletValue(item.status)}`,
    `- Legacy review: ${formatBulletValue(item.reviewStatus)}`,
    `- Legacy asset type: ${formatBulletValue(item.assetType)}`,
    `- Legacy project: ${formatBulletValue(item.projectLabel)}`,
    `- Legacy platforms: ${item.platforms.length ? item.platforms.join(', ') : 'None'}`,
    `- Legacy source: ${formatBulletValue(item.sourceRef)}`,
    `- Legacy page: ${item.url}`,
    '',
    '## Feedback',
    '',
    item.feedback || '_No feedback was captured in the legacy database._',
    '',
  ];

  const normalizedDraftField = paragraphize(item.draftField || '');
  const normalizedDraftBody = paragraphize(draftBody || '');
  if (normalizedDraftField && normalizedDraftField !== normalizedDraftBody) {
    sections.push('## Legacy Draft Field', '', normalizedDraftField, '');
  }

  sections.push(
    '## Working Notes',
    '',
    '- Add research links, rationale, posting constraints, and review comments here.',
    '- Keep `draft.md` for the current working copy and `published.md` for shipped copy only.',
    ''
  );

  return sections.join('\n');
}

function buildOverviewContent(item, knowledgePath) {
  return `# Content Item: ${item.title}

## Tracking

- Status: ${item.status}
- Review: ${item.reviewStatus}
- Asset type: ${item.assetType}
- Project: ${formatBulletValue(item.projectLabel)}
- Platforms: ${item.platforms.length ? item.platforms.join(', ') : 'None'}
- Publish date: ${item.publishDate || 'Unscheduled'}
- Source: ${formatBulletValue(item.sourceRef)}
- Knowledge path: \`${knowledgePath}\`

## Working Files

- \`draft.md\` for the current working copy
- \`notes.md\` for research, feedback, and migration context
- \`published.md\` for final shipped copy when this item goes live

## Intent

Summarize the angle, audience, and desired outcome here.

## Source

- Migrated from Notion \`Omni Content Pipeline\`
- Legacy page: ${item.url}
`;
}

function buildPublishedContent(item, draftBody) {
  const body = paragraphize(draftBody || item.draftField || '');
  return `# Published Copy: ${item.title}

${body || '_No published body was available during migration._'}
`;
}

function summarizeItems(items) {
  const summary = {
    total: items.length,
    byStatus: {},
    byReview: {},
    byProject: {},
  };

  for (const item of items) {
    summary.byStatus[item.status] = (summary.byStatus[item.status] || 0) + 1;
    summary.byReview[item.reviewStatus] = (summary.byReview[item.reviewStatus] || 0) + 1;
    summary.byProject[item.projectLabel || 'Unassigned'] =
      (summary.byProject[item.projectLabel || 'Unassigned'] || 0) + 1;
  }

  return summary;
}

function readArgValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] || null;
}

function readMultiArgValues(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

async function migrateFromNotion() {
  ensureContentHubScaffold();
  const apiKey = loadNotionApiKey();
  const notionRequest = notionRequestFactory(apiKey);
  const notionRows = await queryAllDataSource(notionRequest, OMNI_CONTENT_DATA_SOURCE_ID);
  const contentRows = notionRows.map(normalizeOmniContentRow).filter((item) => item.title);

  const fileSummary = {
    created: [],
    unchanged: [],
    skipped: [],
  };
  const migratedItems = [];

  for (const item of contentRows) {
    const baseSlug = slugify(item.title) || item.id.replace(/-/g, '').slice(0, 8);
    const existing = db.getContentItem(item.id);
    const slug = existing?.slug || deriveUniqueSlug(baseSlug, item.id, existing);
    const knowledgePath = buildKnowledgePath(item.projectLabel, slug);
    const absoluteFolder = path.join(db.OPENCLAW_HOME, knowledgePath);
    const overviewPath = path.join(absoluteFolder, 'overview.md');
    const draftPath = path.join(absoluteFolder, 'draft.md');
    const notesPath = path.join(absoluteFolder, 'notes.md');
    const publishedPath = path.join(absoluteFolder, 'published.md');

    ensureDir(absoluteFolder);
    const blocks = await fetchBlockChildren(notionRequest, item.id);
    const draftBody = renderBlocks(blocks);

    writeFileSafely(overviewPath, buildOverviewContent(item, knowledgePath), fileSummary);
    writeFileSafely(draftPath, buildDraftContent(item, draftBody), fileSummary);
    writeFileSafely(notesPath, buildNotesContent(item, draftBody), fileSummary);

    if (item.status === 'Published') {
      writeFileSafely(publishedPath, buildPublishedContent(item, draftBody), fileSummary);
    }

    const payload = db.upsertContentItem({
      id: item.id,
      slug,
      title: item.title,
      status: item.status,
      reviewStatus: item.reviewStatus,
      assetType: item.assetType,
      projectId: projectLabelToProjectId(item.projectLabel),
      projectLabel: item.projectLabel,
      publishDate: item.publishDate,
      sourceRef: item.sourceRef,
      knowledgePath,
      platforms: item.platforms,
      metadata: {
        notionPageId: item.id,
        notionUrl: item.url,
        legacyFeedback: item.feedback || null,
        legacyDraftField: item.draftField || null,
        migratedFrom: 'notion-omni-content-pipeline',
        migratedAt: nowIso(),
        legacyCreatedAt: item.createdAt,
        legacyUpdatedAt: item.updatedAt,
      },
      createdAt: existing?.createdAt || item.createdAt,
      updatedAt: nowIso(),
    });

    migratedItems.push(payload);
  }

  db.closeDb();

  return {
    items: summarizeItems(migratedItems),
    files: fileSummary,
    migrated: migratedItems.map((item) => ({
      id: item.id,
      slug: item.slug,
      title: item.title,
      status: item.status,
      projectLabel: item.projectLabel,
      knowledgePath: item.knowledgePath,
    })),
  };
}

function listItems(args) {
  const filters = {};
  const status = readArgValue(args, '--status');
  const review = readArgValue(args, '--review');
  const project = readArgValue(args, '--project');

  if (status) filters.status = status;
  if (review) filters.reviewStatus = review;
  if (project) filters.projectLabel = project;

  const items = db.listContentItems(filters);
  db.closeDb();
  return items;
}

function summarizeLocalContent() {
  const items = db.listContentItems();
  db.closeDb();
  return summarizeItems(items);
}

function createContentItem(args) {
  ensureContentHubScaffold();

  const title = readArgValue(args, '--title');
  if (!title) {
    throw new Error('Missing required --title for create.');
  }

  const projectLabel = readArgValue(args, '--project') || 'Other';
  const slug = deriveUniqueSlug(readArgValue(args, '--slug') || slugify(title), randomUUID());
  const status = readArgValue(args, '--status') || 'Idea';
  const reviewStatus = readArgValue(args, '--review') || 'None';
  const assetType = readArgValue(args, '--asset-type') || 'Note';
  const publishDate = readArgValue(args, '--publish-date') || null;
  const sourceRef = readArgValue(args, '--source') || null;
  const platforms = readMultiArgValues(args, '--platform');

  if (!slug) {
    throw new Error('Could not derive a slug from the title. Pass --slug explicitly.');
  }

  const knowledgePath = buildKnowledgePath(projectLabel, slug);
  const absoluteFolder = path.join(db.OPENCLAW_HOME, knowledgePath);
  ensureDir(absoluteFolder);

  const item = db.upsertContentItem({
    id: randomUUID(),
    slug,
    title,
    status,
    reviewStatus,
    assetType,
    projectId: projectLabelToProjectId(projectLabel),
    projectLabel,
    publishDate,
    sourceRef,
    knowledgePath,
    platforms,
    metadata: {
      createdBy: 'workspace/scripts/content-hub.js create',
      createdAt: nowIso(),
    },
  });

  const fileSummary = {
    created: [],
    unchanged: [],
    skipped: [],
  };

  writeFileSafely(
    path.join(absoluteFolder, 'overview.md'),
    buildOverviewContent(item, knowledgePath),
    fileSummary
  );
  writeFileSafely(path.join(absoluteFolder, 'draft.md'), buildDraftContent(item, ''), fileSummary);
  writeFileSafely(path.join(absoluteFolder, 'notes.md'), buildNotesContent(item, ''), fileSummary);
  db.closeDb();

  return {
    item,
    files: fileSummary,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'summary';
  const asJson = args.includes('--json');

  if (command === 'summary') {
    const summary = summarizeLocalContent();
    if (asJson) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`Content items: ${summary.total}`);
      console.log(`By status: ${JSON.stringify(summary.byStatus)}`);
      console.log(`By review: ${JSON.stringify(summary.byReview)}`);
      console.log(`By project: ${JSON.stringify(summary.byProject)}`);
    }
    return;
  }

  if (command === 'list') {
    const items = listItems(args);
    if (asJson) {
      console.log(JSON.stringify({ items }, null, 2));
    } else {
      items.forEach((item) => {
        console.log(`${item.status} | ${item.reviewStatus} | ${item.projectLabel || 'Other'} | ${item.title}`);
      });
    }
    return;
  }

  if (command === 'create') {
    const result = createContentItem(args);
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Created content item: ${result.item.title}`);
      console.log(`Path: ${result.item.knowledgePath}`);
    }
    return;
  }

  if (command === 'migrate-notion') {
    const result = await migrateFromNotion();
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Migrated ${result.items.total} content items from Notion.`);
      console.log(`Files created: ${result.files.created.length}`);
      console.log(`Files unchanged: ${result.files.unchanged.length}`);
      console.log(`Files skipped: ${result.files.skipped.length}`);
    }
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  db.closeDb();
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
