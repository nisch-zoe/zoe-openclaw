#!/usr/bin/env node
/*
Triage Notion page “Nishchay’s Notes” → create Tasks database items.

Usage:
  node scripts/notion-triage-notes.js \
    --notesPageId <uuid> \
    --tasksDataSourceId <uuid> \
    --tasksDatabaseId <uuid>

Reads Notion key from ~/.config/notion/api_key
*/

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NOTION_VERSION = '2025-09-03';
const API_BASE = 'https://api.notion.com/v1';

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

const notesPageId = arg('notesPageId');
const tasksDataSourceId = arg('tasksDataSourceId');
const tasksDatabaseId = arg('tasksDatabaseId');
if (!notesPageId || !tasksDataSourceId || !tasksDatabaseId) {
  console.error('Missing required args.');
  process.exit(2);
}

function readNotionKey() {
  const envCandidates = ['NOTION_API_KEY', 'LIFEOS_NOTION_API_KEY', 'OPENCLAW_NOTION_API_KEY'];
  for (const name of envCandidates) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }

  const fileCandidates = [
    process.env.NOTION_API_KEY_FILE,
    path.join(os.homedir(), '.config', 'notion', 'api_key'),
  ].filter(Boolean);

  for (const file of fileCandidates) {
    if (!fs.existsSync(file)) continue;
    const key = fs.readFileSync(file, 'utf8').trim();
    if (key) return key;
  }

  throw new Error(
    'Notion API key not found. Set NOTION_API_KEY (or LIFEOS_NOTION_API_KEY / OPENCLAW_NOTION_API_KEY) or NOTION_API_KEY_FILE.'
  );
}

const notionKey = readNotionKey();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function notion(method, urlPath, body) {
  // gentle rate limiting
  await sleep(350);
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.message || text || `${res.status}`;
    throw new Error(`${method} ${urlPath} failed (${res.status}): ${msg}`);
  }
  return json;
}

function plainTextFromRichText(richText = []) {
  return richText.map((t) => t.plain_text ?? '').join('');
}

function blockText(block) {
  const t = block.type;
  const data = block[t];
  if (!data) return '';
  if (data.rich_text) return plainTextFromRichText(data.rich_text).trim();
  if (data.text) return plainTextFromRichText(data.text).trim();
  return '';
}

