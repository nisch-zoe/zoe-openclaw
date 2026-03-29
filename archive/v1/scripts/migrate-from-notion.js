#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('./db');
const managerState = require('./manager-state');
const { bootstrapLocalFoundation } = require('./init-local-foundation');

const WORKSPACE = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.resolve(WORKSPACE, '..');
const KNOWLEDGE_ROOT = path.join(OPENCLAW_HOME, 'knowledge');
const IDEAS_ROOT = path.join(KNOWLEDGE_ROOT, 'ideas');
const ARCHIVED_NOTION_SYNC = path.join(WORKSPACE, 'archive', 'scripts', 'notion-sync.js');
const NOTION_VERSION = '2025-09-03';
const LIFEOS_TASKS_DATA_SOURCE_ID = '2b8143f7-6290-4abc-9c3d-6a14a1424cd3';

const PROJECT_SEEDS = [
  {
    id: 'project:fence',
    slug: 'fence',
    name: 'Fence',
    status: 'active',
    area: 'product',
    knowledgePath: 'knowledge/projects/fence/overview.md',
    notes: 'Core product and marketing context for the local-first expense tracker launch.',
    metadata: {
      source: 'phase2-notion-cutover',
    },
  },
  {
    id: 'project:openclaw',
    slug: 'openclaw',
    name: 'OpenClaw',
    status: 'active',
    area: 'ops',
    knowledgePath: 'knowledge/projects/openclaw/overview.md',
    notes: 'Manager loop, local automation, and agent workspace docs.',
    metadata: {
      source: 'phase2-notion-cutover',
    },
  },
];

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function relativeToOpenclaw(targetPath) {
  return path.relative(OPENCLAW_HOME, targetPath);
}

function writeFileSafely(targetPath, content, summary) {
  ensureDir(path.dirname(targetPath));

  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, content, 'utf8');
    summary.created.push(relativeToOpenclaw(targetPath));
    return;
  }

  const existing = fs.readFileSync(targetPath, 'utf8');
  if (existing === content) {
    summary.unchanged.push(relativeToOpenclaw(targetPath));
    return;
  }

  summary.conflicts.push(relativeToOpenclaw(targetPath));
}

function copyFileSafely(sourcePath, targetPath, summary) {
  const content = fs.readFileSync(sourcePath, 'utf8');
  writeFileSafely(targetPath, content, summary);
}

function copyDirectorySafely(sourceDir, targetDir, summary) {
  ensureDir(targetDir);

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectorySafely(sourcePath, targetPath, summary);
      continue;
    }

    if (!entry.isFile()) continue;
    copyFileSafely(sourcePath, targetPath, summary);
  }
}

function buildOpenclawOverview() {
  return `# Project: OpenClaw

## Purpose

OpenClaw is the local-first operating system for Zoe as Nisch's personal manager.

It should help manage the whole human, not just one product:

- work reality and energy
- fitness and recovery
- active products like Fence
- future ideas and research
- content and personal brand systems
- personal admin and life upkeep

## Core Model

OpenClaw has three layers:

- Structured tracking lives in SQLite at \`data/openclaw.db\`
- Operational state stays in \`workspace/state/\`
- Durable knowledge lives in \`knowledge/\`

Use the DB for tracked work and history, \`state/\` for the live daily loop, and the knowledge vault for anything worth reading, revisiting, or thinking through.

## What Zoe Should Do Here

- Run the daily manager loop across all life domains
- Capture ideas without immediately turning them into tasks
- Keep durable context for areas, projects, and recurring themes
- Help with content planning and review without risky autoposting
- Preserve continuity across sessions with low admin overhead

## Working Rules

- Tasks belong in the DB when they are truly actionable
- Ideas start in \`workspace/state/ideas.json\` and graduate into \`knowledge/ideas/\` when worth preserving
- Area context belongs in \`knowledge/areas/\`
- Evergreen guidance, playbooks, and content systems belong in \`knowledge/reference/\`
- Projects are important, but they are only one slice of the system

## Current Direction

The migration away from Notion is mostly complete at the infrastructure layer.

The next job is not to add more migration cleanup. It is to broaden the local system so OpenClaw actually behaves like a life manager instead of a Fence support layer with a better backend.

## Key References

- \`workspace/scripts/manager-state.js\`
- \`workspace/scripts/db.js\`
- \`workspace/MEMORY.md\`
- \`workspace/SOUL.md\`
- \`.cursor/plans/openclaw_life_manager_reset.plan.md\`
`;
}

