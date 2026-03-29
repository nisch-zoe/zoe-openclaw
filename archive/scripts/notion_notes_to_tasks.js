#!/usr/bin/env node
/* Triage Notion notes page bullets into Tasks database items.
   Usage: node scripts/notion_notes_to_tasks.js
*/

const fs = require('fs');
const os = require('os');
const path = require('path');

const NOTION_VERSION = '2025-09-03';

const NOTES_PAGE_ID = '30ee3c01-be8e-81cb-bbb9-e7a1b75ad86a';
const TASKS_DATA_SOURCE_ID = 'f4b9ea3d-c2ee-4cfe-bdc6-f8789e9c6d90';
const TASKS_DATABASE_ID = '8c15f0cf-532b-485d-b5a7-07f312dd4dc7';

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function notionKey() {
  const envCandidates = ['NOTION_API_KEY', 'LIFEOS_NOTION_API_KEY', 'OPENCLAW_NOTION_API_KEY'];
  for (const name of envCandidates) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }

  const fileCandidates = [
    process.env.NOTION_API_KEY_FILE,
    path.join(os.homedir(), '.config', 'notion', 'api_key'),
  ].filter(Boolean);

  for (const p of fileCandidates) {
    if (!fs.existsSync(p)) continue;
    const key = fs.readFileSync(p, 'utf8').trim();
    if (key) return key;
  }

  throw new Error(
    'Notion API key not found. Set NOTION_API_KEY (or LIFEOS_NOTION_API_KEY / OPENCLAW_NOTION_API_KEY) or NOTION_API_KEY_FILE.'
  );
}

async function nfetch(url, { method='GET', body } = {}) {
  const key = notionKey();
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = `Notion API error ${res.status} ${res.statusText} for ${method} ${url}: ${text}`;
    throw new Error(msg);
  }
  // light rate limiting cushion
  await sleep(250);
  return json;
}

function richTextToPlain(rich_text = []) {
  return rich_text.map(rt => rt.plain_text || '').join('');
}

function blockText(block) {
  const t = block.type;
  const obj = block[t];
  if (!obj) return '';
  // Most text-bearing blocks have rich_text
  if (obj.rich_text) return richTextToPlain(obj.rich_text).trim();
  if (obj.text) return richTextToPlain(obj.text).trim();
  if (obj.title) return richTextToPlain(obj.title).trim();
  return '';
}

