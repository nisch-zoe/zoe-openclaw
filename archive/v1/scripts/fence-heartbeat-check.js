#!/usr/bin/env node

/**
 * Fence heartbeat checks (low-token summaries)
 *
 * Modes:
 *   node scripts/fence-heartbeat-check.js github
 *   node scripts/fence-heartbeat-check.js local
 *   node scripts/fence-heartbeat-check.js notion      # historical fallback only
 *   node scripts/fence-heartbeat-check.js all
 *   node scripts/fence-heartbeat-check.js heartbeat   # prints HEARTBEAT_OK when no updates
 *
 * Optional flags:
 *   --state <path>              (default: memory/heartbeat/fence-state.json)
 *   --repos <owner/repo,...>    (default: fence repos)
 *   --json                      (machine-readable output)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('./db');

const WORKSPACE = path.resolve(__dirname, '..');
const DEFAULT_STATE_PATH = path.join(WORKSPACE, 'memory', 'heartbeat', 'fence-state.json');
const DEFAULT_REPOS = [
  'nisch-zoe/fence-marketing',
  'nishchay-v/expense-tracker-ios',
  'nishchay-v/expense-tracker-landing',
];
const LEGACY_NOTION_TASKS_DB = '8c15f0cf-532b-485d-b5a7-07f312dd4dc7';
const MAX_SEEN = 500;
const DEFAULT_GH_TIMEOUT_MS = Number(process.env.FENCE_GH_TIMEOUT_MS || 15000);
const HEARTBEAT_GH_TIMEOUT_MS = Number(process.env.FENCE_GH_HEARTBEAT_TIMEOUT_MS || 15000);
const FAIL_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(t);
    }
  }
  return out;
}

function resolvePath(p) {
  if (!p) return DEFAULT_STATE_PATH;
  return path.isAbsolute(p) ? p : path.join(WORKSPACE, p);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadState(filePath) {
  const base = {
    version: 1,
    github: {
      lastCheckedAt: null,
      seenIssueKeys: [],
      seenPrKeys: [],
      seenMentionKeys: [],
      seenCiKeys: [],
    },
    local: {
      lastCheckedAt: null,
      seenDueKeys: [],
      seenChangeKeys: [],
    },
    notion: {
      lastCheckedAt: null,
      seenDueKeys: [],
      seenChangeKeys: [],
    },
  };

  if (!fs.existsSync(filePath)) return base;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const migratedLocal = raw.local || {
      lastCheckedAt: raw?.notion?.lastCheckedAt || null,
      seenDueKeys: [],
      seenChangeKeys: [],
    };
    return {
      ...base,
      ...raw,
      github: { ...base.github, ...(raw.github || {}) },
      local: { ...base.local, ...migratedLocal },
      notion: { ...base.notion, ...(raw.notion || {}) },
    };
  } catch {
    return base;
  }
}

function saveState(filePath, state) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function addSeen(existing, newKeys, max = MAX_SEEN) {
  const set = new Set(existing);
  for (const k of newKeys) set.add(k);
  const arr = Array.from(set);
  if (arr.length <= max) return arr;
  return arr.slice(arr.length - max);
}

function runJson(bin, args, { timeoutMs = DEFAULT_GH_TIMEOUT_MS } = {}) {
  const p = spawnSync(bin, args, {
    cwd: WORKSPACE,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: process.env.GH_PROMPT_DISABLED || '1',
      GH_NO_UPDATE_NOTIFIER: process.env.GH_NO_UPDATE_NOTIFIER || '1',
    },
    timeout: timeoutMs,
  });

  if (p.error) {
    const err = new Error(p.error.message || String(p.error));
    err.code = p.error.code;
    throw err;
  }
  if (p.status !== 0) {
    const msg = (p.stderr || p.stdout || `exit ${p.status}`).trim();
    throw new Error(msg);
  }

  const text = (p.stdout || '').trim();
  if (!text) return null;
  return JSON.parse(text);
}

function ghApi(endpoint, { timeoutMs = DEFAULT_GH_TIMEOUT_MS } = {}) {
  const args = ['api', endpoint, '-H', 'Accept: application/vnd.github+json'];
  try {
    return runJson('gh', args, { timeoutMs });
  } catch (error) {
    if (error?.code === 'ENOENT' && fs.existsSync('/snap/bin/gh')) {
      return runJson('/snap/bin/gh', args, { timeoutMs });
    }
    throw error;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function isoHoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function shortList(items, max = 2) {
  const names = items.slice(0, max);
  if (items.length <= max) return names.join(', ');
  return `${names.join(', ')} +${items.length - max}`;
}

function repoFromApiUrl(url) {
  if (!url) return null;
  const parts = String(url).split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function localTaskTitle(task) {
  return task?.title || '(untitled task)';
}

async function checkGithub({ state, repos, includeCi = true, ghTimeoutMs = DEFAULT_GH_TIMEOUT_MS }) {
  const since = state.github.lastCheckedAt || isoHoursAgo(24);
  const repoSet = new Set(repos);

  const updates = {
    since,
    issues: [],
    prs: [],
    ciFailures: [],
    mentions: [],
  };

  const repoQualifier = repos.map((r) => `repo:${r}`).join(' ');

  const issueSearch = ghApi(
    `/search/issues?q=${encodeURIComponent(`${repoQualifier} is:issue created:>=${since}`)}&per_page=100`,
    { timeoutMs: ghTimeoutMs }
  );
  for (const item of issueSearch?.items || []) {
    const repo = repoFromApiUrl(item?.repository_url);
    if (!repo || !repoSet.has(repo)) continue;
    if (!item?.created_at || item.created_at < since) continue;
    const key = `${repo}#${item.number}`;
    if (state.github.seenIssueKeys.includes(key)) continue;
    updates.issues.push({ repo, number: item.number, title: item.title || '' });
  }

  const prSearch = ghApi(
    `/search/issues?q=${encodeURIComponent(`${repoQualifier} is:pr created:>=${since}`)}&per_page=100`,
    { timeoutMs: ghTimeoutMs }
  );
  for (const item of prSearch?.items || []) {
    const repo = repoFromApiUrl(item?.repository_url);
    if (!repo || !repoSet.has(repo)) continue;
    if (!item?.created_at || item.created_at < since) continue;
    const key = `${repo}#${item.number}`;
    if (state.github.seenPrKeys.includes(key)) continue;
    updates.prs.push({ repo, number: item.number, title: item.title || '' });
  }

  if (includeCi) {
    for (const repo of repos) {
      const runs = ghApi(`/repos/${repo}/actions/runs?per_page=20`, { timeoutMs: ghTimeoutMs });
      for (const run of runs?.workflow_runs || []) {
        if (!run?.updated_at || run.updated_at < since) continue;
        if (!FAIL_CONCLUSIONS.has(run.conclusion)) continue;
        const key = `${repo}:${run.id}:${run.conclusion}:${run.updated_at}`;
        if (state.github.seenCiKeys.includes(key)) continue;
        updates.ciFailures.push({
          key,
          repo,
          id: run.id,
          name: run.name || 'workflow',
          conclusion: run.conclusion,
        });
      }
    }
  }

  const notifications = ghApi(
    `/notifications?all=false&participating=false&since=${encodeURIComponent(since)}&per_page=100`,
    { timeoutMs: ghTimeoutMs }
  );
  for (const n of notifications || []) {
    const reason = n?.reason || '';
    const repo = n?.repository?.full_name;
    if (!repo || !repoSet.has(repo)) continue;
    if (!['mention', 'team_mention'].includes(reason)) continue;

    const key = `${n.id || n.subject?.url || 'n'}:${n.updated_at || ''}`;
    if (state.github.seenMentionKeys.includes(key)) continue;

    updates.mentions.push({
      key,
      repo,
      reason,
      subject: n?.subject?.title || n?.subject?.type || 'mention',
    });
  }

  // Persist state changes.
  state.github.lastCheckedAt = isoNow();
  state.github.seenIssueKeys = addSeen(
    state.github.seenIssueKeys,
    updates.issues.map((x) => `${x.repo}#${x.number}`)
  );
  state.github.seenPrKeys = addSeen(
    state.github.seenPrKeys,
    updates.prs.map((x) => `${x.repo}#${x.number}`)
  );
  state.github.seenCiKeys = addSeen(
    state.github.seenCiKeys,
    updates.ciFailures.map((x) => x.key)
  );
  state.github.seenMentionKeys = addSeen(
    state.github.seenMentionKeys,
    updates.mentions.map((x) => x.key)
  );

  const issueCount = updates.issues.length;
  const prCount = updates.prs.length;
  const ciCount = updates.ciFailures.length;
  const mentionCount = updates.mentions.length;

  let summary = 'GH: no new issues/PRs, CI failures, or mentions.';
  if (issueCount || prCount || ciCount || mentionCount) {
    const parts = [`issues +${issueCount}`, `PRs +${prCount}`, `CI fail ${ciCount}`, `mentions ${mentionCount}`];
    const snippets = [];
    if (updates.prs.length) snippets.push(`PR ${shortList(updates.prs.map((x) => `${x.repo.split('/')[1]}#${x.number}`))}`);
    if (updates.ciFailures.length) snippets.push(`CI ${shortList(updates.ciFailures.map((x) => `${x.repo.split('/')[1]}:${x.name}`))}`);
    summary = `GH: ${parts.join(', ')}${snippets.length ? ` (${snippets.join('; ')})` : ''}`;
  }

  return {
    source: 'github',
    since,
    hasUpdates: Boolean(issueCount || prCount || ciCount || mentionCount),
    counts: { issues: issueCount, prs: prCount, ciFailures: ciCount, mentions: mentionCount },
    summary,
  };
}

async function checkLocal({ state }) {
  const since = state.local.lastCheckedAt || isoHoursAgo(24);
  const today = new Date().toISOString().slice(0, 10);

  try {
    const openTasks = db.listOpenTasks();
    const dueToday = openTasks.filter((task) => task.dueDate === today);
    const changed = openTasks.filter((task) => task.updatedAt && task.updatedAt >= since);

    const newDue = [];
    const newChanged = [];

    for (const task of dueToday) {
      const dueKey = `${today}:${task.id}:${task.status}:${task.updatedAt || ''}`;
      if (state.local.seenDueKeys.includes(dueKey)) continue;
      newDue.push(task);
    }

    for (const task of changed) {
      const changeKey = `${task.id}:${task.updatedAt || ''}:${task.status}`;
      if (state.local.seenChangeKeys.includes(changeKey)) continue;
      newChanged.push(task);
    }

    state.local.lastCheckedAt = isoNow();
    state.local.seenDueKeys = addSeen(
      state.local.seenDueKeys,
      newDue.map((task) => `${today}:${task.id}:${task.status}:${task.updatedAt || ''}`)
    );
    state.local.seenChangeKeys = addSeen(
      state.local.seenChangeKeys,
      newChanged.map((task) => `${task.id}:${task.updatedAt || ''}:${task.status}`)
    );

    const dueCount = newDue.length;
    const changedCount = newChanged.length;

    let summary = 'Local DB: no new due-today or changed tasks.';
    if (dueCount || changedCount) {
      const parts = [`due +${dueCount}`, `changed +${changedCount}`];
      const snippets = [];
      if (dueCount) snippets.push(`due: ${shortList(newDue.map((task) => localTaskTitle(task)), 2)}`);
      if (changedCount) {
        snippets.push(`changed: ${shortList(newChanged.map((task) => localTaskTitle(task)), 2)}`);
      }
      summary = `Local DB: ${parts.join(', ')}${snippets.length ? ` (${snippets.join('; ')})` : ''}`;
    }

    return {
      source: 'local',
      since,
      hasUpdates: Boolean(dueCount || changedCount),
      counts: { dueToday: dueCount, changed: changedCount },
      summary,
    };
  } finally {
    db.closeDb();
  }
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

  for (const file of fileCandidates) {
    if (!fs.existsSync(file)) continue;
    const key = fs.readFileSync(file, 'utf8').trim();
    if (key) return key;
  }

  throw new Error(
    'Notion API key not found. Set NOTION_API_KEY (or LIFEOS_NOTION_API_KEY / OPENCLAW_NOTION_API_KEY) or NOTION_API_KEY_FILE.'
  );
}

function notionTitle(page) {
  const t = page?.properties?.Name?.title || [];
  return t.map((x) => x.plain_text).join('').trim() || '(untitled task)';
}

function notionStatus(page) {
  return page?.properties?.Status?.select?.name || '';
}

function notionDue(page) {
  return page?.properties?.['Due Date']?.date?.start || '';
}

async function notionRequest(key, endpoint, body, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error(`Notion API ${endpoint} failed: ${json?.message || text || `HTTP ${res.status}`}`);
    }
    return json;
  } catch (error) {
    if (error?.name === 'AbortError' && attempt < 3) {
      return notionRequest(key, endpoint, body, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function notionQueryAll(key, dbId, payload) {
  const out = [];
  let cursor = undefined;
  do {
    const page = await notionRequest(key, `/databases/${dbId}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      ...payload,
    });
    out.push(...(page.results || []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return out;
}

async function checkNotion({ state }) {
  const since = state.notion.lastCheckedAt || isoHoursAgo(24);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const key = readNotionApiKey();
  const dbId =
    process.env.FENCE_NOTION_TASKS_DB_ID ||
    process.env.LIFEOS_NOTION_TASKS_DB_ID ||
    process.env.NOTION_TASKS_DB_ID ||
    LEGACY_NOTION_TASKS_DB;

  const dueToday = await notionQueryAll(key, dbId, {
    filter: {
      and: [
        { property: 'Due Date', date: { equals: today } },
        { property: 'Status', select: { does_not_equal: 'Done' } },
      ],
    },
    sorts: [{ property: 'Priority', direction: 'ascending' }],
  });

  const changed = await notionQueryAll(key, dbId, {
    filter: {
      timestamp: 'last_edited_time',
      last_edited_time: { on_or_after: since },
    },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
  });

  const newDue = [];
  const newChanged = [];

  for (const page of dueToday) {
    const dueKey = `${today}:${page.id}:${notionStatus(page)}:${page.last_edited_time || ''}`;
    if (state.notion.seenDueKeys.includes(dueKey)) continue;
    newDue.push(page);
  }

  for (const page of changed) {
    const changeKey = `${page.id}:${page.last_edited_time || ''}`;
    if (state.notion.seenChangeKeys.includes(changeKey)) continue;
    newChanged.push(page);
  }

  state.notion.lastCheckedAt = isoNow();
  state.notion.seenDueKeys = addSeen(
    state.notion.seenDueKeys,
    newDue.map((p) => `${today}:${p.id}:${notionStatus(p)}:${p.last_edited_time || ''}`)
  );
  state.notion.seenChangeKeys = addSeen(
    state.notion.seenChangeKeys,
    newChanged.map((p) => `${p.id}:${p.last_edited_time || ''}`)
  );

  const dueCount = newDue.length;
  const changedCount = newChanged.length;

  let summary = 'Notion: no new due-today or changed tasks.';
  if (dueCount || changedCount) {
    const parts = [`due +${dueCount}`, `changed +${changedCount}`];
    const snippets = [];
    if (dueCount) snippets.push(`due: ${shortList(newDue.map((p) => notionTitle(p)), 2)}`);
    if (changedCount) snippets.push(`changed: ${shortList(newChanged.map((p) => notionTitle(p)), 2)}`);
    summary = `Notion: ${parts.join(', ')}${snippets.length ? ` (${snippets.join('; ')})` : ''}`;
  }

  return {
    source: 'notion',
    since,
    hasUpdates: Boolean(dueCount || changedCount),
    counts: { dueToday: dueCount, changed: changedCount },
    summary,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0] || 'all';
  const statePath = resolvePath(args.state);
  const repos = String(args.repos || process.env.FENCE_GH_REPOS || DEFAULT_REPOS.join(','))
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const state = loadState(statePath);
  const out = { mode, statePath };

  if (mode === 'github' || mode === 'all' || mode === 'heartbeat') {
    const isHeartbeat = mode === 'heartbeat';
    try {
      out.github = await checkGithub({
        state,
        repos,
        includeCi: !isHeartbeat,
        ghTimeoutMs: isHeartbeat ? HEARTBEAT_GH_TIMEOUT_MS : DEFAULT_GH_TIMEOUT_MS,
      });
    } catch (error) {
      const msg = error?.message || String(error);
      const isTimeout = /ETIMEDOUT/i.test(msg) || error?.code === 'ETIMEDOUT';
      out.github = {
        source: 'github',
        // In heartbeat mode, treat transient GH timeouts as "no update" to avoid Telegram spam.
        // Next heartbeat will retry.
        hasUpdates: isHeartbeat ? !isTimeout : true,
        error: msg,
        summary: isHeartbeat && isTimeout ? `GH: timeout (will retry).` : `GH error: ${msg}`,
      };
    }
  }

  if (mode === 'local' || mode === 'all' || mode === 'heartbeat') {
    try {
      out.local = await checkLocal({ state });
    } catch (error) {
      const msg = error?.message || String(error);
      out.local = {
        source: 'local',
        hasUpdates: true,
        error: msg,
        summary: `Local DB error: ${msg}`,
      };
    }
  }

  if (mode === 'notion') {
    try {
      out.notion = await checkNotion({ state });
    } catch (error) {
      out.notion = {
        source: 'notion',
        hasUpdates: true,
        error: error.message || String(error),
        summary: `Notion error: ${error.message || error}`,
      };
    }
  }

  saveState(statePath, state);

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (mode === 'github') {
    console.log(out.github.summary);
    return;
  }

  if (mode === 'local') {
    console.log(out.local.summary);
    return;
  }

  if (mode === 'notion') {
    console.log(out.notion.summary);
    return;
  }

  if (mode === 'heartbeat') {
    const lines = [];
    if (out.github?.hasUpdates) lines.push(out.github.summary);
    if (out.local?.hasUpdates) lines.push(out.local.summary);
    if (!lines.length) {
      console.log('HEARTBEAT_OK');
    } else {
      console.log(lines.join('\n'));
    }
    return;
  }

  console.log(out.github.summary);
  console.log(out.local.summary);
}

main();