function readNotionApiKey() {
  const envCandidates = ['NOTION_API_KEY', 'LIFEOS_NOTION_API_KEY', 'OPENCLAW_NOTION_API_KEY'];
  for (const name of envCandidates) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }

  const fileCandidates = [
    process.env.NOTION_API_KEY_FILE,
    path.join(os.homedir(), '.config', 'notion', 'api_key'),
  ].filter(Boolean);

  for (const filePath of fileCandidates) {
    if (!fs.existsSync(filePath)) continue;
    const value = fs.readFileSync(filePath, 'utf8').trim();
    if (value) return value;
  }

  throw new Error(
    'Notion API key not found. Set NOTION_API_KEY (or LIFEOS_NOTION_API_KEY / OPENCLAW_NOTION_API_KEY) or NOTION_API_KEY_FILE.'
  );
}

const NOTION_KEY = readNotionApiKey();

async function notionRequest(endpoint, method = 'GET', body = undefined, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${NOTION_KEY}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = json?.message || text || `HTTP ${response.status}`;
      throw new Error(`Notion API ${method} ${endpoint} failed: ${message}`);
    }

    return json;
  } catch (error) {
    if (error?.name === 'AbortError' && attempt < 3) {
      return notionRequest(endpoint, method, body, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function queryAllDataSource(dataSourceId, payload = {}) {
  const results = [];
  let cursor = null;

  do {
    const page = await notionRequest(`/data_sources/${dataSourceId}/query`, 'POST', {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      ...payload,
    });
    results.push(...(page.results || []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

  return results;
}

function titleText(property) {
  return (property?.title || []).map((item) => item.plain_text).join('');
}

function richText(property) {
  return (property?.rich_text || []).map((item) => item.plain_text).join('');
}

function normalizeLifeOSTaskPage(page) {
  return {
    pageId: page.id,
    url: page.url,
    title: titleText(page?.properties?.Name),
    externalId: richText(page?.properties?.['External ID']) || null,
    status: page?.properties?.Status?.select?.name || '',
    priority: page?.properties?.Priority?.select?.name || '',
    area: page?.properties?.Area?.select?.name || '',
    executor: page?.properties?.Executor?.select?.name || '',
    dueDate: page?.properties?.['Due Date']?.date?.start || '',
    source: richText(page?.properties?.Source) || '',
  };
}

async function loadLifeOSTasks() {
  const pages = await queryAllDataSource(LIFEOS_TASKS_DATA_SOURCE_ID);
  return pages.map(normalizeLifeOSTaskPage).filter((task) => task.title);
}

function loadFenceOpenTasks() {
  if (!fs.existsSync(ARCHIVED_NOTION_SYNC)) {
    throw new Error('Archived Notion sync helper is missing at archive/scripts/notion-sync.js.');
  }

  const run = spawnSync(process.execPath, [ARCHIVED_NOTION_SYNC, 'open-tasks', '--json'], {
    cwd: WORKSPACE,
    encoding: 'utf8',
    env: process.env,
    timeout: 120000,
  });

  if (run.error) {
    throw new Error(run.error.message || String(run.error));
  }
  if (run.status !== 0) {
    throw new Error((run.stderr || run.stdout || `exit ${run.status}`).trim());
  }

  const parsed = JSON.parse((run.stdout || '').trim() || '{}');
  return Array.isArray(parsed.tasks) ? parsed.tasks : [];
}

function mapProjectId(task) {
  const area = String(task.area || '').toLowerCase();
  const source = String(task.source || '').toLowerCase();
  const title = String(task.title || '').toLowerCase();

  if (
    ['product', 'marketing', 'landing page'].includes(area) ||
    /fence|waitlist|testflight|landing page|app store|twitter|reddit/.test(source) ||
    /fence|waitlist|testflight|app store|launch/.test(title)
  ) {
    return 'project:fence';
  }

  if (/zoe|openclaw|manager/.test(source) || /zoe|openclaw|manager/.test(title)) {
    return 'project:openclaw';
  }

  return null;
}

function mapTask(task, overrides = {}) {
  const id = overrides.id || task.externalId || task.pageId;
  if (!id) {
    throw new Error(`Could not determine task id for "${task.title || '(untitled)'}".`);
  }

  return {
    id,
    title: overrides.title || task.title || '(untitled task)',
    status: overrides.status || task.status || 'Todo',
    priority: overrides.priority || task.priority || 'P1',
    area: overrides.area === undefined ? task.area || null : overrides.area,
    projectId: overrides.projectId === undefined ? mapProjectId(task) : overrides.projectId,
    dueDate: overrides.dueDate === undefined ? task.dueDate || null : overrides.dueDate,
    sourceRef: overrides.sourceRef === undefined ? task.source || task.url || null : overrides.sourceRef,
    notes: overrides.notes || null,
    metadata: {
      notionPageId: task.pageId || null,
      notionUrl: task.url || null,
      externalId: task.externalId || null,
      executor: task.executor || null,
      legacyArea: task.area || null,
      migrationSource: overrides.migrationSource || 'archive/scripts/notion-sync.js open-tasks',
      migratedAt: db.nowIso(),
      ...(overrides.metadata || {}),
    },
  };
}

function normalizeLifeOSTaskArea(task) {
  const area = String(task.area || '').trim();
  const haystack = `${task.title || ''} ${task.source || ''}`.toLowerCase();

  if (area === 'Research') return 'Learning';
  if (area === 'Personal') return 'Personal';
  if (
    area === 'Ops' &&
    /(linkedin|reddit|twitter|thread|content|guide|shortcuts|finance automations|build-in-public|build in public)/.test(
      haystack
    )
  ) {
    return 'Marketing';
  }

  return area || null;
}

function cleanLegacyIdeaTitle(title) {
  return String(title || '')
    .replace(/^[\s\-*]+/, '')
    .replace(/\.\.\.+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function pickIdeaNotePath(task, usedPaths) {
  const cleanTitle = cleanLegacyIdeaTitle(task.title) || `idea-${task.pageId}`;
  const baseSlug = slugify(cleanTitle) || `idea-${String(task.pageId || '').replace(/-/g, '').slice(0, 8)}`;
  const stableSuffix = String(task.pageId || '').replace(/-/g, '').slice(0, 8);

  let relativePath = path.join('knowledge', 'ideas', `${baseSlug}.md`);
  let absolutePath = path.join(OPENCLAW_HOME, relativePath);
  if (!usedPaths.has(relativePath)) {
    usedPaths.add(relativePath);
    return absolutePath;
  }

  relativePath = path.join('knowledge', 'ideas', `${baseSlug}-${stableSuffix}.md`);
  absolutePath = path.join(OPENCLAW_HOME, relativePath);
  usedPaths.add(relativePath);
  return absolutePath;
}

function buildLifeOSIdeaNote(task) {
  const cleanTitle = cleanLegacyIdeaTitle(task.title) || 'Untitled legacy idea';
  const capturedOn = task.dueDate || managerState.currentLocalDate();
  const sourceLine = task.source ? `- Legacy source: ${task.source}\n` : '';

  return `# Idea: ${cleanTitle}

## Problem or itch

Imported from the legacy Notion \`LifeOS Tasks\` database. This item was previously stored as an \`Ideas\` task, but it reads more like an incubating concept than an actionable task.

## Why it might matter

- Preserves an older idea without keeping it in the live task queue
- Keeps the "ideas are not obligations" rule intact
- Makes the concept readable and searchable in the local knowledge vault

## Signals or evidence

- Original captured title: ${task.title || '(untitled)'}
- Imported from Notion on ${managerState.currentLocalDate()}
- Legacy status: ${task.status || 'Todo'}
- Legacy priority: ${task.priority || 'P1'}
- Legacy executor: ${task.executor || 'Nishchay'}
${sourceLine}- Notion page: ${task.url || '(missing url)'}
- Original capture date: ${capturedOn}

## What would make this worth pursuing?

- Clarify the real user problem and wedge
- Define a believable first version or research direction
- Decide whether this should stay parked, become research, or become a real task

## Next move

- Keep parked
- Research
- Promote to task

## Source

Migrated from legacy Notion \`LifeOS Tasks\` with \`Area = Ideas\`.
`;
}

function seedProjects() {
  return PROJECT_SEEDS.map((project) => db.upsertProject(project));
}

function migrateKnowledge() {
  const summary = {
    created: [],
    unchanged: [],
    conflicts: [],
  };

  copyFileSafely(
    path.join(WORKSPACE, 'memory', 'project-fence.md'),
    path.join(KNOWLEDGE_ROOT, 'projects', 'fence', 'overview.md'),
    summary
  );
  copyFileSafely(
    path.join(WORKSPACE, 'memory', 'project-fence-marketing.md'),
    path.join(KNOWLEDGE_ROOT, 'projects', 'fence', 'marketing', 'overview.md'),
    summary
  );
  copyDirectorySafely(
    path.join(WORKSPACE, 'fence-marketing'),
    path.join(KNOWLEDGE_ROOT, 'projects', 'fence', 'marketing'),
    summary
  );
  writeFileSafely(
    path.join(KNOWLEDGE_ROOT, 'projects', 'openclaw', 'overview.md'),
    buildOpenclawOverview(),
    summary
  );

  return summary;
}

function upsertMappedTasks(tasks) {
  const summary = {
    created: 0,
    updated: 0,
  };

  for (const task of tasks) {
    const existing = db.getTask(task.id);
    db.upsertTask(task);
    if (existing) summary.updated += 1;
    else summary.created += 1;
  }

  return summary;
}

function migrateLifeOSTasks(lifeOSTasks) {
  const taskPayloads = [];
  const ideaSummary = {
    created: [],
    unchanged: [],
    conflicts: [],
  };
  const usedIdeaPaths = new Set();

  ensureDir(IDEAS_ROOT);

  for (const task of lifeOSTasks) {
    if (task.area === 'Ideas') {
      const notePath = pickIdeaNotePath(task, usedIdeaPaths);
      writeFileSafely(notePath, buildLifeOSIdeaNote(task), ideaSummary);
      continue;
    }

    taskPayloads.push(
      mapTask(task, {
        area: normalizeLifeOSTaskArea(task),
        projectId: null,
        migrationSource: 'direct Notion LifeOS Tasks import',
        metadata: {
          notionDataSourceId: LIFEOS_TASKS_DATA_SOURCE_ID,
          migratedBucket: 'task',
        },
      })
    );
  }

  return {
    queried: lifeOSTasks.length,
    tasks: upsertMappedTasks(taskPayloads),
    ideas: {
      seeded: lifeOSTasks.filter((task) => task.area === 'Ideas').length,
      files: ideaSummary,
    },
  };
}

async function runMigration() {
  const foundation = bootstrapLocalFoundation();
  const fenceTasks = loadFenceOpenTasks();
  const lifeOSTasks = await loadLifeOSTasks();
  const projects = seedProjects();
  const fenceSummary = upsertMappedTasks(
    fenceTasks.map((task) =>
      mapTask(task, {
        migrationSource: 'archive/scripts/notion-sync.js open-tasks',
      })
    )
  );
  const lifeOSSummary = migrateLifeOSTasks(lifeOSTasks);
  const knowledgeSummary = migrateKnowledge();
  const dbSummary = db.getStatusSummary();
  db.closeDb();

  return {
    fenceOpenTasks: fenceTasks.length,
    lifeOSTasksQueried: lifeOSTasks.length,
    foundation: {
      knowledgeRoot: relativeToOpenclaw(foundation.knowledgeRoot),
      createdDirectories: foundation.createdDirectories,
      createdFiles: foundation.createdFiles,
    },
    projects: projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      name: project.name,
      knowledgePath: project.knowledgePath,
    })),
    tasks: {
      fence: fenceSummary,
      lifeOS: lifeOSSummary.tasks,
    },
    ideas: lifeOSSummary.ideas,
    knowledge: knowledgeSummary,
    db: dbSummary.tables,
  };
}

async function main() {
  const result = await runMigration();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
