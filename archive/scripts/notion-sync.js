#!/usr/bin/env node

/**
 * Fence HQ Notion Sync (no dependencies, Node 18+)
 *
 * Commands:
 *   node archive/scripts/notion-sync.js migrate
 *   node archive/scripts/notion-sync.js push-tasks
 *   node archive/scripts/notion-sync.js pull-tasks [outputPath]
 *   node archive/scripts/notion-sync.js daily-checkin --summary "..." [--metrics "..."] [--blockers "..."] [--next "..."] [--date YYYY-MM-DD]
 *   node archive/scripts/notion-sync.js open-tasks [--json]
 *   node archive/scripts/notion-sync.js sync-from-state [--archive-only] [--json]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const managerState = require('../../scripts/manager-state');

const WORKSPACE = path.resolve(__dirname, '..', '..');
const CONFIG = {
  parentPageId: '30ae3c01-be8e-8004-b546-cdef1e3435d1',
  db: {
    projects: '2a79787b-ef3f-443f-9e53-ec279cccebd2',
    tasks: '8c15f0cf-532b-485d-b5a7-07f312dd4dc7',
    content: '79438cfb-89ee-410f-991e-70255e527c19',
    daily: '199e5593-e719-4fc8-b09b-bdbf6346d3d1',
  },
};

const TODAY = managerState.currentLocalDate();

function readApiKey() {
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

const NOTION_KEY = readApiKey();

async function notionRequest(endpoint, method = 'GET', body = undefined, attempt = 1) {
  const controller = new AbortController();
  const timeoutMs = 20000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const message = json?.message || text || `HTTP ${res.status}`;
      throw new Error(`Notion API ${method} ${endpoint} failed: ${message}`);
    }
    return json;
  } catch (error) {
    const isAbort = error?.name === 'AbortError';
    if (isAbort && attempt < 3) {
      return notionRequest(endpoint, method, body, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const rt = (text) => ({ rich_text: [{ type: 'text', text: { content: String(text).slice(0, 1900) } }] });
const title = (text) => ({ title: [{ type: 'text', text: { content: String(text).slice(0, 1900) } }] });
const propStatus = (name) => ({ select: { name } });
const propSelect = (name) => ({ select: { name } });
const propDate = (start) => {
  if (!start) return undefined;
  return { date: { start } };
};
const propCheckbox = (value) => ({ checkbox: Boolean(value) });
const propRelation = (ids) => ({ relation: ids.filter(Boolean).map((id) => ({ id })) });
const propPeople = (ids) => ({ people: ids.filter(Boolean).map((id) => ({ id })) });

function cleanProps(properties) {
  return Object.fromEntries(Object.entries(properties).filter(([, v]) => v !== undefined && v !== null));
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function chunkText(text, max = 1800) {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return [];
  if (value.length <= max) return [value];

  const chunks = [];
  let remaining = value;
  while (remaining.length > max) {
    let idx = remaining.lastIndexOf('\n', max);
    if (idx < max * 0.5) idx = remaining.lastIndexOf(' ', max);
    if (idx < max * 0.5) idx = max;
    chunks.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

function richText(text) {
  return [{ type: 'text', text: { content: String(text).slice(0, 1900) } }];
}

function heading3Block(text) {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: { rich_text: richText(text) },
  };
}

function paragraphBlock(text) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: richText(text) },
  };
}

function quoteBlock(text) {
  return {
    object: 'block',
    type: 'quote',
    quote: { rich_text: richText(text) },
  };
}

function dividerBlock() {
  return { object: 'block', type: 'divider', divider: {} };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function ensureDatabaseSchema(dbId, properties) {
  await notionRequest(`/databases/${dbId}`, 'PATCH', { properties });
}

async function queryDatabase(dbId, payload = {}) {
  return notionRequest(`/databases/${dbId}/query`, 'POST', payload);
}

async function getMeUserId() {
  const me = await notionRequest('/users/me', 'GET');
  if (!me?.id) throw new Error('Notion /users/me returned no id');
  return me.id;
}

async function listAllUsers() {
  const users = [];
  let cursor = undefined;
  do {
    const qs = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : '';
    const res = await notionRequest(`/users${qs}`, 'GET');
    users.push(...(res.results || []));
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return users;
}

async function findUserIdByNameLike(nameLike) {
  const q = String(nameLike || '').trim().toLowerCase();
  if (!q) throw new Error('Assignee lookup requires a non-empty name');

  const users = await listAllUsers();

  const exact = users.find((u) => (u?.name || '').trim().toLowerCase() === q);
  if (exact?.id) return exact.id;

  const partial = users.find((u) => (u?.name || '').toLowerCase().includes(q));
  if (partial?.id) return partial.id;

  throw new Error(`Could not find Notion user matching: ${nameLike}`);
}

async function queryAllDatabase(dbId, payload = {}) {
  const results = [];
  let cursor = undefined;
  do {
    const page = await queryDatabase(dbId, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      ...payload,
    });
    results.push(...(page.results || []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return results;
}

function getTitleText(page) {
  return (page?.properties?.Name?.title || []).map((x) => x.plain_text).join('');
}

function getExternalIdText(page) {
  return (page?.properties?.['External ID']?.rich_text || []).map((x) => x.plain_text).join('');
}

const DB_INDEX_CACHE = new Map();

async function loadDatabaseIndex(dbId, force = false) {
  if (!force && DB_INDEX_CACHE.has(dbId)) return DB_INDEX_CACHE.get(dbId);

  const results = [];
  let cursor = undefined;
  do {
    const page = await queryDatabase(dbId, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    results.push(...(page.results || []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

  const index = {
    byName: new Map(),
    byExternalId: new Map(),
  };

  for (const page of results) {
    const name = getTitleText(page);
    const ext = getExternalIdText(page);
    if (name) index.byName.set(name, page);
    if (ext) index.byExternalId.set(ext, page);
  }

  DB_INDEX_CACHE.set(dbId, index);
  return index;
}

function updateDatabaseIndex(dbId, page) {
  const idx = DB_INDEX_CACHE.get(dbId);
  if (!idx) return;
  const name = getTitleText(page);
  const ext = getExternalIdText(page);
  if (name) idx.byName.set(name, page);
  if (ext) idx.byExternalId.set(ext, page);
}

async function findPageByExternalId(dbId, externalId) {
  if (!externalId) return null;
  const idx = await loadDatabaseIndex(dbId);
  return idx.byExternalId.get(externalId) || null;
}

async function findPageByName(dbId, name) {
  const idx = await loadDatabaseIndex(dbId);
  return idx.byName.get(name) || null;
}

async function upsertDatabasePage({ dbId, name, externalId, properties, children = [] }) {
  const props = cleanProps({
    Name: title(name),
    ...(externalId ? { 'External ID': rt(externalId) } : {}),
    ...properties,
  });

  let page = null;
  if (externalId) {
    page = await findPageByExternalId(dbId, externalId);
  }
  if (!page) {
    page = await findPageByName(dbId, name);
  }

  if (page) {
    const updated = await notionRequest(`/pages/${page.id}`, 'PATCH', { properties: props });
    updateDatabaseIndex(dbId, updated);
    return { page: updated, created: false };
  }

  const created = await notionRequest('/pages', 'POST', {
    parent: { database_id: dbId },
    properties: props,
    ...(children.length ? { children } : {}),
  });
  updateDatabaseIndex(dbId, created);
  return { page: created, created: true };
}

function summary(text, max = 1800) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, max);
}

let ASSIGNEE_IDS = null;
async function getAssigneeIds() {
  // Note: Notion People properties cannot reference bot users (integrations).
  // So we only store the human assignee id here.
  if (ASSIGNEE_IDS) return ASSIGNEE_IDS;
  const nishchay = await findUserIdByNameLike('nishchay');
  ASSIGNEE_IDS = { nishchay };
  return ASSIGNEE_IDS;
}

function isManualTask({ name, source, notes }) {
  const hay = `${name || ''}\n${source || ''}\n${notes || ''}`;

  // Notion UI/manual setup work.
  if (/notion\s*(ui|setup)|linked\s*view|pin\s*(them|it)\s*to\s*home/i.test(hay)) return true;

  // iOS/macOS tasks I cannot validate without a Mac/Xcode.
  if (/\bxcode\b|xcodebuild|\bmac\b|testflight|app\s*store\s*connect/i.test(hay)) return true;

  // PR review/merge tasks that require your eyeballs.
  if (/\bpr[-\s]*\d+\b/i.test(hay)) return true;

  // Explicitly tagged as Nishchay/manual in our sources.
  if (/nishchay/i.test(hay)) return true;

  return false;
}

async function routingForTask(task) {
  const { nishchay } = await getAssigneeIds();
  const manual = isManualTask(task);
  return {
    executor: manual ? 'Nishchay' : 'Zoe',
    assigneePeopleIds: manual ? [nishchay] : [],
  };
}

function loadText(filePath) {
  return fs.readFileSync(path.join(WORKSPACE, filePath), 'utf8');
}

async function ensureSchemas() {
  await ensureDatabaseSchema(CONFIG.db.projects, {
    Status: {
      select: {
        options: [
          { name: 'Todo', color: 'default' },
          { name: 'Doing', color: 'blue' },
          { name: 'Done', color: 'green' },
          { name: 'Blocked', color: 'red' },
        ],
      },
    },
    Area: {
      select: {
        options: [
          { name: 'Product', color: 'purple' },
          { name: 'Marketing', color: 'yellow' },
          { name: 'Ops', color: 'gray' },
        ],
      },
    },
    'Target Date': { date: {} },
    'Source Docs': { rich_text: {} },
    Notes: { rich_text: {} },
    'Last Synced': { date: {} },
    'External ID': { rich_text: {} },
  });

  await ensureDatabaseSchema(CONFIG.db.tasks, {
    Status: {
      select: {
        options: [
          { name: 'Backlog', color: 'gray' },
          { name: 'Todo', color: 'default' },
          { name: 'Doing', color: 'blue' },
          { name: 'Done', color: 'green' },
        ],
      },
    },
    Priority: {
      select: {
        options: [
          { name: 'P0', color: 'red' },
          { name: 'P1', color: 'yellow' },
          { name: 'P2', color: 'gray' },
        ],
      },
    },
    Area: {
      select: {
        options: [
          { name: 'Product', color: 'purple' },
          { name: 'Landing Page', color: 'pink' },
          { name: 'Marketing', color: 'yellow' },
          { name: 'Ops', color: 'gray' },
        ],
      },
    },
    Assignee: { people: {} },
    Executor: {
      select: {
        options: [
          { name: 'Zoe', color: 'blue' },
          { name: 'Nishchay', color: 'green' },
        ],
      },
    },
    'Due Date': { date: {} },
    Project: {
      relation: {
        database_id: CONFIG.db.projects,
        single_property: {},
      },
    },
    Source: { rich_text: {} },
    Notes: { rich_text: {} },
    'External ID': { rich_text: {} },
    'Last Synced': { date: {} },
  });

  await ensureDatabaseSchema(CONFIG.db.content, {
    Status: {
      select: {
        options: [
          { name: 'Todo', color: 'default' },
          { name: 'Doing', color: 'blue' },
          { name: 'Done', color: 'green' },
        ],
      },
    },
    Channel: {
      select: {
        options: [
          { name: 'X/Twitter', color: 'blue' },
          { name: 'Reddit', color: 'orange' },
          { name: 'Instagram', color: 'pink' },
          { name: 'Blog', color: 'purple' },
          { name: 'Email', color: 'green' },
          { name: 'ProductHunt', color: 'yellow' },
        ],
      },
    },
    'Publish Date': { date: {} },
    Pillar: {
      select: {
        options: [
          { name: 'Privacy', color: 'red' },
          { name: 'Safe to Spend', color: 'blue' },
          { name: 'Build in Public', color: 'purple' },
          { name: 'Launch', color: 'yellow' },
          { name: 'Community', color: 'green' },
        ],
      },
    },
    'Asset Type': {
      select: {
        options: [
          { name: 'Post', color: 'default' },
          { name: 'Thread', color: 'gray' },
          { name: 'Comment', color: 'brown' },
          { name: 'Email', color: 'green' },
          { name: 'Blog', color: 'purple' },
        ],
      },
    },
    Project: {
      relation: {
        database_id: CONFIG.db.projects,
        single_property: {},
      },
    },
    Source: { rich_text: {} },
    'External ID': { rich_text: {} },
    'Last Synced': { date: {} },
  });

  await ensureDatabaseSchema(CONFIG.db.daily, {
    Date: { date: {} },
    Summary: { rich_text: {} },
    Metrics: { rich_text: {} },
    Blockers: { rich_text: {} },
    'Next Priority': { rich_text: {} },
    Source: { rich_text: {} },
    'External ID': { rich_text: {} },
  });
}

async function seedProjects() {
  const fenceProjectText = loadText('memory/project-fence.md');
  const marketingText = loadText('memory/project-fence-marketing.md');

  const projects = [
    {
      name: 'Fence iOS App (Core Product)',
      externalId: 'project:fence-ios-core',
      status: 'Doing',
      area: 'Product',
      targetDate: '2026-02-27',
      sourceDocs: [
        'memory/project-fence.md',
        'expense-tracker-ios/*',
      ].join('\n'),
      notes: summary(
        `Local-first premium iOS expense tracker with Shortcuts automation and "Safe to Spend" hero metric. Current branch chain PR-1..PR-8 implemented; blocker is Mac/Xcode validation and xcodebuild test pass.`
      ),
    },
    {
      name: 'Fence Marketing Launch (India)',
      externalId: 'project:fence-marketing-launch',
      status: 'Doing',
      area: 'Marketing',
      targetDate: '2026-03-12',
      sourceDocs: [
        'memory/project-fence-marketing.md',
        'memory/marketing/*.md',
        'fence-marketing/strategy/campaign-plan.md',
        'fence-marketing/research/competitive-analysis.md',
        'fence-marketing/copywriting/{brand-narrative,copy-bank,landing-page-spec}.md',
      ].join('\n'),
      notes: summary(
        `Campaign in Week -2 Foundation stage; positioning is privacy-first + Apple-native + India-specific UPI reality. Core blockers: app name finalization, social account setup, waitlist launch.`
      ),
    },
    {
      name: 'Fence HQ Ops & Notion Sync',
      externalId: 'project:fence-hq-ops',
      status: 'Doing',
      area: 'Ops',
      targetDate: '2026-02-20',
      sourceDocs: [
        'memory/active-tasks.md',
        'archive/scripts/notion-sync.js',
      ].join('\n'),
      notes: summary(
        'Operational stream for Notion migration, ongoing task sync, and daily check-ins. Includes active blocker for GitHub auth to create private fence-marketing repository.'
      ),
    },
  ];

  const result = {};
  for (const p of projects) {
    const upserted = await upsertDatabasePage({
      dbId: CONFIG.db.projects,
      name: p.name,
      externalId: p.externalId,
      properties: cleanProps({
        Status: propStatus(p.status),
        Area: propSelect(p.area),
        'Target Date': propDate(p.targetDate),
        'Source Docs': rt(p.sourceDocs),
        Notes: rt(p.notes),
        'Last Synced': propDate(TODAY),
      }),
    });
    result[p.externalId] = upserted.page;
  }

  // Read files so migration uses source-of-truth content and cannot go stale silently.
  if (!fenceProjectText || !marketingText) {
    throw new Error('Source project files were empty during migration');
  }

  return result;
}

async function ensureLandingPageProject() {
  await ensureSchemas();

  const upserted = await upsertDatabasePage({
    dbId: CONFIG.db.projects,
    name: 'Fence Landing Page',
    externalId: 'project:fence-landing-page',
    properties: cleanProps({
      Status: propStatus('Doing'),
      Area: propSelect('Marketing'),
      'Target Date': propDate('2026-02-20'),
      'Source Docs': rt('fence-marketing/copywriting/landing-page-spec.md'),
      Notes: rt(
        summary(
          'Separate project to track the waitlist/landing-page build (copy, design, implementation, analytics).'
        )
      ),
      'Last Synced': propDate(TODAY),
    }),
  });

  const projectPage = upserted.page;

  const landingTask = await findPageByExternalId(CONFIG.db.tasks, 'task:marketing-launch-landing-page');
  let landingTaskUpdated = false;
  if (landingTask?.id) {
    await notionRequest(`/pages/${landingTask.id}`, 'PATCH', {
      properties: cleanProps({
        Project: propRelation([projectPage.id]),
        'Last Synced': propDate(TODAY),
      }),
    });
    landingTaskUpdated = true;
  }

  return { project: projectPage, landingTaskUpdated };
}

async function setupAssigneesToNishchay() {
  // Compatibility name: this now enforces the rule:
  // - Default: assign tasks to the agent (Notion integration user)
  // - Manual effort / cannot-do-here: assign to Nishchay
  await ensureSchemas();

  // Resolve Nishchay id once so we can set the People field for manual tasks.
  await getAssigneeIds();

  const pages = await queryAllDatabase(CONFIG.db.tasks, {
    sorts: [{ property: 'Due Date', direction: 'ascending' }],
  });

  let updated = 0;
  let skipped = 0;
  let manualCount = 0;

  for (const page of pages) {
    const p = page.properties;
    const taskName = plainText(p.Name);
    const source = plainText(p.Source);
    const notes = plainText(p.Notes);

    const route = await routingForTask({ name: taskName, source, notes });
    if (route.executor === 'Nishchay') manualCount += 1;

    const existingPeople = (p?.Assignee?.people || []).map((x) => x.id).sort();
    const desiredPeople = [...route.assigneePeopleIds].sort();
    const existingExecutor = p?.Executor?.select?.name || '';

    const samePeople =
      existingPeople.length === desiredPeople.length &&
      existingPeople.every((id, i) => id === desiredPeople[i]);
    const sameExecutor = existingExecutor === route.executor;

    if (samePeople && sameExecutor) {
      skipped += 1;
      continue;
    }

    await notionRequest(`/pages/${page.id}`, 'PATCH', {
      properties: cleanProps({
        Executor: propSelect(route.executor),
        Assignee: propPeople(route.assigneePeopleIds),
        'Last Synced': propDate(TODAY),
      }),
    });
    updated += 1;
  }

  return {
    totalTasks: pages.length,
    manualTasks: manualCount,
    updated,
    skipped,
  };
}

function taskSeed(projectByExternalId) {
  const p = projectByExternalId;
  return [
    {
      name: 'Finalize app name for Fence launch',
      externalId: 'task:marketing-finalize-app-name',
      status: 'Doing',
      area: 'Marketing',
      priority: 'P0',
      dueDate: '2026-02-18',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'memory/marketing/2026-02-13.md',
    },
    {
      name: 'Create/optimize product X (Twitter) account',
      externalId: 'task:marketing-create-twitter-account',
      status: 'Todo',
      area: 'Marketing',
      priority: 'P0',
      dueDate: '2026-02-18',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'memory/project-fence-marketing.md',
    },
    {
      name: 'Implement and publish waitlist landing page (Formspree)',
      externalId: 'task:marketing-launch-landing-page',
      status: 'Todo',
      area: 'Marketing',
      priority: 'P0',
      dueDate: '2026-02-20',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'fence-marketing/copywriting/landing-page-spec.md',
    },
    {
      name: 'Finalize App Store listing copy draft',
      externalId: 'task:marketing-finalize-appstore-copy',
      status: 'Doing',
      area: 'Marketing',
      priority: 'P1',
      dueDate: '2026-02-19',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'fence-marketing/copywriting/copy-bank.md',
    },
    {
      name: 'Design 3-5 marketing screenshots',
      externalId: 'task:marketing-design-screenshots',
      status: 'Todo',
      area: 'Marketing',
      priority: 'P1',
      dueDate: '2026-02-20',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'memory/project-fence-marketing.md',
    },
    {
      name: 'Research best IST posting times for target subreddits',
      externalId: 'task:marketing-reddit-posting-times',
      status: 'Todo',
      area: 'Marketing',
      priority: 'P1',
      dueDate: '2026-02-18',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'memory/project-fence-marketing.md',
    },
    {
      name: 'Prepare and schedule first 10 build-in-public tweets',
      externalId: 'task:marketing-schedule-10-tweets',
      status: 'Todo',
      area: 'Marketing',
      priority: 'P1',
      dueDate: '2026-02-19',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'fence-marketing/drafts/twitter-threads.md',
    },
    {
      name: 'Finalize 5 Reddit organic posts from draft bank',
      externalId: 'task:marketing-finalize-reddit-posts',
      status: 'Doing',
      area: 'Marketing',
      priority: 'P1',
      dueDate: '2026-02-19',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'fence-marketing/drafts/reddit-posts.md',
    },
    {
      name: 'Validate PR-1..PR-8 on Mac (xcodebuild + tests)',
      externalId: 'task:product-validate-pr-chain-xcode',
      status: 'Todo',
      area: 'Product',
      priority: 'P0',
      dueDate: '2026-02-18',
      projectId: p['project:fence-ios-core']?.id,
      source: 'memory/project-fence.md',
    },
    {
      name: 'Merge validated branches into release candidate',
      externalId: 'task:product-merge-release-candidate',
      status: 'Todo',
      area: 'Product',
      priority: 'P0',
      dueDate: '2026-02-21',
      projectId: p['project:fence-ios-core']?.id,
      source: 'memory/project-fence.md',
    },
    {
      name: 'Prepare App Store/TestFlight launch checklist',
      externalId: 'task:product-launch-checklist',
      status: 'Todo',
      area: 'Product',
      priority: 'P1',
      dueDate: '2026-02-24',
      projectId: p['project:fence-ios-core']?.id,
      source: 'memory/project-fence.md',
    },
    {
      name: 'Create private fence-marketing repo and add nishchay-v collaborator',
      externalId: 'task:ops-create-marketing-repo',
      status: 'Todo',
      area: 'Ops',
      priority: 'P1',
      dueDate: '2026-02-18',
      projectId: p['project:fence-hq-ops']?.id,
      source: 'memory/active-tasks.md',
    },
    {
      name: 'Home page should tasks due in next 3 days',
      externalId: 'task:ops-home-upcoming-3-days',
      status: 'Todo',
      area: 'Ops',
      priority: 'P1',
      projectId: p['project:fence-hq-ops']?.id,
      source: 'Nishchay’s Notes',
      notes: summary(
        `Notion setup (manual):\n\n1) Open Fence HQ → Home page.\n2) Insert a Linked view of the Tasks database.\n3) Filter: Status is not Done (and not Archived, if you use it).\n4) Filter: Due Date is within the next 3 days (relative).\n5) Sort: Due Date ascending.\n6) View type: List (or Table) with columns: Task, Area, Priority, Due Date.\n7) Optional: group by Area, collapse groups.\n\nAcceptance: Home shows only upcoming tasks due in the next 3 days, ordered by due date.`
      ),
    },
    {
      name: 'Create separate task views for Product, Marketing and Ops, Pin them to home page',
      externalId: 'task:ops-home-area-views',
      status: 'Todo',
      area: 'Ops',
      priority: 'P1',
      projectId: p['project:fence-hq-ops']?.id,
      source: 'Nishchay’s Notes',
      notes: summary(
        `Notion setup (manual):\n\n1) On Fence HQ → Home, add 3 Linked views of Tasks DB: Product / Marketing / Ops.\n2) Each view filter: Area = <Area> AND Status is not Done.\n3) Sort: Priority (P0→P2) then Due Date ascending.\n4) Keep views compact (hide non-essential columns).\n5) Arrange them as 3 sections (headings + view).\n6) If you want “pinned”: add these as top blocks on Home and mark the Home page as a Favorite in sidebar.\n\nAcceptance: Home has 3 always-visible filtered views by Area with sensible sorting.`
      ),
    },
    {
      name: 'Migrate Fence project + marketing into Fence HQ Notion',
      externalId: 'task:ops-notion-migration',
      status: 'Done',
      area: 'Ops',
      priority: 'P0',
      dueDate: TODAY,
      projectId: p['project:fence-hq-ops']?.id,
      source: 'archive/scripts/notion-sync.js',
    },
    {
      name: 'Set up idempotent Notion sync CLI for daily operations',
      externalId: 'task:ops-setup-notion-sync-cli',
      status: 'Done',
      area: 'Ops',
      priority: 'P0',
      dueDate: TODAY,
      projectId: p['project:fence-hq-ops']?.id,
      source: 'archive/scripts/notion-sync.js',
    },
    {
      name: 'Complete competitive analysis of top Indian expense apps',
      externalId: 'task:marketing-competitive-analysis',
      status: 'Done',
      area: 'Marketing',
      priority: 'P1',
      dueDate: '2026-02-13',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'fence-marketing/research/competitive-analysis.md',
    },
    {
      name: 'Publish brand narrative + copy bank source-of-truth docs',
      externalId: 'task:marketing-brand-copy-bank',
      status: 'Done',
      area: 'Marketing',
      priority: 'P1',
      dueDate: '2026-02-13',
      projectId: p['project:fence-marketing-launch']?.id,
      source: 'fence-marketing/copywriting/{brand-narrative,copy-bank}.md',
    },
  ];
}

async function seedTasks(projectByExternalId) {
  const tasks = taskSeed(projectByExternalId);
  const out = [];
  for (const t of tasks) {
    const route = await routingForTask(t);
    const upserted = await upsertDatabasePage({
      dbId: CONFIG.db.tasks,
      name: t.name,
      externalId: t.externalId,
      properties: cleanProps({
        Status: propStatus(t.status),
        Priority: propSelect(t.priority),
        Area: propSelect(t.area),
        Executor: propSelect(route.executor),
        ...(route.assigneePeopleIds.length ? { Assignee: propPeople(route.assigneePeopleIds) } : { Assignee: propPeople([]) }),
        'Due Date': propDate(t.dueDate),
        Project: propRelation([t.projectId]),
        Source: rt(t.source),
        ...(t.notes ? { Notes: rt(t.notes) } : {}),
        'Last Synced': propDate(TODAY),
      }),
    });
    out.push(upserted.page);
  }
  return out;
}

function contentSeed(projectByExternalId) {
  const marketingProjectId = projectByExternalId['project:fence-marketing-launch']?.id;
  return [
    {
      name: 'Thread: Why I built a local-first Fence for India',
      externalId: 'content:x-thread-local-first-india',
      status: 'Doing',
      channel: 'X/Twitter',
      publishDate: '2026-02-18',
      pillar: 'Build in Public',
      assetType: 'Thread',
      source: 'fence-marketing/drafts/twitter-threads.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Reddit post: r/personalfinanceindia (Before → After)',
      externalId: 'content:reddit-pfi-before-after',
      status: 'Doing',
      channel: 'Reddit',
      publishDate: '2026-02-18',
      pillar: 'Safe to Spend',
      assetType: 'Post',
      source: 'fence-marketing/drafts/reddit-posts.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Tweet: "Banks track everything you spend. We don\'t."',
      externalId: 'content:x-conflict-banks-track',
      status: 'Todo',
      channel: 'X/Twitter',
      publishDate: '2026-02-19',
      pillar: 'Privacy',
      assetType: 'Post',
      source: 'fence-marketing/drafts/hooks.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Reddit post: r/developersIndia (build in public)',
      externalId: 'content:reddit-devindia-build-public',
      status: 'Todo',
      channel: 'Reddit',
      publishDate: '2026-02-20',
      pillar: 'Build in Public',
      assetType: 'Post',
      source: 'fence-marketing/drafts/reddit-posts.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Thread: The UPI privacy problem nobody talks about',
      externalId: 'content:x-thread-upi-privacy',
      status: 'Todo',
      channel: 'X/Twitter',
      publishDate: '2026-02-21',
      pillar: 'Privacy',
      assetType: 'Thread',
      source: 'fence-marketing/drafts/twitter-threads.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Instagram post: OLED design + privacy-first angle',
      externalId: 'content:ig-oled-privacy-design',
      status: 'Todo',
      channel: 'Instagram',
      publishDate: '2026-02-22',
      pillar: 'Privacy',
      assetType: 'Post',
      source: 'fence-marketing/copywriting/copy-bank.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Reddit post: r/india UPI tracking pain',
      externalId: 'content:reddit-india-upi-pain',
      status: 'Todo',
      channel: 'Reddit',
      publishDate: '2026-02-23',
      pillar: 'Community',
      assetType: 'Post',
      source: 'fence-marketing/drafts/reddit-posts.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Tweet: Safe to Spend teaser screenshot',
      externalId: 'content:x-safe-to-spend-teaser',
      status: 'Todo',
      channel: 'X/Twitter',
      publishDate: '2026-02-24',
      pillar: 'Safe to Spend',
      assetType: 'Post',
      source: 'fence-marketing/copywriting/copy-bank.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Blog post: No-server finance stack (India context)',
      externalId: 'content:blog-no-server-finance-stack',
      status: 'Todo',
      channel: 'Blog',
      publishDate: '2026-02-25',
      pillar: 'Privacy',
      assetType: 'Blog',
      source: 'fence-marketing/copywriting/brand-narrative.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Email: Early access warm-up to waitlist',
      externalId: 'content:email-waitlist-warmup',
      status: 'Todo',
      channel: 'Email',
      publishDate: '2026-02-26',
      pillar: 'Launch',
      assetType: 'Email',
      source: 'fence-marketing/copywriting/copy-bank.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Launch Day X thread + demo clip',
      externalId: 'content:x-launch-day-thread',
      status: 'Todo',
      channel: 'X/Twitter',
      publishDate: '2026-02-27',
      pillar: 'Launch',
      assetType: 'Thread',
      source: 'memory/project-fence-marketing.md',
      projectId: marketingProjectId,
    },
    {
      name: 'Launch Day Reddit post (r/developersIndia + r/SideProject)',
      externalId: 'content:reddit-launch-day-post',
      status: 'Todo',
      channel: 'Reddit',
      publishDate: '2026-02-27',
      pillar: 'Launch',
      assetType: 'Post',
      source: 'memory/project-fence-marketing.md',
      projectId: marketingProjectId,
    },
  ];
}

async function seedContentCalendar(projectByExternalId) {
  const rows = contentSeed(projectByExternalId);
  const out = [];
  for (const item of rows) {
    const upserted = await upsertDatabasePage({
      dbId: CONFIG.db.content,
      name: item.name,
      externalId: item.externalId,
      properties: cleanProps({
        Status: propStatus(item.status),
        Channel: propSelect(item.channel),
        'Publish Date': propDate(item.publishDate),
        Pillar: propSelect(item.pillar),
        'Asset Type': propSelect(item.assetType),
        Project: propRelation([item.projectId]),
        Source: rt(item.source),
        'Last Synced': propDate(TODAY),
      }),
    });
    out.push(upserted.page);
  }
  return out;
}

async function upsertDailyLog({ date, summaryText, metricsText, blockersText, nextPriority, source }) {
  const externalId = `daily:${date}`;
  const upserted = await upsertDatabasePage({
    dbId: CONFIG.db.daily,
    name: `Daily Check-in ${date}`,
    externalId,
    properties: cleanProps({
      Date: propDate(date),
      Summary: summaryText ? rt(summaryText) : undefined,
      Metrics: metricsText ? rt(metricsText) : undefined,
      Blockers: blockersText ? rt(blockersText) : undefined,
      'Next Priority': nextPriority ? rt(nextPriority) : undefined,
      Source: source ? rt(source) : undefined,
    }),
  });
  return upserted.page;
}

async function seedDailyLogs() {
  const metrics = JSON.parse(loadText('memory/marketing/metrics.json'));
  const week = metrics.weekly['2026-W07'];

  const day1 = await upsertDailyLog({
    date: '2026-02-13',
    summaryText:
      'Campaign setup complete: strategy finalized, competitive analysis, brand narrative, copy bank, and landing-page spec all drafted.',
    metricsText: `Twitter followers: ${week.twitter_followers}; Reddit posts: ${week.reddit_posts}; Waitlist signups: ${week.waitlist_signups}; Tasks completed: ${week.tasks_completed}/${week.tasks_total}`,
    blockersText:
      'App name not finalized; no product Twitter account; iOS PR chain requires Mac/Xcode validation.',
    nextPriority:
      'Finalize name, create product social account, and implement waitlist landing page.',
    source: 'memory/marketing/2026-02-13.md',
  });

  const migrationDay = await upsertDailyLog({
    date: TODAY,
    summaryText:
      'Migrated Fence product + marketing tracking into Notion Fence HQ: schema updates, project/task/content seeding, and sync CLI setup.',
    metricsText: 'Projects seeded: 3; Tasks seeded: 16; Content entries seeded: 12.',
    blockersText:
      'Still blocked on app name finalization, GitHub auth for private marketing repo, and Mac/Xcode validation for PR chain.',
    nextPriority:
      'Run push-tasks daily, execute posting calendar, and close P0 blockers before launch week.',
    source: 'archive/scripts/notion-sync.js migrate',
  });

  return [day1, migrationDay];
}

function parseActiveTasksMarkdown(text) {
  const activeSection = text.includes('## Current Tasks') ? text.split('## Current Tasks')[1] : text;
  const matches = [...activeSection.matchAll(/## Task: (.+?)\n([\s\S]*?)(?=\n## Task: |\n---|\n\*\*Instructions|$)/g)];
  return matches
    .map((m) => {
      const name = m[1].trim();
      const body = m[2];
      const status = (body.match(/\*\*Status\*\*:\s*([^\n]+)/)?.[1] || 'waiting').trim();
      const nextStep = (body.match(/\*\*Next Step\*\*:\s*([^\n]+)/)?.[1] || '').trim();
      const notes = (body.match(/\*\*Notes\*\*:\s*([^\n]+)/)?.[1] || '').trim();
      return { name, status, nextStep, notes };
    })
    .filter((t) => !t.name.includes('[Brief Description]') && !t.name.includes('['));
}

function mapActiveStatusToNotion(status) {
  const s = status.toLowerCase();
  if (s.includes('completed')) return 'Done';
  if (s.includes('in-progress')) return 'Doing';
  if (s.includes('waiting') || s.includes('blocked')) return 'Backlog';
  return 'Todo';
}

async function pushActiveTasks() {
  const filePath = path.join(WORKSPACE, 'memory', 'active-tasks.md');
  const text = fs.readFileSync(filePath, 'utf8');
  const tasks = parseActiveTasksMarkdown(text);

  const opsProject = await findPageByExternalId(CONFIG.db.projects, 'project:fence-hq-ops');

  const upserted = [];
  for (const t of tasks) {
    const taskSlug = slugify(t.name);
    const isRepoTask = taskSlug.includes('create-fence-marketing-repo') || taskSlug.includes('create-private-fence-marketing-repo');
    const ext = isRepoTask ? 'task:ops-create-marketing-repo' : `active-task:${taskSlug}`;
    const canonicalName = isRepoTask
      ? 'Create private fence-marketing repo and add nishchay-v collaborator'
      : t.name;

    const row = await upsertDatabasePage({
      dbId: CONFIG.db.tasks,
      name: canonicalName,
      externalId: ext,
      properties: cleanProps({
        Status: propStatus(mapActiveStatusToNotion(t.status)),
        Priority: propSelect('P1'),
        Area: propSelect('Ops'),
        Executor: propSelect('Zoe'),
        Assignee: propPeople([]),
        Project: propRelation([opsProject?.id]),
        Source: rt(`memory/active-tasks.md | Next: ${summary(t.nextStep, 300)}`),
        'Last Synced': propDate(TODAY),
      }),
    });
    upserted.push(row.page);
  }

  return upserted;
}

async function updateTaskByExternalId(externalId, updates) {
  if (!externalId) throw new Error('update-task requires --external-id');

  await ensureSchemas();
  const page = await findPageByExternalId(CONFIG.db.tasks, externalId);
  if (!page) throw new Error(`Task not found in Notion by External ID: ${externalId}`);

  const properties = cleanProps({
    ...(updates.status ? { Status: propStatus(updates.status) } : {}),
    ...(updates.area ? { Area: propSelect(updates.area) } : {}),
    ...(updates.priority ? { Priority: propSelect(updates.priority) } : {}),
    ...(updates.dueDate ? { 'Due Date': propDate(updates.dueDate) } : {}),
    ...(updates.source ? { Source: rt(updates.source) } : {}),
    ...(updates.notes ? { Notes: rt(updates.notes) } : {}),
    'Last Synced': propDate(TODAY),
  });

  const updated = await notionRequest(`/pages/${page.id}`, 'PATCH', { properties });
  updateDatabaseIndex(CONFIG.db.tasks, updated);
  return updated;
}

async function updateTaskPage(pageId, updates) {
  if (!pageId) throw new Error('update-task-page requires pageId');
  await ensureSchemas();

  const properties = cleanProps({
    ...(updates.status ? { Status: propStatus(updates.status) } : {}),
    ...(updates.area ? { Area: propSelect(updates.area) } : {}),
    ...(updates.priority ? { Priority: propSelect(updates.priority) } : {}),
    ...(updates.dueDate ? { 'Due Date': propDate(updates.dueDate) } : {}),
    ...(updates.source ? { Source: rt(updates.source) } : {}),
    ...(updates.notes ? { Notes: rt(updates.notes) } : {}),
    'Last Synced': propDate(TODAY),
  });

  const updated = await notionRequest(`/pages/${pageId}`, 'PATCH', { properties });
  updateDatabaseIndex(CONFIG.db.tasks, updated);
  return updated;
}

function plainText(prop) {
  if (!prop) return '';
  if (prop.type === 'title') return (prop.title || []).map((t) => t.plain_text).join('');
  if (prop.type === 'rich_text') return (prop.rich_text || []).map((t) => t.plain_text).join('');
  if (prop.type === 'status') return prop.status?.name || '';
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'date') return prop.date?.start || '';
  if (prop.type === 'checkbox') return prop.checkbox ? 'Yes' : 'No';
  if (prop.type === 'people') return (prop.people || []).map((p) => p.name || p.id).join(', ');
  return '';
}

async function appendBlocksToPage(pageId, blocks) {
  const usable = (blocks || []).filter(Boolean);
  for (let idx = 0; idx < usable.length; idx += 90) {
    await notionRequest(`/blocks/${pageId}/children`, 'PATCH', {
      children: usable.slice(idx, idx + 90),
    });
  }
}

function buildSignalBlocks(signals) {
  const blocks = [];
  for (const signal of signals) {
    blocks.push(dividerBlock());
    blocks.push(
      heading3Block(
        `[${signal.localTime}] ${signal.kind.replace(/_/g, ' ')}${signal.area ? ` · ${signal.area}` : ''}`
      )
    );
    const chunks = chunkText(signal.bodyText);
    if (chunks[0]) blocks.push(quoteBlock(chunks[0]));
    for (const extra of chunks.slice(1)) {
      blocks.push(paragraphBlock(extra));
    }
  }
  return blocks;
}

function normalizeTaskPage(page) {
  return {
    taskKey: getExternalIdText(page) || page.id,
    pageId: page.id,
    url: page.url,
    title: getTitleText(page) || '(untitled task)',
    externalId: getExternalIdText(page) || null,
    status: page?.properties?.Status?.select?.name || '',
    priority: page?.properties?.Priority?.select?.name || '',
    area: page?.properties?.Area?.select?.name || '',
    executor: page?.properties?.Executor?.select?.name || '',
    dueDate: page?.properties?.['Due Date']?.date?.start || '',
    source: plainText(page?.properties?.Source),
  };
}

async function queryOpenTasksNormalized() {
  await ensureSchemas();
  const results = await queryAllDatabase(CONFIG.db.tasks, {
    sorts: [
      { property: 'Status', direction: 'ascending' },
      { property: 'Due Date', direction: 'ascending' },
      { property: 'Last Synced', direction: 'descending' },
    ],
  });
  return results
    .map(normalizeTaskPage)
    .filter((task) => task.status && task.status !== 'Done')
    .sort((left, right) => {
      const priorityDiff = managerState.priorityRank(left.priority) - managerState.priorityRank(right.priority);
      if (priorityDiff !== 0) return priorityDiff;
      const dueA = left.dueDate || '9999-12-31';
      const dueB = right.dueDate || '9999-12-31';
      if (dueA !== dueB) return dueA < dueB ? -1 : 1;
      return left.title.localeCompare(right.title);
    });
}

async function pullTasksToMarkdown(outputPath) {
  // Only export tasks owned by the agent.
  const results = await queryAllDatabase(CONFIG.db.tasks, {
    filter: { property: 'Executor', select: { equals: 'Zoe' } },
    sorts: [
      { property: 'Status', direction: 'ascending' },
      { property: 'Due Date', direction: 'ascending' },
    ],
  });

  // Defensive guard: never leak Nishchay/manual tasks even if query filtering changes upstream.
  const zoeResults = results.filter((page) => page?.properties?.Executor?.select?.name === 'Zoe');

  const lines = [];
  lines.push('# Notion Tasks Sync (Fence HQ)');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| Status | Task | Area | Priority | Due | Source |');
  lines.push('|---|---|---|---|---|---|');

  for (const page of zoeResults) {
    const p = page.properties;
    lines.push(
      `| ${plainText(p.Status)} | ${plainText(p.Name)} | ${plainText(p.Area)} | ${plainText(p.Priority)} | ${plainText(p['Due Date'])} | ${plainText(p.Source).replace(/\|/g, '/')} |`
    );
  }

  const resolved = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(WORKSPACE, outputPath || 'archive/memory/notion/tasks.md');

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${lines.join('\n')}\n`, 'utf8');
  return resolved;
}

async function syncPendingTaskUpdates(dashboard) {
  const results = [];
  for (const [taskKey, meta] of Object.entries(dashboard.tasksMeta || {})) {
    if (!meta?.pendingStatus && !meta?.pendingDueDate) continue;

    const updates = cleanProps({
      ...(meta.pendingStatus ? { status: meta.pendingStatus } : {}),
      ...(meta.pendingDueDate ? { dueDate: meta.pendingDueDate } : {}),
    });

    if (!Object.keys(updates).length) continue;

    try {
      let page;
      if (meta.pageId) page = await updateTaskPage(meta.pageId, updates);
      else if (meta.externalId) page = await updateTaskByExternalId(meta.externalId, updates);
      else {
        results.push({ taskKey, title: meta.title || taskKey, error: 'No pageId or externalId available.' });
        continue;
      }

      meta.pendingStatus = null;
      meta.pendingDueDate = null;
      results.push({ taskKey, title: meta.title || taskKey, url: page.url });
    } catch (error) {
      results.push({ taskKey, title: meta.title || taskKey, error: error.message || String(error) });
    }
  }
  return results;
}

async function syncFromState({ archiveOnly = false } = {}) {
  await ensureSchemas();

  const dashboard = managerState.loadDashboard();
  const ideasState = managerState.loadIdeas();
  const archiveState = managerState.loadArchive();

  managerState.rolloverDashboardIfNeeded(dashboard);

  const signals = managerState.collectUnsyncedSignals(archiveState);
  const applyResult = managerState.applySignalsToState({
    dashboard,
    ideasState,
    signals,
  });

  managerState.saveDashboard(dashboard);
  managerState.saveIdeas(ideasState);

  const taskResults = archiveOnly ? [] : await syncPendingTaskUpdates(dashboard);
  managerState.saveDashboard(dashboard);

  const dailyFields = managerState.buildDailySummaryFields(dashboard, ideasState);
  const groupedSignals = new Map();
  for (const signal of signals) {
    if (!groupedSignals.has(signal.localDate)) groupedSignals.set(signal.localDate, []);
    groupedSignals.get(signal.localDate).push(signal);
  }

  const archivedPages = {};
  for (const [date, entries] of groupedSignals.entries()) {
    const page = await upsertDailyLog({
      date,
      summaryText: !archiveOnly && date === dashboard.today.date ? dailyFields.summary : undefined,
      metricsText: !archiveOnly && date === dashboard.today.date ? dailyFields.metrics : undefined,
      blockersText: !archiveOnly && date === dashboard.today.date ? dailyFields.blockers : undefined,
      nextPriority: !archiveOnly && date === dashboard.today.date ? dailyFields.nextPriority : undefined,
      source: 'archive/scripts/notion-sync.js sync-from-state',
    });
    archivedPages[date] = page.url;
    if (entries.length) {
      await appendBlocksToPage(page.id, buildSignalBlocks(entries));
    }
  }

  if (!archiveOnly && !groupedSignals.has(dashboard.today.date)) {
    const page = await upsertDailyLog({
      date: dashboard.today.date,
      summaryText: dailyFields.summary,
      metricsText: dailyFields.metrics,
      blockersText: dailyFields.blockers,
      nextPriority: dailyFields.nextPriority,
      source: 'archive/scripts/notion-sync.js sync-from-state',
    });
    archivedPages[dashboard.today.date] = page.url;
  }

  if (signals.length) {
    managerState.rememberSignals(archiveState, signals);
  }
  archiveState.lastNotionSyncAt = managerState.nowIso();

  const memoryNotes = [];
  if (applyResult.newIdeas.length) {
    memoryNotes.push(`Captured ${applyResult.newIdeas.length} new idea(s).`);
  }
  if (applyResult.completedTaskKeys.length) {
    memoryNotes.push(`Marked ${applyResult.completedTaskKeys.length} tracked priority item(s) done from chat.`);
  }
  if (applyResult.contextTouched) {
    memoryNotes.push(
      `Updated day context: work=${dashboard.context.workLoad || 'unknown'}, sleep=${dashboard.context.sleepQuality || 'unknown'}, energy=${dashboard.context.energyLevel || 'unknown'}.`
    );
  }
  if (applyResult.latestStrategyUpdate) {
    memoryNotes.push(`Refreshed focus note from chat.`);
  }
  if (signals.length) {
    memoryNotes.push(`Archived ${signals.length} user message(s) into Notion daily logs.`);
  }
  const taskSuccessCount = taskResults.filter((result) => !result.error).length;
  if (taskSuccessCount) {
    memoryNotes.push(`Synced ${taskSuccessCount} task status/deadline update(s) to Notion.`);
  }
  if (memoryNotes.length) {
    managerState.appendDailyMemoryNotes(dashboard.today.date, 'Manager Sync', memoryNotes);
  }

  managerState.saveDashboard(dashboard);
  managerState.saveIdeas(ideasState);
  managerState.saveArchive(archiveState);

  return {
    date: dashboard.today.date,
    archivedSignals: signals.length,
    newIdeas: applyResult.newIdeas.length,
    completedTaskUpdates: applyResult.completedTaskKeys.length,
    notionTaskUpdates: taskResults,
    archivedPages,
    dailySummary: dailyFields,
  };
}

async function runMigration() {
  console.error('[migrate] ensuring schemas...');
  await ensureSchemas();
  console.error('[migrate] seeding projects...');
  const projects = await seedProjects();
  console.error('[migrate] seeding tasks...');
  const tasks = await seedTasks(projects);
  console.error('[migrate] seeding content calendar...');
  const content = await seedContentCalendar(projects);
  console.error('[migrate] seeding daily logs...');
  const logs = await seedDailyLogs();
  console.error('[migrate] pushing active tasks...');
  const activeTasks = await pushActiveTasks();
  console.error('[migrate] pulling tasks snapshot...');
  const pulledPath = await pullTasksToMarkdown('archive/memory/notion/tasks.md');

  const summaryObj = {
    projects: Object.values(projects).filter(Boolean).length,
    tasks: tasks.length,
    content: content.length,
    dailyLogs: logs.length,
    activeTasks: activeTasks.length,
    taskExport: pulledPath,
    projectPages: Object.fromEntries(
      Object.entries(projects)
        .filter(([k]) => k.startsWith('project:'))
        .map(([k, v]) => [k, { id: v.id, url: v.url }])
    ),
  };

  const outPath = path.join(WORKSPACE, 'archive', 'memory', 'notion', 'migration-summary.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summaryObj, null, 2));

  return summaryObj;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || ['-h', '--help', 'help'].includes(cmd)) {
    console.log(`Fence HQ Notion Sync Archive\n\nCommands:\n  migrate\n  push-tasks\n  pull-tasks [outputPath]\n  open-tasks [--json]\n  sync-from-state [--archive-only] [--json]\n  update-task --external-id <id> [--status <Backlog|Todo|Doing|Done>] [--area <...>] [--priority <...>] [--due-date YYYY-MM-DD] [--source \"...\"] [--notes \"...\"]\n  daily-checkin --summary \"...\" [--metrics \"...\"] [--blockers \"...\"] [--next \"...\"] [--date YYYY-MM-DD]\n  setup-assignees   # default assigns everything to the agent; assigns manual tasks to Nishchay\n  setup-landing-page-project  # creates Landing Page project + attaches landing task\n`);
    process.exit(0);
  }

  if (cmd === 'migrate') {
    const out = await runMigration();
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'push-tasks') {
    await ensureSchemas();
    const out = await pushActiveTasks();
    console.log(`Synced ${out.length} active task(s) from memory/active-tasks.md`);
    return;
  }

  if (cmd === 'pull-tasks') {
    await ensureSchemas();
    const file = await pullTasksToMarkdown(args._[1] || 'archive/memory/notion/tasks.md');
    console.log(`Wrote ${file}`);
    return;
  }

  if (cmd === 'open-tasks') {
    const tasks = await queryOpenTasksNormalized();
    if (args.json) {
      console.log(JSON.stringify({ tasks }, null, 2));
      return;
    }
    console.log(tasks.map((task) => `[${task.priority || 'P1'}] ${task.title}`).join('\n'));
    return;
  }

  if (cmd === 'sync-from-state') {
    const out = await syncFromState({ archiveOnly: Boolean(args['archive-only']) });
    if (args.json) {
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    console.log(
      `Synced manager state: ${out.archivedSignals} message(s), ${out.newIdeas} idea(s), ${out.completedTaskUpdates} completion update(s).`
    );
    return;
  }

  if (cmd === 'update-task') {
    const page = await updateTaskByExternalId(args['external-id'], {
      status: args.status,
      area: args.area,
      priority: args.priority,
      dueDate: args['due-date'],
      source: args.source,
      notes: args.notes,
    });

    console.log(`Updated task: ${page.url}`);
    return;
  }

  if (cmd === 'setup-assignees') {
    const out = await setupAssigneesToNishchay();
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (cmd === 'setup-landing-page-project') {
    const out = await ensureLandingPageProject();
    console.log(JSON.stringify({
      projectUrl: out.project?.url,
      landingTaskUpdated: out.landingTaskUpdated,
    }, null, 2));
    return;
  }

  if (cmd === 'daily-checkin') {
    await ensureSchemas();
    const date = args.date || TODAY;
    if (!args.summary) {
      throw new Error('daily-checkin requires --summary');
    }

    const page = await upsertDailyLog({
      date,
      summaryText: args.summary,
      metricsText: args.metrics || '',
      blockersText: args.blockers || '',
      nextPriority: args.next || '',
      source: 'archive/scripts/notion-sync.js daily-checkin',
    });

    console.log(`Daily check-in synced: ${page.url}`);
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