async function listChildren(blockId) {
  let out = [];
  let cursor = undefined;
  while (true) {
    const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`);
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const json = await nfetch(url.toString());
    out = out.concat(json.results || []);
    if (!json.has_more) break;
    cursor = json.next_cursor;
  }
  return out;
}

async function fetchNested(block) {
  const kids = [];
  if (!block.has_children) return kids;
  const children = await listChildren(block.id);
  for (const ch of children) {
    kids.push({ block: ch, children: await fetchNested(ch) });
  }
  return kids;
}

function isSectionLabel(block) {
  const txt = blockText(block);
  if (!txt) return false;
  const norm = txt.trim().toLowerCase();
  if (['product','marketing','ops','operations'].includes(norm)) return true;
  if (block.type && block.type.startsWith('heading_')) return true;
  return false;
}

function inferAreaFromLabel(block) {
  const txt = blockText(block).trim().toLowerCase();
  if (txt === 'product') return 'Product';
  if (txt === 'marketing') return 'Marketing';
  if (txt === 'ops' || txt === 'operations') return 'Ops';
  return null;
}

function inferPriority(text) {
  const t = text.toLowerCase();
  if (/\b(blocker|blocking|urgent|asap|hotfix|crash|can\x27t|cannot|broken)\b/.test(t)) return 'P0';
  if (/\b(nice to have|polish|cleanup|refactor|minor|later)\b/.test(t)) return 'P2';
  return 'P1';
}

function seemsActionable(text) {
  const t = (text || '').trim();
  if (!t) return false;
  // Ignore obvious non-tasks
  if (/^(product|marketing|ops|operations)$/i.test(t)) return false;
  if (t.length < 6) return false;
  // If it ends with ? and is very vague, consider unclear
  if (t.endsWith('?') && t.length < 40) return false;
  // Action verbs / task-y keywords
  if (/\b(add|implement|fix|ship|write|create|design|investigate|debug|review|refactor|update|setup|set up|remove|improve|research|launch|publish|test|track|integrate|automate|deploy)\b/i.test(t)) return true;
  // Default: treat as actionable if it looks like an item (contains at least 2 words)
  if (t.split(/\s+/).length >= 2) return true;
  return false;
}

function mkText(content) {
  return { type: 'text', text: { content } };
}

function analysisBulletsFrom(text, nestedPlain) {
  const bullets = [];
  bullets.push('Clarify desired outcome + definition of done.');
  bullets.push('List acceptance criteria and edge cases.');
  if (/bug|fix|broken|crash/i.test(text)) bullets.push('Reproduce, identify root cause, add regression test.');
  if (/marketing|launch|copy|tweet|post|landing/i.test(text)) bullets.push('Draft copy/asset list, pick channel(s), and set a date.');
  if (/integrat|api|oauth|auth/i.test(text)) bullets.push('Check API limits + required scopes; sketch integration steps.');
  if (nestedPlain && nestedPlain.length) bullets.push('Use the “Original notes” below as the initial checklist.');
  // Deduplicate + cap 7
  const seen = new Set();
  const out = [];
  for (const b of bullets) {
    if (seen.has(b)) continue;
    seen.add(b);
    out.push(b);
    if (out.length >= 7) break;
  }
  // Ensure at least 3
  while (out.length < 3) out.push('Break into smallest next action and estimate effort.');
  return out;
}

function nestedToPlainLines(nodes, indent=0) {
  const lines = [];
  for (const n of nodes) {
    const txt = blockText(n.block);
    if (txt) lines.push('  '.repeat(indent) + '- ' + txt);
    if (n.children && n.children.length) lines.push(...nestedToPlainLines(n.children, indent+1));
  }
  return lines;
}

function buildPageChildren({text, nested}) {
  const nestedLines = nestedToPlainLines(nested);
  const analysis = analysisBulletsFrom(text, nestedLines);

  const children = [];
  children.push({
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [mkText('Analysis / suggested next steps')] }
  });
  children.push(...analysis.map(b => ({
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [mkText(b)] }
  })));

  if (nestedLines.length) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [mkText('Original notes')] }
    });

    // Re-create nested as flat bullets with indentation markers for simplicity
    for (const line of nestedLines) {
      children.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [mkText(line.replace(/^\s*-\s*/, ''))] }
      });
    }
  }

  return children;
}

async function findNishchayUserId() {
  // Best-effort: find user whose name contains Nishchay or Nishchay/Nischay.
  let cursor;
  const matches = [];
  while (true) {
    const url = new URL('https://api.notion.com/v1/users');
    if (cursor) url.searchParams.set('start_cursor', cursor);
    const json = await nfetch(url.toString());
    for (const u of (json.results || [])) {
      const name = (u.name || '').toLowerCase();
      if (name.includes('nish') || name.includes('nisch')) matches.push(u);
    }
    if (!json.has_more) break;
    cursor = json.next_cursor;
  }
  // Prefer exact-ish
  const preferred = matches.find(u => (u.name || '').toLowerCase().includes('nishchay')) || matches[0];
  return preferred ? preferred.id : null;
}

async function createTaskPage({ name, area, priority, executor, assigneeUserId, externalBlockId, nowIso, children }) {
  const properties = {
    'Name': { title: [mkText(name)] },
    'Status': { select: { name: 'Todo' } },
    'Priority': { select: { name: priority } },
    'Source': { rich_text: [mkText('Nishchay\'s Notes')] },
    'External ID': { rich_text: [mkText(externalBlockId)] },
    'Last Synced': { date: { start: nowIso } },
    'Executor': { select: { name: executor } },
  };
  if (area) properties['Area'] = { select: { name: area } };
  if (assigneeUserId && executor !== 'Zoe') properties['Assignee'] = { people: [{ id: assigneeUserId }] };

  const body = {
    parent: { database_id: TASKS_DATABASE_ID },
    properties,
    children
  };

  return await nfetch('https://api.notion.com/v1/pages', { method: 'POST', body });
}

async function appendClarification(blockId, message) {
  const body = {
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [mkText(message)] }
      }
    ]
  };
  await nfetch(`https://api.notion.com/v1/blocks/${blockId}/children`, { method: 'PATCH', body });
}

async function archiveBlock(blockId) {
  await nfetch(`https://api.notion.com/v1/blocks/${blockId}`, { method: 'PATCH', body: { archived: true } });
}

async function queryOpsTasks() {
  const body = {
    filter: {
      and: [
        { property: 'Area', select: { equals: 'Ops' } },
        { property: 'Executor', select: { equals: 'Zoe' } },
        { or: [
          { property: 'Status', select: { equals: 'Todo' } },
          { property: 'Status', select: { equals: 'Doing' } }
        ]}
      ]
    },
    sorts: [
      { property: 'Priority', direction: 'ascending' }
    ]
  };
  return await nfetch(`https://api.notion.com/v1/data_sources/${TASKS_DATA_SOURCE_ID}/query`, { method: 'POST', body });
}

async function addProgressNote(pageId, nowIso, noteText) {
  // Update Last Synced
  await nfetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    body: { properties: { 'Last Synced': { date: { start: nowIso } } } }
  });
  // Append block
  await nfetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    body: {
      children: [
        { object: 'block', type: 'heading_3', heading_3: { rich_text: [mkText('Ops run log')] } },
        { object: 'block', type: 'paragraph', paragraph: { rich_text: [mkText(noteText)] } }
      ]
    }
  });
}

