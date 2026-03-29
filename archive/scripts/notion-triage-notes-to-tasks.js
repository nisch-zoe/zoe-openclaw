#!/usr/bin/env node
/**
 * Triage Notion page "Nishchay’s Notes" into Tasks database items.
 * Uses Notion API directly.
 */

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const NOTES_PAGE_ID = '30ee3c01-be8e-81cb-bbb9-e7a1b75ad86a';
const TASKS_DATA_SOURCE_ID = 'f4b9ea3d-c2ee-4cfe-bdc6-f8789e9c6d90';
const TASKS_DATABASE_ID = '8c15f0cf-532b-485d-b5a7-07f312dd4dc7';

const NOTION_VERSION = '2025-09-03';

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

function notionRequest(method, path, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : null;
  const opts = {
    hostname: 'api.notion.com',
    path: `/v1${path}`,
    method,
    headers: {
      'Authorization': `Bearer ${notionKey}`,
      'Notion-Version': NOTION_VERSION,
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        let parsed;
        try { parsed = data ? JSON.parse(data) : {}; } catch { parsed = { raw: data }; }
        if (!ok) {
          reject(new Error(`${method} ${path} -> ${res.statusCode}: ${JSON.stringify(parsed).slice(0, 2000)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function listAllBlockChildren(blockId) {
  let cursor = undefined;
  const out = [];
  while (true) {
    const qs = new URLSearchParams({ page_size: '100', ...(cursor ? { start_cursor: cursor } : {}) }).toString();
    const resp = await notionRequest('GET', `/blocks/${blockId}/children?${qs}`);
    out.push(...(resp.results || []));
    if (!resp.has_more) break;
    cursor = resp.next_cursor;
  }
  return out;
}

function richTextToPlain(rich_text) {
  return (rich_text || []).map(rt => rt.plain_text || '').join('');
}

function blockText(block) {
  const t = block.type;
  const obj = block[t];
  if (!obj) return '';
  if (t === 'bulleted_list_item' || t === 'numbered_list_item' || t === 'paragraph' || t.startsWith('heading_') || t === 'to_do') {
    return richTextToPlain(obj.rich_text);
  }
  return '';
}

function inferAreaFromLine(line) {
  const normalized = line.trim().toLowerCase();
  if (['product', 'prod'].includes(normalized)) return 'Product';
  if (['marketing', 'mkt'].includes(normalized)) return 'Marketing';
  if (['ops', 'operations'].includes(normalized)) return 'Ops';
  return null;
}

function isActionable(text) {
  const t = text.trim();
  if (!t) return false;
  // Obvious non-tasks
  if (/^(notes|thoughts|ideas|misc|random)$/i.test(t)) return false;
  // If it's a question without a clear action, treat as unclear
  if (t.endsWith('?') && !/(investigate|figure out|decide|confirm|check|review)/i.test(t)) return false;

  // Heuristic: starts with an imperative verb or contains strong action keywords.
  const verbStart = /^(fix|add|ship|launch|implement|create|write|draft|design|review|refactor|investigate|check|confirm|measure|track|update|remove|rename|migrate|test|deploy|publish|record|set up|setup|automate|schedule|reply|follow up|call|email|buy|pay|renew|cancel)\b/i;
  const contains = /(bug|crash|broken|error|doesn't|does not|fails|slow|performance|regression|todo|to-do|task|need to|should|must)\b/i;
  if (verbStart.test(t) || contains.test(t)) return true;

  // Otherwise: short fragments are unclear; longer statements can be ideas/tasks.
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 6) return true;
  return false;
}

function priorityFor(text) {
  const t = text.toLowerCase();
  if (/(blocker|blocking|urgent|asap|can't|cannot|broken|crash|payment|paywall|login)/.test(t)) return 'P0';
  if (/(nice to have|polish|later|someday|optional)/.test(t)) return 'P2';
  return 'P1';
}

async function getNischayUserId() {
  // Best-effort: list users and match name.
  try {
    const users = await notionRequest('GET', `/users?page_size=100`);
    const match = (users.results || []).find(u => (u.name || '').toLowerCase().includes('nish'));
    return match?.id || null;
  } catch {
    return null;
  }
}

function makeAnalysisBullets({ area, text }) {
  const bullets = [];
  bullets.push('Define success criteria / acceptance criteria (what “done” means).');
  bullets.push('List the smallest next action and estimate effort (S/M/L).');
  if (area === 'Product') {
    bullets.push('Confirm expected UX flows and edge cases.');
    bullets.push('Add/adjust analytics events if user behavior needs measuring.');
  } else if (area === 'Marketing') {
    bullets.push('Identify target audience + single key message.');
    bullets.push('Pick channel (X/LinkedIn/email/app store) and draft 1–2 variants.');
  } else if (area === 'Ops') {
    bullets.push('Confirm scope + risk; if any destructive action is needed, get explicit approval first.');
    bullets.push('Write a short checklist + rollback plan before executing.');
  } else {
    bullets.push('Clarify owner + deadline if time-sensitive.');
  }
  // Avoid too many
  return bullets.slice(0, 7);
}

function notionUrlForPage(pageId) {
  // Notion URLs accept dashed id.
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}

async function createTaskPage({ name, area, priority, executor, assigneeUserId, source, externalId, originalNotesBlocks }) {
  const nowIso = new Date().toISOString();
  const props = {
    'Name': { title: [{ text: { content: name.slice(0, 2000) } }] },
    'Status': { select: { name: 'Todo' } },
    'Priority': { select: { name: priority } },
    'Source': { rich_text: [{ text: { content: source } }] },
    'External ID': { rich_text: [{ text: { content: externalId } }] },
    'Last Synced': { date: { start: nowIso } },
    'Executor': { select: { name: executor } },
  };
  if (area) props['Area'] = { select: { name: area } };
  if (assigneeUserId) props['Assignee'] = { people: [{ id: assigneeUserId }] };

  const page = await notionRequest('POST', `/pages`, {
    parent: { database_id: TASKS_DATABASE_ID },
    properties: props,
  });

  const analysisBullets = makeAnalysisBullets({ area, text: name });

  const children = [
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Analysis / suggested next steps' } }] } },
    ...analysisBullets.map(b => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: b } }] } })),
  ];

  if (originalNotesBlocks?.length) {
    children.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Original notes' } }] } });
    // Represent as bullets, preserving hierarchy 1 level deep.
    for (const ob of originalNotesBlocks) {
      const text = ob.text;
      if (!text) continue;
      const main = { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } };
      if (ob.children && ob.children.length) {
        main.bulleted_list_item.children = ob.children
          .filter(c => c.text)
          .map(c => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: c.text } }] } }));
      }
      children.push(main);
    }
  }

  // Chunk children to avoid payload limits
  const chunkSize = 50;
  for (let i = 0; i < children.length; i += chunkSize) {
    await notionRequest('PATCH', `/blocks/${page.id}/children`, { children: children.slice(i, i + chunkSize) });
  }

  return page;
}

async function archiveBlock(blockId) {
  await notionRequest('PATCH', `/blocks/${blockId}`, { archived: true });
}

async function addClarifyNote(parentBlockId, message) {
  await notionRequest('PATCH', `/blocks/${parentBlockId}/children`, {
    children: [
      { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: message } }] } },
    ],
  });
}

async function getListItemWithChildren(block) {
  const node = { id: block.id, text: blockText(block).trim(), children: [] };
  if (block.has_children) {
    const kids = await listAllBlockChildren(block.id);
    for (const k of kids) {
      if (k.type === 'bulleted_list_item' || k.type === 'numbered_list_item') {
        node.children.push(await getListItemWithChildren(k));
      } else if (k.type === 'paragraph') {
        const t = blockText(k).trim();
        if (t) node.children.push({ id: k.id, text: t, children: [] });
      }
    }
  }
  return node;
}

async function main() {
  const nischayUserId = await getNischayUserId();

  const blocks = await listAllBlockChildren(NOTES_PAGE_ID);

  let currentArea = null;
  const created = [];
  const unpicked = [];

  for (const b of blocks) {
    const t = b.type;
    const text = blockText(b).trim();

    // Update area on headings or standalone paragraphs used as labels.
    if (t.startsWith('heading_') || t === 'paragraph') {
      const area = inferAreaFromLine(text);
      if (area) currentArea = area;
      continue;
    }

    if (t === 'bulleted_list_item' || t === 'numbered_list_item') {
      // Only top-level list items under the page are processed here.
      const actionable = isActionable(text);
      if (!actionable) {
        const msg = `⚠️ Not picked: I’m unclear on what the actionable task is here. Please clarify: what’s the desired outcome / next action?`;
        await addClarifyNote(b.id, msg);
        unpicked.push({ text, reason: 'unclear', blockId: b.id });
        continue;
      }

      const area = currentArea;
      const priority = priorityFor(text);
      const executor = (area === 'Ops') ? 'Zoe' : 'Nishchay';
      const assigneeUserId = (area === 'Ops') ? null : nischayUserId;

      const originalNode = await getListItemWithChildren(b);

      const page = await createTaskPage({
        name: text,
        area,
        priority,
        executor,
        assigneeUserId,
        source: 'Nishchay’s Notes',
        externalId: b.id,
        originalNotesBlocks: [originalNode],
      });

      created.push({ name: text, pageId: page.id, url: notionUrlForPage(page.id), area, priority });

      // Archive source bullet now that it's converted.
      await archiveBlock(b.id);
    }
  }

  // OPS AUTO-HANDLE
  const ops = { found: [], completed: [], inProgress: [], blocked: [] };
  try {
    const query = {
      filter: {
        and: [
          { property: 'Area', select: { equals: 'Ops' } },
          { property: 'Executor', select: { equals: 'Zoe' } },
          { or: [
            { property: 'Status', select: { equals: 'Todo' } },
            { property: 'Status', select: { equals: 'Doing' } },
          ]},
        ]
      },
      sorts: [{ property: 'Last Synced', direction: 'ascending' }],
      page_size: 20,
    };
    const resp = await notionRequest('POST', `/data_sources/${TASKS_DATA_SOURCE_ID}/query`, query);
    ops.found = (resp.results || []).map(p => ({
      id: p.id,
      url: notionUrlForPage(p.id),
      name: richTextToPlain(p.properties?.Name?.title || []),
      status: p.properties?.Status?.select?.name,
    }));

    // Execute only ultra-safe ops: if title contains "triage" or "review" → just add note.
    if (ops.found.length) {
      const candidate = ops.found[0];
      const safe = /(triage|review|check|audit|document)/i.test(candidate.name || '');
      const nowIso = new Date().toISOString();
      if (safe) {
        await notionRequest('PATCH', `/blocks/${candidate.id}/children`, {
          children: [
            { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `Progress note (${nowIso}): Reviewed this ops task. Next step: clarify required actions + confirm any risk before executing.` } }] } },
          ]
        });
        await notionRequest('PATCH', `/pages/${candidate.id}`, {
          properties: {
            'Last Synced': { date: { start: nowIso } },
            'Status': { select: { name: 'Doing' } },
          }
        });
        ops.inProgress.push(candidate);
      } else {
        // Mark blocked awaiting confirmation if potentially destructive.
        await notionRequest('PATCH', `/pages/${candidate.id}`, {
          properties: {
            'Last Synced': { date: { start: nowIso } },
            'Blocked': { checkbox: true },
          }
        });
        await notionRequest('PATCH', `/blocks/${candidate.id}/children`, {
          children: [
            { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `⚠️ Ops auto-handle pause (${nowIso}): This may involve external changes/deletions. Please confirm the exact plan + approval before I execute.` } }] } },
          ]
        });
        ops.blocked.push(candidate);
      }
    }
  } catch (e) {
    ops.error = e.message;
  }

  const summary = {
    created,
    unpicked,
    ops,
  };

  process.stdout.write(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
