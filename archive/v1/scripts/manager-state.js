#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const WORKSPACE = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.resolve(WORKSPACE, '..');
const STATE_DIR = path.join(WORKSPACE, 'state');
const DASHBOARD_PATH = path.join(STATE_DIR, 'dashboard.json');
const IDEAS_PATH = path.join(STATE_DIR, 'ideas.json');
const ARCHIVE_PATH = path.join(STATE_DIR, 'archive.json');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const MAIN_SESSIONS_DIR = path.join(OPENCLAW_HOME, 'agents', 'main', 'sessions');
const TIME_ZONE = 'Asia/Calcutta';
const MAX_RECENT_DAYS = 45;
const MAX_SEEN_MESSAGE_IDS = 4000;

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'for',
  'from',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'me',
  'my',
  'of',
  'on',
  'or',
  'so',
  'the',
  'this',
  'to',
  'up',
  'we',
  'with',
  'you',
  'your',
]);

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return clone(fallback);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return clone(fallback);
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function zonedParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function currentLocalDate() {
  const parts = zonedParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localDateFromIso(iso) {
  return currentLocalDateFromDate(new Date(iso));
}

function currentLocalDateFromDate(date) {
  const parts = zonedParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTimeFromIso(iso) {
  const parts = zonedParts(new Date(iso));
  return `${parts.hour}:${parts.minute}`;
}

function localWeekdayFromIso(iso) {
  return zonedParts(new Date(iso)).weekday;
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(dateStr, delta) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function compareDates(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function defaultDashboard() {
  return {
    version: 1,
    timezone: TIME_ZONE,
    lastUpdated: null,
    profile: {
      job: {
        description: 'Full-time software engineer',
        notes: 'Weekday work commitments can compress side-project energy.',
        calendarSynced: false,
      },
      fitness: {
        modes: ['gym', 'swimming'],
        importance: 'non-negotiable anchor',
        weeklyTargetSessions: 4,
        lastMentionedAt: null,
      },
      communication: {
        primaryChannel: 'telegram',
        notionFriction: 'high on phone',
        style: 'short, direct, adaptive',
        ideaCapture: 'freeform conversation',
      },
    },
    life: {
      areas: ['work', 'product', 'marketing', 'fitness', 'personal', 'learning'],
      activeGoals: [
        {
          id: 'launch-fence',
          area: 'product',
          goal: 'Launch Fence only after demand confidence exists',
          horizon: 'Q2 2026',
          status: 'active',
          blockerNote: 'Balance product quality with demand validation and marketing.',
        },
        {
          id: 'fitness-consistency',
          area: 'fitness',
          goal: 'Keep gym and swimming consistent even during heavy work weeks',
          horizon: 'ongoing',
          status: 'active',
          blockerNote: '',
        },
        {
          id: 'sustainable-balance',
          area: 'work',
          goal: 'Protect job performance while building personal products',
          horizon: 'ongoing',
          status: 'active',
          blockerNote: '',
        },
      ],
      anchorPoints: [
        'Protect job energy first.',
        'Keep fitness alive every week.',
        'Move Fence toward real demand and launch confidence.',
        'Capture ideas without turning all of them into chores.',
      ],
      currentFocusNote:
        'Stay flexible. Adapt the day to work load, sleep, and recovery instead of forcing a rigid plan.',
      lastStrategyUpdate: null,
    },
    context: {
      updatedAt: null,
      workLoad: null,
      sleepQuality: null,
      energyLevel: null,
      mood: null,
      fitnessIntent: null,
      fitnessDone: [],
      notes: [],
    },
    today: {
      date: currentLocalDate(),
      morningBriefSentAt: null,
      eveningPromptSentAt: null,
      adjustmentReason: null,
      priorities: [],
      completed: [],
      carriedOver: [],
      notes: [],
    },
    momentum: {
      streakDays: 0,
      weeklyCompletionRate: 0,
      areaBalance: {},
      recentDays: [],
    },
    tasksMeta: {},
    archive: {
      lastSignalSyncAt: null,
      lastHumanMessageAt: null,
    },
    pendingQuestions: ['Heavy work day or lighter?', 'Gym or swim today?'],
    calendar: {
      synced: false,
      busySlots: [],
    },
  };
}

function defaultIdeas() {
  return {
    version: 1,
    lastUpdated: null,
    lastSurfacedAt: null,
    ideas: [],
  };
}

function defaultArchive() {
  return {
    version: 1,
    lastSyncedAt: null,
    seenMessageIds: [],
  };
}

function sanitizeTaskMetaMap(rawTasksMeta = {}) {
  const sanitized = {};
  for (const [taskKey, meta] of Object.entries(rawTasksMeta || {})) {
    if (!meta || typeof meta !== 'object') continue;
    sanitized[taskKey] = {
      pageId: meta.pageId || null,
      externalId: meta.externalId || null,
      title: meta.title || '',
      area: meta.area || null,
      priority: meta.priority || null,
      slipCount: Number.isFinite(meta.slipCount) ? meta.slipCount : 0,
      lastPlannedAt: meta.lastPlannedAt || null,
      lastCompletedAt: meta.lastCompletedAt || null,
      lastRolledDate: meta.lastRolledDate || null,
    };
  }
  return sanitized;
}

function mergeDashboard(raw) {
  const defaults = defaultDashboard();
  const rawArchive = (raw && raw.archive) || {};
  const merged = {
    ...defaults,
    ...(raw || {}),
    profile: {
      ...defaults.profile,
      ...((raw && raw.profile) || {}),
      job: {
        ...defaults.profile.job,
        ...((raw && raw.profile && raw.profile.job) || {}),
      },
      fitness: {
        ...defaults.profile.fitness,
        ...((raw && raw.profile && raw.profile.fitness) || {}),
      },
      communication: {
        ...defaults.profile.communication,
        ...((raw && raw.profile && raw.profile.communication) || {}),
      },
    },
    life: {
      ...defaults.life,
      ...((raw && raw.life) || {}),
      activeGoals: Array.isArray(raw?.life?.activeGoals)
        ? raw.life.activeGoals
        : defaults.life.activeGoals,
      anchorPoints: Array.isArray(raw?.life?.anchorPoints)
        ? raw.life.anchorPoints
        : defaults.life.anchorPoints,
    },
    context: {
      ...defaults.context,
      ...((raw && raw.context) || {}),
      fitnessDone: Array.isArray(raw?.context?.fitnessDone) ? raw.context.fitnessDone : [],
      notes: Array.isArray(raw?.context?.notes) ? raw.context.notes : [],
    },
    today: {
      ...defaults.today,
      ...((raw && raw.today) || {}),
      priorities: Array.isArray(raw?.today?.priorities) ? raw.today.priorities : [],
      completed: Array.isArray(raw?.today?.completed) ? raw.today.completed : [],
      carriedOver: Array.isArray(raw?.today?.carriedOver) ? raw.today.carriedOver : [],
      notes: Array.isArray(raw?.today?.notes) ? raw.today.notes : [],
    },
    momentum: {
      ...defaults.momentum,
      ...((raw && raw.momentum) || {}),
      areaBalance: {
        ...defaults.momentum.areaBalance,
        ...((raw && raw.momentum && raw.momentum.areaBalance) || {}),
      },
      recentDays: Array.isArray(raw?.momentum?.recentDays) ? raw.momentum.recentDays : [],
    },
    tasksMeta: {
      ...defaults.tasksMeta,
      ...sanitizeTaskMetaMap((raw && raw.tasksMeta) || {}),
    },
    archive: {
      ...defaults.archive,
      lastSignalSyncAt: rawArchive.lastSignalSyncAt || null,
      lastHumanMessageAt: rawArchive.lastHumanMessageAt || null,
    },
    pendingQuestions: Array.isArray(raw?.pendingQuestions)
      ? raw.pendingQuestions
      : defaults.pendingQuestions,
    calendar: {
      ...defaults.calendar,
      ...((raw && raw.calendar) || {}),
      busySlots: Array.isArray(raw?.calendar?.busySlots) ? raw.calendar.busySlots : [],
    },
  };

  if (!merged.today.date) merged.today.date = currentLocalDate();
  return merged;
}

function mergeIdeas(raw) {
  const defaults = defaultIdeas();
  return {
    ...defaults,
    ...(raw || {}),
    ideas: Array.isArray(raw?.ideas) ? raw.ideas : [],
  };
}

function mergeArchive(raw) {
  const defaults = defaultArchive();
  return {
    ...defaults,
    lastSyncedAt: raw?.lastSyncedAt || null,
    seenMessageIds: Array.isArray(raw?.seenMessageIds) ? raw.seenMessageIds : [],
  };
}

function ensureStateFiles() {
  ensureDir(STATE_DIR);
  const dashboard = loadDashboard();
  const ideas = loadIdeas();
  const archive = loadArchive();
  saveDashboard(dashboard);
  saveIdeas(ideas);
  saveArchive(archive);
  return { dashboard, ideas, archive };
}

function loadDashboard() {
  return mergeDashboard(readJson(DASHBOARD_PATH, defaultDashboard()));
}

function saveDashboard(dashboard) {
  const merged = mergeDashboard(dashboard);
  merged.lastUpdated = nowIso();
  writeJson(DASHBOARD_PATH, merged);
  return merged;
}

function loadIdeas() {
  return mergeIdeas(readJson(IDEAS_PATH, defaultIdeas()));
}

function saveIdeas(ideas) {
  const merged = mergeIdeas(ideas);
  merged.lastUpdated = nowIso();
  writeJson(IDEAS_PATH, merged);
  return merged;
}

function loadArchive() {
  return mergeArchive(readJson(ARCHIVE_PATH, defaultArchive()));
}

function saveArchive(archive) {
  const merged = mergeArchive(archive);
  writeJson(ARCHIVE_PATH, merged);
  return merged;
}

function ensureRecentDay(dashboard, date) {
  let day = dashboard.momentum.recentDays.find((entry) => entry.date === date);
  if (!day) {
    day = {
      date,
      completedCount: 0,
      completedTaskKeys: [],
      touchedAreas: [],
      fitnessSessions: [],
      workLoad: null,
      sleepQuality: null,
      energyLevel: null,
      notes: [],
      plannedCount: 0,
    };
    dashboard.momentum.recentDays.push(day);
    dashboard.momentum.recentDays.sort((a, b) => compareDates(a.date, b.date));
    if (dashboard.momentum.recentDays.length > MAX_RECENT_DAYS) {
      dashboard.momentum.recentDays = dashboard.momentum.recentDays.slice(-MAX_RECENT_DAYS);
    }
  }
  return day;
}

function trackArea(day, area) {
  if (!area) return;
  if (!day.touchedAreas.includes(area)) day.touchedAreas.push(area);
}

function updateAreaBalance(dashboard) {
  const balance = {};
  for (const day of dashboard.momentum.recentDays.slice(-7)) {
    for (const area of day.touchedAreas || []) {
      balance[area] = (balance[area] || 0) + 1;
    }
  }
  dashboard.momentum.areaBalance = balance;
}

function rolloverDashboardIfNeeded(dashboard, targetDate = currentLocalDate()) {
  if (!dashboard.today.date || dashboard.today.date === targetDate) {
    dashboard.today.date = targetDate;
    return { rolled: false, carriedOver: 0 };
  }

  const previousDate = dashboard.today.date;
  const previousDay = ensureRecentDay(dashboard, previousDate);
  previousDay.plannedCount = dashboard.today.priorities.length;
  previousDay.completedCount = dashboard.today.completed.length;
  for (const completed of dashboard.today.completed) {
    if (completed.taskKey && !previousDay.completedTaskKeys.includes(completed.taskKey)) {
      previousDay.completedTaskKeys.push(completed.taskKey);
    }
    trackArea(previousDay, completed.area);
  }
  for (const priority of dashboard.today.priorities) {
    trackArea(previousDay, priority.area);
  }
  previousDay.workLoad = dashboard.context.workLoad;
  previousDay.sleepQuality = dashboard.context.sleepQuality;
  previousDay.energyLevel = dashboard.context.energyLevel;
  previousDay.fitnessSessions = Array.from(new Set(dashboard.context.fitnessDone || []));

  if (previousDay.completedCount > 0) {
    dashboard.momentum.streakDays += 1;
  } else {
    dashboard.momentum.streakDays = 0;
  }

  const carriedOver = (dashboard.today.priorities || [])
    .filter((priority) => priority.status !== 'done')
    .map((priority) => ({
      taskKey: priority.taskKey,
      pageId: priority.pageId || null,
      externalId: priority.externalId || null,
      title: priority.title,
      area: priority.area || null,
      priority: priority.priority || null,
      dueDate: priority.dueDate || null,
      slipCount: priority.slipCount || 0,
    }));

  dashboard.today = {
    date: targetDate,
    morningBriefSentAt: null,
    eveningPromptSentAt: null,
    adjustmentReason: null,
    priorities: [],
    completed: [],
    carriedOver,
    notes: [],
  };

  updateAreaBalance(dashboard);
  return { rolled: true, carriedOver: carriedOver.length };
}

function contentToText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text' && typeof part.text === 'string') return part.text;
      if (part?.type === 'text' && typeof part.text?.content === 'string') return part.text.content;
      if (typeof part?.text === 'string') return part.text;
      return '';
    })
    .join('');
}

function stripLeadingSystemLines(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  while (lines.length) {
    const line = lines[0].trim();
    if (!line || line.startsWith('System: ')) {
      lines.shift();
      continue;
    }
    break;
  }
  return lines.join('\n').trim();
}

function extractHumanBody(rawText) {
  let text = String(rawText || '').replace(/\r/g, '').trim();
  text = stripLeadingSystemLines(text);
  let changed = true;
  while (changed) {
    changed = false;
    const next = text
      .replace(/^Conversation info \(untrusted metadata\):\n```json[\s\S]*?```\n\n?/, '')
      .replace(/^Sender \(untrusted metadata\):\n```json[\s\S]*?```\n\n?/, '');
    if (next !== text) {
      text = next;
      changed = true;
    }
  }
  text = stripLeadingSystemLines(text);
  return text.trim();
}

function isSystemPromptMessage(text) {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return true;
  const patterns = [
    /^read heartbeat\.md if it exists/,
    /^you are running a boot check/,
    /^continue where you left off\./,
    /^a new session was started via \/new or \/reset/,
    /^pre-compaction memory flush/,
    /^current time:/,
    /^follow boot\.md instructions exactly/,
    /^reply only: no_reply/,
    /^\[[a-z]{3} .*?\] \[system message\]/,
    /a completed cron job is ready for user delivery/,
    /convert the result above into your normal assistant voice/,
    /summarize this naturally for the user/,
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function inferArea(text) {
  const low = String(text || '').toLowerCase();
  if (/(gym|swim|swimming|workout|fitness|exercise|lift|cardio)/.test(low)) return 'fitness';
  if (/(meeting|calendar|office|day job|work commitments|workload|busy at work|rough day at work)/.test(low)) {
    return 'work';
  }
  if (/(marketing|waitlist|signup|reddit|twitter|x post|thread|launch strategy|early signup|demand)/.test(low)) {
    return 'marketing';
  }
  if (/(fence|ios|app|feature|bug|xcode|testflight|shortcut|widget|pr chain|product)/.test(low)) {
    return 'product';
  }
  if (/(learn|study|reading|research)/.test(low)) return 'learning';
  return 'personal';
}

function classifySignal(text) {
  const low = String(text || '').trim().toLowerCase();
  if (!low) return { kind: 'ignore', tags: [] };

  const ideaPattern =
    /\b(what if|idea|random thought|maybe we could|could we|i want to introduce|post ideas|would be|it would be)\b/;
  const progressPattern =
    /\b(done|finished|completed|shipped|landed|wrapped|closed|went to the gym|hit the gym|swam|went swimming)\b/;
  const strategyPattern =
    /\b(focus more on|focus on|starting this week|gear more towards|want to focus|goal is|primary focus|don't want to invest unless|adapt the day)\b/;
  const taskPattern =
    /^(please|add|create|fix|set up|setup|pause|update|remember|check|upgrade|write|draft|schedule|implement|sync)\b/;
  const contextPattern =
    /\b(rough day|busy|meeting-heavy|work was|sleep|tired|drained|exhausted|gym|swim|energy)\b/;

  if (ideaPattern.test(low)) return { kind: 'idea', tags: ['idea'] };
  if (strategyPattern.test(low)) return { kind: 'strategy_update', tags: ['strategy'] };
  if (progressPattern.test(low)) return { kind: 'progress_update', tags: ['progress'] };
  if (taskPattern.test(low)) return { kind: 'task_request', tags: ['task'] };
  if (contextPattern.test(low)) return { kind: 'context_update', tags: ['context'] };
  if (low.includes('?')) return { kind: 'question', tags: ['question'] };
  return { kind: 'note', tags: ['note'] };
}

function titleKeywords(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && word.length > 3 && !STOPWORDS.has(word))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4);
}

function parseContextCues(text) {
  const low = String(text || '').toLowerCase();
  const cues = {
    workLoad: null,
    sleepQuality: null,
    energyLevel: null,
    fitnessDone: [],
    fitnessIntent: null,
    notes: [],
  };

  if (/(rough day at work|work was insane|hectic work day|meetings all day|heavy work day|busy at work|work commitments)/.test(low)) {
    cues.workLoad = 'heavy';
  } else if (/(light work day|lighter day|free afternoon|easy day at work)/.test(low)) {
    cues.workLoad = 'light';
  }

  if (/(bad sleep|barely slept|didn t sleep|didn't sleep|not enough sleep|poor sleep|sleep deprived)/.test(low)) {
    cues.sleepQuality = 'poor';
  } else if (/(slept well|good sleep|rested)/.test(low)) {
    cues.sleepQuality = 'good';
  }

  if (/(tired|drained|exhausted|burnt out|burned out|low energy)/.test(low)) {
    cues.energyLevel = 'low';
  } else if (/(energized|on fire|high energy|feeling good|crushed it)/.test(low)) {
    cues.energyLevel = 'high';
  }

  if (/(went to the gym|hit the gym|gym session|finished workout|worked out)/.test(low)) {
    cues.fitnessDone.push('gym');
  }
  if (/(swam|went swimming|swimming session)/.test(low)) {
    cues.fitnessDone.push('swim');
  }
  if (/(gym today|go to the gym|gym later)/.test(low)) cues.fitnessIntent = 'gym';
  if (/(swim today|swim later|go swimming)/.test(low)) cues.fitnessIntent = 'swim';

  if (cues.workLoad === 'heavy') cues.notes.push('Work load sounded heavy.');
  if (cues.sleepQuality === 'poor') cues.notes.push('Sleep sounded rough.');
  if (cues.energyLevel === 'low') cues.notes.push('Energy sounded low.');

  return cues;
}

function parseLineStatus(text) {
  const low = String(text || '').toLowerCase();
  if (/\b(done|finished|completed|shipped|landed|yes)\b/.test(low)) return 'done';
  if (/\b(not yet|blocked|tomorrow|later|didn't|did not|couldn't|nope|no)\b/.test(low)) return 'not_done';
  return null;
}

function matchPriorityUpdates(text, priorities) {
  const matches = [];
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const numbered = line.match(/^(\d+)[\)\.\-:]\s*(.+)$/);
    if (!numbered) continue;
    const index = Number(numbered[1]) - 1;
    if (!priorities[index]) continue;
    const status = parseLineStatus(numbered[2]);
    if (status) {
      matches.push({ taskKey: priorities[index].taskKey, status });
    }
  }

  if (matches.length) return matches;

  const sentences = String(text || '')
    .split(/[\.\!\?\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  for (const priority of priorities) {
    const keywords = titleKeywords(priority.title);
    if (!keywords.length) continue;
    for (const sentence of sentences) {
      const low = sentence.toLowerCase();
      const mentionsTask = keywords.some((keyword) => low.includes(keyword));
      if (!mentionsTask) continue;
      const status = parseLineStatus(sentence);
      if (status) {
        matches.push({ taskKey: priority.taskKey, status });
        break;
      }
    }
  }

  return matches;
}

function taskKeyForTask(task) {
  return task.id || task.externalId || task.pageId || task.title;
}

function ensureTaskMeta(dashboard, taskKey, seed = {}) {
  if (!dashboard.tasksMeta[taskKey]) {
    dashboard.tasksMeta[taskKey] = {
      pageId: seed.pageId || null,
      externalId: seed.externalId || null,
      title: seed.title || '',
      area: seed.area || null,
      priority: seed.priority || null,
      slipCount: 0,
      lastPlannedAt: null,
      lastCompletedAt: null,
      lastRolledDate: null,
    };
  }
  return dashboard.tasksMeta[taskKey];
}

function syncTaskMetaFromPriority(dashboard, priority) {
  const meta = ensureTaskMeta(dashboard, priority.taskKey, priority);
  meta.pageId = priority.pageId || meta.pageId;
  meta.externalId = priority.externalId || meta.externalId;
  meta.title = priority.title || meta.title;
  meta.area = priority.area || meta.area;
  meta.priority = priority.priority || meta.priority;
  return meta;
}

function markPriorityDone(dashboard, priority, timestamp, sourceMessageId) {
  if (priority.status === 'done') return false;
  priority.status = 'done';
  priority.completedAt = timestamp;
  priority.completedSourceMessageId = sourceMessageId;

  if (!dashboard.today.completed.some((item) => item.taskKey === priority.taskKey)) {
    dashboard.today.completed.push({
      taskKey: priority.taskKey,
      title: priority.title,
      area: priority.area || null,
      completedAt: timestamp,
    });
  }

  const meta = syncTaskMetaFromPriority(dashboard, priority);
  meta.lastCompletedAt = timestamp;

  const day = ensureRecentDay(dashboard, dashboard.today.date);
  if (!day.completedTaskKeys.includes(priority.taskKey)) {
    day.completedTaskKeys.push(priority.taskKey);
    day.completedCount += 1;
  }
  trackArea(day, priority.area);
  return true;
}

function upsertIdea(ideasState, signal) {
  const existing = ideasState.ideas.find(
    (idea) =>
      idea.sourceMessageId === signal.id ||
      normalizeText(idea.text) === normalizeText(signal.bodyText)
  );
  if (existing) return { created: false, idea: existing };

  const idea = {
    id: `idea-${signal.localDate}-${signal.id}`,
    sourceMessageId: signal.id,
    capturedAt: signal.timestamp,
    area: signal.area,
    status: 'inbox',
    text: signal.bodyText,
    rawText: signal.bodyText,
    promotedTo: null,
  };
  ideasState.ideas.push(idea);
  return { created: true, idea };
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectUnsyncedSignals(archiveState) {
  if (!fs.existsSync(MAIN_SESSIONS_DIR)) return [];

  const files = fs
    .readdirSync(MAIN_SESSIONS_DIR)
    .filter((name) => name.endsWith('.jsonl') || name.includes('.jsonl.reset.'))
    .map((name) => {
      const filePath = path.join(MAIN_SESSIONS_DIR, name);
      return {
        name,
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  const seen = new Set(archiveState.seenMessageIds || []);
  const signals = [];

  for (const file of files) {
    const lines = fs.readFileSync(file.filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.type !== 'message' || parsed?.message?.role !== 'user') continue;
      if (!parsed.id || seen.has(parsed.id)) continue;

      const rawText = contentToText(parsed.message.content);
      const bodyText = extractHumanBody(rawText);
      if (!bodyText || isSystemPromptMessage(bodyText)) continue;

      const timestamp = parsed.message.timestamp
        ? new Date(parsed.message.timestamp).toISOString()
        : parsed.timestamp || nowIso();
      const classification = classifySignal(bodyText);
      if (classification.kind === 'ignore') continue;

      signals.push({
        id: parsed.id,
        timestamp,
        localDate: localDateFromIso(timestamp),
        localTime: localTimeFromIso(timestamp),
        weekday: localWeekdayFromIso(timestamp),
        rawText: rawText.trim(),
        bodyText,
        normalizedText: normalizeText(bodyText),
        kind: classification.kind,
        tags: classification.tags,
        area: inferArea(bodyText),
        sourceFile: file.name,
      });
    }
  }

  signals.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return signals;
}

function applySignalsToState({ dashboard, ideasState, signals }) {
  const result = {
    processedCount: 0,
    newIdeas: [],
    completedTaskKeys: [],
    contextTouched: false,
    latestStrategyUpdate: null,
    memoryNotes: [],
  };

  for (const signal of signals) {
    result.processedCount += 1;
    dashboard.archive.lastHumanMessageAt = signal.timestamp;
    const recentDay = ensureRecentDay(dashboard, signal.localDate);
    trackArea(recentDay, signal.area);

    if (signal.kind === 'idea') {
      const ideaResult = upsertIdea(ideasState, signal);
      if (ideaResult.created) {
        result.newIdeas.push(ideaResult.idea);
        result.memoryNotes.push(`Captured idea: ${truncate(ideaResult.idea.text, 100)}`);
      }
    }

    const context = parseContextCues(signal.bodyText);
    if (
      context.workLoad ||
      context.sleepQuality ||
      context.energyLevel ||
      context.fitnessDone.length ||
      context.fitnessIntent ||
      context.notes.length
    ) {
      const canReplaceContext =
        !dashboard.context.updatedAt || signal.timestamp >= dashboard.context.updatedAt;
      if (canReplaceContext) {
        dashboard.context.updatedAt = signal.timestamp;
        if (context.workLoad) {
          dashboard.context.workLoad = context.workLoad;
          recentDay.workLoad = context.workLoad;
        }
        if (context.sleepQuality) {
          dashboard.context.sleepQuality = context.sleepQuality;
          recentDay.sleepQuality = context.sleepQuality;
        }
        if (context.energyLevel) {
          dashboard.context.energyLevel = context.energyLevel;
          recentDay.energyLevel = context.energyLevel;
        }
        if (context.fitnessIntent) dashboard.context.fitnessIntent = context.fitnessIntent;
      }
      for (const session of context.fitnessDone) {
        if (!dashboard.context.fitnessDone.includes(session)) dashboard.context.fitnessDone.push(session);
        if (!recentDay.fitnessSessions.includes(session)) recentDay.fitnessSessions.push(session);
      }
      for (const note of context.notes) {
        if (!dashboard.context.notes.includes(note)) dashboard.context.notes.push(note);
      }
      result.contextTouched = true;
    }

    if (signal.kind === 'strategy_update') {
      const currentStrategyAt = dashboard.life.lastStrategyUpdate?.at || null;
      if (!currentStrategyAt || signal.timestamp >= currentStrategyAt) {
        dashboard.life.currentFocusNote = signal.bodyText;
        dashboard.life.lastStrategyUpdate = {
          at: signal.timestamp,
          note: signal.bodyText,
        };
        result.latestStrategyUpdate = signal.bodyText;
        result.memoryNotes.push(`Strategy shift: ${truncate(signal.bodyText, 120)}`);
      }
    }

    if (signal.localDate === dashboard.today.date && dashboard.today.priorities.length) {
      const matches = matchPriorityUpdates(signal.bodyText, dashboard.today.priorities);
      for (const match of matches) {
        const priority = dashboard.today.priorities.find((item) => item.taskKey === match.taskKey);
        if (!priority) continue;
        if (match.status === 'done' && markPriorityDone(dashboard, priority, signal.timestamp, signal.id)) {
          result.completedTaskKeys.push(priority.taskKey);
          result.memoryNotes.push(`Marked done from chat: ${priority.title}`);
        }
      }
    }
  }

  updateAreaBalance(dashboard);
  return result;
}

function rememberSignals(archiveState, signals) {
  const next = new Set(archiveState.seenMessageIds || []);
  for (const signal of signals) next.add(signal.id);
  const trimmed = Array.from(next);
  archiveState.seenMessageIds =
    trimmed.length > MAX_SEEN_MESSAGE_IDS
      ? trimmed.slice(trimmed.length - MAX_SEEN_MESSAGE_IDS)
      : trimmed;
  archiveState.lastSyncedAt = nowIso();
  return archiveState;
}

function priorityRank(priority) {
  if (priority === 'P0') return 0;
  if (priority === 'P1') return 1;
  if (priority === 'P2') return 2;
  return 3;
}

function isUserFacingTask(task) {
  const executor = task.executor || task.metadata?.executor || '';
  return executor !== 'Zoe';
}

function scoreTask(task, dashboard, todayDate) {
  const taskKey = taskKeyForTask(task);
  const meta = ensureTaskMeta(dashboard, taskKey, task);
  const carriedOver = dashboard.today.carriedOver.some((item) => item.taskKey === taskKey);
  let score = 0;

  if (task.status === 'Doing') score += 45;
  if (task.priority === 'P0') score += 60;
  else if (task.priority === 'P1') score += 30;
  else if (task.priority === 'P2') score += 10;

  if (task.dueDate) {
    if (compareDates(task.dueDate, todayDate) < 0) score += 50;
    else if (task.dueDate === todayDate) score += 35;
    else if (task.dueDate === addDays(todayDate, 1)) score += 15;
  }

  if (carriedOver) score += 35;
  if ((meta.slipCount || 0) >= 2) score += 15;

  const focus = String(dashboard.life.currentFocusNote || '').toLowerCase();
  if (task.area && focus.includes(String(task.area).toLowerCase())) score += 12;
  if (task.area === 'Marketing' && /(marketing|signup|demand|waitlist)/i.test(focus)) score += 10;
  if (task.area === 'Product' && /fence/i.test(focus)) score += 8;

  return score;
}

function buildPriorityFromTask(task, dashboard) {
  const taskKey = taskKeyForTask(task);
  const meta = ensureTaskMeta(dashboard, taskKey, task);
  return {
    taskKey,
    pageId: task.pageId || task.metadata?.notionPageId || null,
    externalId: task.externalId || task.metadata?.externalId || null,
    title: task.title,
    area: task.area || null,
    priority: task.priority || null,
    dueDate: task.dueDate || null,
    status: 'planned',
    slipCount: meta.slipCount || 0,
    source: task.source || task.sourceRef || null,
    url: task.url || task.metadata?.notionUrl || null,
  };
}

function buildMorningPlan({ dashboard, ideasState, openTasks, todayDate = currentLocalDate() }) {
  const heavyLoad =
    dashboard.context.workLoad === 'heavy' ||
    dashboard.context.sleepQuality === 'poor' ||
    dashboard.context.energyLevel === 'low';
  const maxPriorities = heavyLoad ? 1 : 3;
  const taskUpdates = [];
  const carriedOverTasks = (dashboard.today.carriedOver || []).map((item) => ({
    id: item.taskKey,
    taskKey: item.taskKey,
    pageId: item.pageId || null,
    url: item.url || null,
    title: item.title,
    externalId: item.externalId || null,
    status: 'Todo',
    priority: item.priority || 'P1',
    area: item.area || null,
    executor: 'Nishchay',
    dueDate: item.dueDate || null,
    source: 'carryover',
  }));
  const sourceTasks = (openTasks && openTasks.length ? openTasks : carriedOverTasks) || [];
  const userTasks = sourceTasks.filter(isUserFacingTask);
  const sorted = [...userTasks].sort((left, right) => {
    const scoreDiff = scoreTask(right, dashboard, todayDate) - scoreTask(left, dashboard, todayDate);
    if (scoreDiff !== 0) return scoreDiff;
    const dueA = left.dueDate || '9999-12-31';
    const dueB = right.dueDate || '9999-12-31';
    const dueDiff = compareDates(dueA, dueB);
    if (dueDiff !== 0) return dueDiff;
    return priorityRank(left.priority) - priorityRank(right.priority);
  });

  const chosen = [];
  for (const task of sorted) {
    const taskKey = taskKeyForTask(task);
    if (dashboard.today.completed.some((item) => item.taskKey === taskKey)) continue;
    chosen.push(buildPriorityFromTask(task, dashboard));
    if (chosen.length >= maxPriorities) break;
  }

  for (const priority of chosen) {
    const meta = syncTaskMetaFromPriority(dashboard, priority);
    meta.lastPlannedAt = todayDate;
    if (priority.dueDate && compareDates(priority.dueDate, todayDate) < 0 && meta.lastRolledDate !== todayDate) {
      meta.slipCount = (meta.slipCount || 0) + 1;
      meta.lastRolledDate = todayDate;
      priority.slipCount = meta.slipCount;
      priority.dueDate = todayDate;
      taskUpdates.push({
        taskKey,
        dueDate: todayDate,
      });
    } else {
      priority.slipCount = meta.slipCount || 0;
    }
  }

  dashboard.today.priorities = chosen;
  dashboard.today.adjustmentReason = heavyLoad
    ? 'Work load, sleep, or energy suggested a lighter side-project day.'
    : null;

  const previousDate = addDays(todayDate, -1);
  const previousDay = dashboard.momentum.recentDays.find((entry) => entry.date === previousDate) || null;
  const inboxCount = countIdeasByStatus(ideasState, 'inbox');

  return {
    date: todayDate,
    heavyLoad,
    previousDay,
    priorities: chosen,
    adjustmentReason: dashboard.today.adjustmentReason,
    inboxCount,
    taskUpdates,
  };
}

function buildMorningMessage(plan, dashboard) {
  const lines = [];
  if (plan.adjustmentReason) {
    lines.push('Morning.');
    lines.push('Keeping today light because work load, sleep, or energy looked rough.');
  } else {
    lines.push('Morning, Nisch.');
  }

  if (plan.previousDay) {
    lines.push('');
    lines.push(
      `Yesterday: ${plan.previousDay.completedCount} of ${plan.previousDay.plannedCount || 0} tracked priorities moved.`
    );
  }

  if (plan.priorities.length) {
    lines.push('');
    lines.push("Today's focus:");
    plan.priorities.forEach((priority, index) => {
      const overdueNote = priority.slipCount >= 2 ? ` (slipped ${priority.slipCount}x)` : '';
      lines.push(`${index + 1}. [${priority.priority || 'P1'}] ${priority.title}${overdueNote}`);
    });
  } else {
    lines.push('');
    lines.push('No hard task list today. Protect work energy, keep fitness alive, and send me whatever changes.');
  }

  lines.push('');
  lines.push(`Anchor points: ${dashboard.life.anchorPoints.slice(0, 2).join(' ')}`);
  if (plan.inboxCount > 0) {
    lines.push(`Ideas parked: ${plan.inboxCount}. I’ll keep them parked unless you want one promoted.`);
  }
  lines.push('Heavy work day or lighter? Gym or swim today?');

  return lines.join('\n');
}

function buildEveningMessage(dashboard) {
  const lines = ['End of day.'];
  if (dashboard.today.priorities.length) {
    lines.push('');
    lines.push("From today's list:");
    dashboard.today.priorities.forEach((priority, index) => {
      const suffix = priority.status === 'done' ? 'done already.' : 'done?';
      lines.push(`${index + 1}. ${priority.title} — ${suffix}`);
    });
  } else {
    lines.push('');
    lines.push('No strict list today. What moved anyway?');
  }

  lines.push('');
  lines.push('Anything else land off-list? How was work, sleep, energy, and did you hit gym or swim?');
  return lines.join('\n');
}

function countIdeasByStatus(ideasState, status = 'inbox') {
  return (ideasState.ideas || []).filter((idea) => idea.status === status).length;
}

function buildWeeklyReview(dashboard, ideasState) {
  const lastSeven = dashboard.momentum.recentDays.slice(-7);
  const previousSeven = dashboard.momentum.recentDays.slice(-14, -7);
  const completed = lastSeven.reduce((sum, day) => sum + (day.completedCount || 0), 0);
  const previousCompleted = previousSeven.reduce((sum, day) => sum + (day.completedCount || 0), 0);
  const fitnessSessions = lastSeven.reduce(
    (sum, day) => sum + (Array.isArray(day.fitnessSessions) ? day.fitnessSessions.length : 0),
    0
  );
  const areaCounts = {};
  for (const day of lastSeven) {
    for (const area of day.touchedAreas || []) {
      areaCounts[area] = (areaCounts[area] || 0) + 1;
    }
  }
  const neglected = dashboard.life.areas.filter((area) => !areaCounts[area]);

  const lines = ['Week wrap-up.'];
  lines.push('');
  lines.push(
    `Done: ${completed} tracked wins${previousSeven.length ? ` (${completed >= previousCompleted ? 'up' : 'down'} from ${previousCompleted} last week)` : ''}.`
  );
  lines.push(`Fitness: ${fitnessSessions} logged session${fitnessSessions === 1 ? '' : 's'}.`);

  if (Object.keys(areaCounts).length) {
    const topAreas = Object.entries(areaCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([area, count]) => `${area} ${count}d`);
    lines.push(`Areas: ${topAreas.join(', ')}.`);
  }

  if (neglected.length) {
    lines.push(`Neglected: ${neglected.join(', ')}.`);
  }

  const inboxCount = countIdeasByStatus(ideasState, 'inbox');
  lines.push(`Ideas inbox: ${inboxCount}.`);
  lines.push(`Focus note: ${dashboard.life.currentFocusNote}`);

  return {
    message: lines.join('\n'),
    stats: {
      completed,
      previousCompleted,
      fitnessSessions,
      areaCounts,
      neglected,
      inboxCount,
    },
  };
}

function buildDailySummaryFields(dashboard, ideasState) {
  const completedCount = dashboard.today.completed.length;
  const totalCount = dashboard.today.priorities.length;
  const open = dashboard.today.priorities.filter((priority) => priority.status !== 'done');
  const summary =
    totalCount > 0
      ? `Tracked ${totalCount} priorities today; ${completedCount} completed.`
      : 'Manager archive running. No structured priorities were set today.';
  const metrics = [
    dashboard.context.workLoad ? `Work: ${dashboard.context.workLoad}` : null,
    dashboard.context.sleepQuality ? `Sleep: ${dashboard.context.sleepQuality}` : null,
    dashboard.context.energyLevel ? `Energy: ${dashboard.context.energyLevel}` : null,
    `Ideas inbox: ${countIdeasByStatus(ideasState, 'inbox')}`,
  ]
    .filter(Boolean)
    .join(' | ');
  const blockers = open
    .filter((priority) => priority.priority === 'P0' || (priority.slipCount || 0) >= 2)
    .map((priority) => priority.title)
    .slice(0, 3)
    .join(' | ');
  const nextPriority = truncate(open[0]?.title || dashboard.life.currentFocusNote || '', 240);
  return { summary, metrics, blockers, nextPriority };
}

function truncate(text, max = 120) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function appendDailyMemoryNotes(date, heading, notes) {
  const cleanNotes = (notes || []).filter(Boolean);
  if (!cleanNotes.length) return null;
  ensureDir(MEMORY_DIR);
  const filePath = path.join(MEMORY_DIR, `${date}.md`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# Daily Log: ${date}\n`, 'utf8');
  }
  const lines = ['', `## ${heading}`];
  cleanNotes.forEach((note) => lines.push(`- ${note}`));
  fs.appendFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

module.exports = {
  WORKSPACE,
  STATE_DIR,
  DASHBOARD_PATH,
  IDEAS_PATH,
  ARCHIVE_PATH,
  MEMORY_DIR,
  MAIN_SESSIONS_DIR,
  TIME_ZONE,
  addDays,
  appendDailyMemoryNotes,
  applySignalsToState,
  buildDailySummaryFields,
  buildEveningMessage,
  buildMorningMessage,
  buildMorningPlan,
  buildWeeklyReview,
  collectUnsyncedSignals,
  countIdeasByStatus,
  currentLocalDate,
  currentLocalDateFromDate,
  defaultArchive,
  defaultDashboard,
  defaultIdeas,
  ensureRecentDay,
  ensureStateFiles,
  ensureTaskMeta,
  extractHumanBody,
  inferArea,
  isSystemPromptMessage,
  loadArchive,
  loadDashboard,
  loadIdeas,
  localDateFromIso,
  localTimeFromIso,
  mergeArchive,
  mergeDashboard,
  mergeIdeas,
  nowIso,
  priorityRank,
  rememberSignals,
  rolloverDashboardIfNeeded,
  saveArchive,
  saveDashboard,
  saveIdeas,
  taskKeyForTask,
  titleKeywords,
  truncate,
  updateAreaBalance,
};