(async () => {
  const now = new Date();
  const nowIso = now.toISOString();

  // Notes page may contain a link_to_page pointing to an older notes page.
  let top = await listChildren(NOTES_PAGE_ID);
  const linkedPages = top
    .filter(b => b.type === 'link_to_page' && b.link_to_page?.type === 'page_id' && b.link_to_page?.page_id)
    .map(b => b.link_to_page.page_id);
  for (const pid of linkedPages) {
    const extra = await listChildren(pid);
    top = top.concat(extra);
  }

  let currentArea = null;
  const bullets = [];
  const unpicked = [];
  const created = [];
  const archivedSourceBlockIds = [];

  const assigneeUserId = await findNishchayUserId();

  for (const block of top) {
    if (isSectionLabel(block)) {
      const area = inferAreaFromLabel(block);
      if (area) currentArea = area;
      continue;
    }

    if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item') {
      const text = blockText(block);
      const nested = await fetchNested(block);

      if (!seemsActionable(text)) {
        unpicked.push({ text, blockId: block.id });
        await appendClarification(block.id, `⚠️ Not picked: I’m unclear on what the task is here. Please clarify the desired outcome / next action.`);
        continue;
      }

      const area = currentArea;
      const priority = inferPriority(text);
      const executor = (area === 'Ops') ? 'Zoe' : 'Nishchay';

      const children = buildPageChildren({ text, nested });

      const page = await createTaskPage({
        name: text,
        area,
        priority,
        executor,
        assigneeUserId,
        externalBlockId: block.id,
        nowIso,
        children
      });

      created.push({ name: text, url: page.url, id: page.id, area, priority, executor });
      archivedSourceBlockIds.push(block.id);
    }
  }

  // Archive successfully converted bullets
  for (const id of archivedSourceBlockIds) {
    await archiveBlock(id);
  }

  // Ops auto-handle
  const ops = await queryOpsTasks();
  const opsItems = (ops.results || []).map(p => ({
    id: p.id,
    url: p.url,
    name: richTextToPlain(p.properties?.Name?.title || [])
  }));

  let opsNote = null;
  if (opsItems.length) {
    // Non-destructive: just log that we saw it and will pick up next run unless obvious.
    const first = opsItems[0];
    opsNote = { picked: first };
    await addProgressNote(first.id, nowIso, `Auto-triage run (${nowIso}): identified as top Ops task for Zoe. No execution performed automatically (needs explicit instruction/details).`);
  }

  const result = {
    nowIso,
    created,
    unpicked,
    opsItems,
    opsNote
  };

  process.stdout.write(JSON.stringify(result, null, 2));
})().catch(err => {
  console.error(err.stack || String(err));
  process.exit(1);
});