async function listAllChildren(blockId) {
  let cursor = undefined;
  const out = [];
  do {
    const qs = new URLSearchParams();
    if (cursor) qs.set('start_cursor', cursor);
    qs.set('page_size', '100');
    const r = await notion('GET', `/blocks/${blockId}/children?${qs.toString()}`);
    out.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function fetchBlockTreeTopLevel(pageId) {
  // only top-level children + for list items, include nested children recursively.
  const top = await listAllChildren(pageId);

  async function enrich(block) {
    const enriched = { block, children: [] };
    if (block.has_children) {
      const kids = await listAllChildren(block.id);
      enriched.children = await Promise.all(kids.map(enrich));
    }
    return enriched;
  }

  return Promise.all(top.map(enrich));
}

function normalizeAreaLabel(text) {
  const t = (text || '').trim().toLowerCase();
  if (t === 'product') return 'Product';
  if (t === 'marketing') return 'Marketing';
  if (t === 'ops' || t === 'operations') return 'Ops';
  return null;
}

function isSectionLabelBlock(block) {
  if (!block) return false;
  const t = block.type;
  if (t === 'heading_1' || t === 'heading_2' || t === 'heading_3') {
    const label = normalizeAreaLabel(blockText(block));
    return !!label;
  }
  if (t === 'paragraph') {
    const label = normalizeAreaLabel(blockText(block));
    return !!label;
  }
  return false;
}

function isListItem(block) {
  return block.type === 'bulleted_list_item' || block.type === 'numbered_list_item' || block.type === 'to_do';
}

function inferPriority(text) {
  const t = text.toLowerCase();
  if (/(blocker|blocking|urgent|asap|immediately|can't|cannot|broken|crash|data loss)/.test(t)) return 'P0';
  if (/(nice to have|someday|polish|cleanup|refactor|optional|later)/.test(t)) return 'P2';
  return 'P1';
}

function isActionableText(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (t.length < 6) return false;

  // obvious non-tasks
  if (/^(idea|thought|note|random|misc)\s*:?$/i.test(t)) return false;

  const low = t.toLowerCase();
  const verbs = [
    'fix', 'add', 'implement', 'ship', 'create', 'draft', 'write', 'update', 'improve', 'refactor', 'rename',
    'research', 'investigate', 'debug', 'test', 'design', 'plan', 'launch', 'publish', 'record', 'send',
    'follow up', 'call', 'buy', 'pay', 'setup', 'set up', 'configure', 'migrate', 'deploy', 'release',
  ];
  if (verbs.some((v) => low.startsWith(v) || low.includes(` ${v} `))) return true;
  if (/(bug|issue|error|crash|broken|fails|failure|optimi[sz]e|perf|latency)/.test(low)) return true;
  if (/(todo|to do|task):/.test(low)) return true;
  // If it's a reasonably detailed statement (contains ':' or '->'), assume it's actionable.
  if (t.includes(':') || t.includes('->')) return true;

  // questions are often unclear unless strongly task-like
  if (t.endsWith('?')) return false;

  return false;
}

function suggestedNextSteps(text, area) {
  // Small, practical default steps.
  const base = [
    'Clarify acceptance criteria: what “done” looks like.',
    'Identify owner + scope; break into smallest shippable chunk.',
    'Estimate effort (S/M/L) and flag dependencies or risks.',
  ];
  if (area === 'Product') base.push('Decide UX: screenshot / quick flow sketch in task comments.');
  if (area === 'Marketing') base.push('Define target segment + channel, then draft copy/creative.');
  if (area === 'Ops') base.push('Confirm access/permissions needed; write a safe step-by-step plan.');

  // Tie to the text a bit.
  base.push(`First concrete action: spend 15 minutes turning “${text.slice(0, 60)}${text.length > 60 ? '…' : ''}” into a checklist.`);
  return base.slice(0, 6);
}

async function findNishchayUserId() {
  try {
    const r = await notion('GET', `/users?page_size=100`);
    const users = r.results || [];
    const u = users.find((x) => (x.name || '').toLowerCase().includes('nish'));
    return u?.id || null;
  } catch {
    return null;
  }
}

async function createTaskPage({ name, area, priority, executor, assigneeUserId, source, externalId, nowIso, analysisBullets, originalNotesBullets }) {
  const props = {
    Name: { title: [{ text: { content: name } }] },
    Status: { select: { name: 'Todo' } },
    Priority: { select: { name: priority } },
    Source: { rich_text: [{ text: { content: source } }] },
    'External ID': { rich_text: [{ text: { content: externalId } }] },
    'Last Synced': { date: { start: nowIso } },
    Executor: { select: { name: executor } },
  };
  if (area) props.Area = { select: { name: area } };
  if (assigneeUserId && executor !== 'Zoe') {
    props.Assignee = { people: [{ id: assigneeUserId }] };
  }

  const children = [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'Analysis / suggested next steps' } }] },
    },
    ...analysisBullets.map((b) => ({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [{ type: 'text', text: { content: b } }] },
    })),
  ];

  if (originalNotesBullets?.length) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'Original notes' } }] },
    });
    children.push(...originalNotesBullets.map((b) => ({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [{ type: 'text', text: { content: b } }] },
    })));
  }

  const body = {
    parent: { database_id: tasksDatabaseId },
    properties: props,
    children,
  };

  return notion('POST', `/pages`, body);
}

async function appendClarification(blockId, text) {
  return notion('PATCH', `/blocks/${blockId}/children`, {
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
      },
    ],
  });
}

async function archiveBlock(blockId) {
  return notion('PATCH', `/blocks/${blockId}`, { archived: true });
}

function collectNestedBullets(node, depth = 0) {
  const res = [];
  for (const ch of node.children || []) {
    if (isListItem(ch.block)) {
      const t = blockText(ch.block);
      if (t) res.push(`${'  '.repeat(depth)}- ${t}`);
      res.push(...collectNestedBullets(ch, depth + 1));
    } else {
      // include non-list child text if present
      const t = blockText(ch.block);
      if (t) res.push(`${'  '.repeat(depth)}${t}`);
      res.push(...collectNestedBullets(ch, depth + 1));
    }
  }
  return res;
}

async function queryOpsTasks(nowIso) {
  const body = {
    filter: {
      and: [
        { property: 'Area', select: { equals: 'Ops' } },
        { property: 'Executor', select: { equals: 'Zoe' } },
        {
          or: [
            { property: 'Status', select: { equals: 'Todo' } },
            { property: 'Status', select: { equals: 'Doing' } },
          ],
        },
      ],
    },
    sorts: [{ property: 'Last Synced', direction: 'ascending' }],
    page_size: 10,
  };
  const r = await notion('POST', `/data_sources/${tasksDataSourceId}/query`, body);
  return r.results || [];
}

async function appendOpsProgress(pageId, nowIso, note) {
  await notion('PATCH', `/blocks/${pageId}/children`, {
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: note } }] },
      },
    ],
  });
  await notion('PATCH', `/pages/${pageId}`, {
    properties: { 'Last Synced': { date: { start: nowIso } } },
  });
}

(async () => {
  const nowIso = new Date().toISOString();
  const assigneeUserId = await findNishchayUserId();

  const tree = await fetchBlockTreeTopLevel(notesPageId);

  let currentArea = null;
  const created = [];
  const unpicked = [];
  const archivedBlockIds = [];

  for (const node of tree) {
    const b = node.block;
    const text = blockText(b);

    if (isSectionLabelBlock(b)) {
      currentArea = normalizeAreaLabel(text);
      continue;
    }

    if (!isListItem(b)) continue;

    const taskName = text;
    const actionable = isActionableText(taskName);

    if (!actionable) {
      const msg = `⚠️ Not picked: I’m unclear on what the concrete action is here. Please clarify: what exactly should be done, and what “done” looks like?`;
      await appendClarification(b.id, msg);
      unpicked.push({ text: taskName, blockId: b.id });
      continue;
    }

    const area = currentArea;
    const priority = inferPriority(taskName);
    const executor = area === 'Ops' ? 'Zoe' : 'Nishchay';

    const analysisBullets = suggestedNextSteps(taskName, area);
    const originalNotesBullets = collectNestedBullets(node);

    const page = await createTaskPage({
      name: taskName,
      area,
      priority,
      executor,
      assigneeUserId,
      source: 'Nishchay’s Notes',
      externalId: b.id,
      nowIso,
      analysisBullets,
      originalNotesBullets,
    });

    created.push({ name: taskName, id: page.id, url: page.url, area, priority, executor });

    // Clear the successfully converted bullet.
    await archiveBlock(b.id);
    archivedBlockIds.push(b.id);
  }

  // Ops auto-handle
  const opsResults = [];
  const opsTasks = await queryOpsTasks(nowIso);
  for (const t of opsTasks) {
    const titleProp = t.properties?.Name?.title || [];
    const title = plainTextFromRichText(titleProp) || '(untitled)';

    // No destructive ops actions automatically — add a safe progress note.
    const note = `Auto-handle (${nowIso}): Reviewed in daily triage. I haven’t executed changes automatically. Next: paste a step-by-step plan here + ask for confirmation if any deletions/infra changes are involved.`;
    await appendOpsProgress(t.id, nowIso, note);
    opsResults.push({ title, url: t.url, status: t.properties?.Status?.select?.name || null });
  }

  const summary = {
    created,
    unpicked,
    opsResults,
  };

  process.stdout.write(JSON.stringify(summary, null, 2));
})();
