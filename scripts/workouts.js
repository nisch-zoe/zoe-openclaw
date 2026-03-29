#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const WORKOUT_DRAFTS_PATH = path.join(db.WORKSPACE, 'state', 'workout-drafts.json');
const DEFAULT_LIST_DAYS = 30;

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

function normalizeDate(value, { allowNull = true } = {}) {
  const date = normalizeText(value);
  if (!date) {
    if (allowNull) return null;
    throw new Error('Workout date is required.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Expected YYYY-MM-DD date, received "${value}".`);
  }
  return date;
}

function parseInteger(value, fieldName, { allowNull = true, min = 1 } = {}) {
  if (value == null || value === '') {
    if (allowNull) return null;
    throw new Error(`${fieldName} is required.`);
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${fieldName} must be an integer >= ${min}.`);
  }
  return parsed;
}

function deepClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeObject(value, fieldName, { allowNull = true } = {}) {
  if (value == null) {
    if (allowNull) return {};
    throw new Error(`${fieldName} is required.`);
  }

  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
  return deepClone(parsed);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined)
  );
}

function buildInClause(values, baseName, params) {
  const list = Array.from(
    new Set(
      (Array.isArray(values) ? values : [values])
        .map((value) => normalizeText(value))
        .filter(Boolean)
    )
  );
  if (!list.length) return null;

  const placeholders = list.map((value, index) => {
    const key = `${baseName}_${index}`;
    params[key] = value;
    return `@${key}`;
  });

  return placeholders.join(', ');
}

function normalizeSessionType(value, { allowNull = true } = {}) {
  const text = normalizeText(value);
  if (!text) {
    if (allowNull) return null;
    throw new Error('Workout session type is required.');
  }

  const normalized = text.toLowerCase();
  if (['weights', 'lifting', 'lift', 'strength'].includes(normalized)) return 'gym';
  if (['swimming', 'pool'].includes(normalized)) return 'swim';
  if (['jog'].includes(normalized)) return 'run';
  if (['bike', 'cycling'].includes(normalized)) return 'cycle';
  if (['walked'].includes(normalized)) return 'walk';
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function normalizeIntensity(value, { allowNull = true } = {}) {
  const text = normalizeText(value);
  if (!text) return allowNull ? null : 'moderate';

  const normalized = text.toLowerCase();
  if (['easy', 'light', 'recovery'].includes(normalized)) return 'easy';
  if (['medium', 'moderate', 'steady'].includes(normalized)) return 'moderate';
  if (['hard', 'heavy', 'intense'].includes(normalized)) return 'hard';
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function canonicalizeExerciseName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleCase(value) {
  return String(value || '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeText(entry)).filter(Boolean);
}

function collectExtraFields(input, knownKeys) {
  return Object.fromEntries(
    Object.entries(input || {})
      .filter(([key, value]) => !knownKeys.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => [key, deepClone(value)])
  );
}

function normalizeExerciseInput(exercise, index = 0) {
  if (!exercise || typeof exercise !== 'object' || Array.isArray(exercise)) {
    throw new Error('Each workout exercise entry must be an object.');
  }

  const exerciseName = normalizeText(exercise.exerciseName || exercise.name);
  if (!exerciseName) {
    throw new Error('Exercise name is required for each workout exercise entry.');
  }

  const payload = {
    ...normalizeObject(exercise.payload || exercise.data, 'exercise payload'),
    ...collectExtraFields(
      exercise,
      new Set(['id', 'exerciseName', 'name', 'category', 'sequence', 'notes', 'payload', 'data'])
    ),
  };

  return {
    id: normalizeText(exercise.id) || crypto.randomUUID(),
    exerciseName,
    canonicalName: canonicalizeExerciseName(exerciseName),
    category: normalizeText(exercise.category),
    sequence:
      Number.isInteger(exercise.sequence) && exercise.sequence > 0 ? exercise.sequence : index + 1,
    notes: normalizeText(exercise.notes),
    payload,
  };
}

function deriveSessionSummary(sessionType, title, exercises) {
  const label = title || `${titleCase(sessionType)} session`;
  if (!exercises.length) return label;

  const preview = exercises
    .slice(0, 3)
    .map((exercise) => exercise.exerciseName)
    .join(', ');
  return `${label}: ${preview}${exercises.length > 3 ? ', ...' : ''}`;
}

function hasStructuredDetail(session) {
  if (session.durationMinutes != null) return true;
  if (Array.isArray(session.exercises) && session.exercises.length) return true;
  if (session.metadata && typeof session.metadata === 'object') {
    return ['distanceMeters', 'distanceKm', 'laps', 'calories', 'steps'].some(
      (key) => session.metadata[key] != null
    );
  }
  return false;
}

function normalizeSessionInput(input, { allowPartial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Workout session input must be a JSON object.');
  }

  const knownKeys = new Set([
    'id',
    'date',
    'sessionType',
    'type',
    'modality',
    'title',
    'summary',
    'durationMinutes',
    'duration',
    'minutes',
    'intensity',
    'source',
    'rawText',
    'raw',
    'message',
    'metadata',
    'exercises',
    'blocks',
  ]);

  const extras = collectExtraFields(input, knownKeys);
  const sessionMetadata = {
    ...normalizeObject(input.metadata, 'session metadata'),
    ...extras,
  };
  const exerciseList = Array.isArray(input.exercises)
    ? input.exercises
    : Array.isArray(input.blocks)
      ? input.blocks
      : undefined;

  const exercises =
    exerciseList === undefined
      ? undefined
      : exerciseList.map((exercise, index) => normalizeExerciseInput(exercise, index));

  const session = compactObject({
    id: normalizeText(input.id) || (allowPartial ? null : crypto.randomUUID()),
    date: normalizeDate(input.date, { allowNull: true }) || (allowPartial ? null : db.todayDate()),
    sessionType: normalizeSessionType(input.sessionType || input.type || input.modality, {
      allowNull: allowPartial,
    }),
    title: normalizeText(input.title),
    summary: normalizeText(input.summary),
    durationMinutes: parseInteger(
      input.durationMinutes ?? input.duration ?? input.minutes,
      'durationMinutes',
      { allowNull: true }
    ),
    intensity: normalizeIntensity(input.intensity, { allowNull: true }),
    source: normalizeText(input.source),
    rawText: normalizeText(input.rawText || input.raw || input.message),
    metadata: Object.keys(sessionMetadata).length ? sessionMetadata : allowPartial ? undefined : {},
    exercises,
  });

  if (!allowPartial) {
    if (!session.sessionType) {
      throw new Error('Workout session type is required.');
    }
    session.summary =
      session.summary || deriveSessionSummary(session.sessionType, session.title, session.exercises || []);
    if (!session.summary) {
      throw new Error('Workout summary is required.');
    }
    if (!hasStructuredDetail(session)) {
      throw new Error(
        'Provide at least one exercise, durationMinutes, or another quantitative metric in metadata.'
      );
    }
  }

  return session;
}

function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) {
    throw new Error(`JSON file is empty: ${filePath}`);
  }
  return JSON.parse(raw);
}

function safeParseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ensureDraftFoundation() {
  ensureDir(path.dirname(WORKOUT_DRAFTS_PATH));
}

function defaultDraftState() {
  return {
    version: 1,
    lastUpdated: db.nowIso(),
    drafts: [],
  };
}

function loadDraftState() {
  ensureDraftFoundation();
  if (!fs.existsSync(WORKOUT_DRAFTS_PATH)) {
    return defaultDraftState();
  }

  const raw = fs.readFileSync(WORKOUT_DRAFTS_PATH, 'utf8');
  const parsed = raw.trim() ? JSON.parse(raw) : defaultDraftState();
  return {
    version: 1,
    lastUpdated: normalizeText(parsed.lastUpdated) || db.nowIso(),
    drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
  };
}

function saveDraftState(state) {
  ensureDraftFoundation();
  const payload = {
    version: 1,
    lastUpdated: db.nowIso(),
    drafts: Array.isArray(state.drafts) ? state.drafts : [],
  };
  fs.writeFileSync(WORKOUT_DRAFTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function mergeRawMessages(existing = [], incoming = []) {
  const deduped = new Map();
  [...existing, ...incoming].forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const text = normalizeText(entry.text);
    if (!text) return;
    const capturedAt = normalizeText(entry.capturedAt) || db.nowIso();
    deduped.set(`${capturedAt}:${text}`, { capturedAt, text });
  });
  return Array.from(deduped.values()).sort((left, right) =>
    String(left.capturedAt).localeCompare(String(right.capturedAt))
  );
}

function mergeDraftSession(existing = {}, incoming = {}) {
  const merged = {
    ...existing,
    ...incoming,
  };

  if (existing.metadata || incoming.metadata) {
    merged.metadata = {
      ...(existing.metadata || {}),
      ...(incoming.metadata || {}),
    };
  }

  if (incoming.exercises !== undefined) {
    merged.exercises = incoming.exercises;
  } else if (existing.exercises !== undefined) {
    merged.exercises = existing.exercises;
  }

  return compactObject(merged);
}

function summarizeDraft(draft) {
  return {
    id: draft.id,
    status: draft.status,
    updatedAt: draft.updatedAt,
    source: draft.source || null,
    sessionType: draft.session?.sessionType || null,
    date: draft.session?.date || null,
    title: draft.session?.title || null,
    summary: draft.session?.summary || null,
    missingFields: draft.missingFields || [],
    nextQuestion: draft.nextQuestion || null,
  };
}

function listDrafts({ status } = {}) {
  const state = loadDraftState();
  const desiredStatus = normalizeText(status);
  const drafts = desiredStatus
    ? state.drafts.filter((draft) => draft.status === desiredStatus)
    : state.drafts;
  return drafts
    .slice()
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
    .map(summarizeDraft);
}

function getDraft(id) {
  const state = loadDraftState();
  return state.drafts.find((draft) => draft.id === id) || null;
}

function saveDraft(input) {
  const state = loadDraftState();
  const now = db.nowIso();
  const existingIndex = state.drafts.findIndex((draft) => draft.id === input.id);
  const existing = existingIndex >= 0 ? state.drafts[existingIndex] : null;
  const sessionPatch = normalizeSessionInput(input.session || {}, { allowPartial: true });
  const status = normalizeText(input.status) || existing?.status || 'open';

  const draft = {
    id: normalizeText(input.id) || existing?.id || crypto.randomUUID(),
    status,
    source: normalizeText(input.source) || existing?.source || 'telegram',
    sessionKey: normalizeText(input.sessionKey) || existing?.sessionKey || null,
    chatId: normalizeText(input.chatId) || existing?.chatId || null,
    createdAt: existing?.createdAt || normalizeText(input.createdAt) || now,
    updatedAt: now,
    resolvedAt:
      status === 'resolved' || status === 'discarded'
        ? existing?.resolvedAt || now
        : existing?.resolvedAt || null,
    missingFields:
      input.missingFields !== undefined
        ? normalizeStringArray(input.missingFields)
        : existing?.missingFields || [],
    nextQuestion:
      input.nextQuestion !== undefined
        ? normalizeText(input.nextQuestion)
        : existing?.nextQuestion || null,
    rawMessages: mergeRawMessages(existing?.rawMessages || [], input.rawMessages || []),
    session: mergeDraftSession(existing?.session || {}, sessionPatch),
    recordedSessionId:
      normalizeText(input.recordedSessionId) || existing?.recordedSessionId || null,
  };

  if (existingIndex >= 0) {
    state.drafts[existingIndex] = draft;
  } else {
    state.drafts.push(draft);
  }
  saveDraftState(state);
  return draft;
}

function discardDraft(id) {
  const state = loadDraftState();
  const index = state.drafts.findIndex((draft) => draft.id === id);
  if (index < 0) {
    throw new Error(`Workout draft not found: ${id}`);
  }

  const next = {
    ...state.drafts[index],
    status: 'discarded',
    updatedAt: db.nowIso(),
    resolvedAt: db.nowIso(),
  };
  state.drafts[index] = next;
  saveDraftState(state);
  return next;
}

function markDraftResolved(id, recordedSessionId) {
  const state = loadDraftState();
  const index = state.drafts.findIndex((draft) => draft.id === id);
  if (index < 0) return null;

  state.drafts[index] = {
    ...state.drafts[index],
    status: 'resolved',
    updatedAt: db.nowIso(),
    resolvedAt: db.nowIso(),
    recordedSessionId,
    missingFields: [],
    nextQuestion: null,
  };
  saveDraftState(state);
  return state.drafts[index];
}

function buildActivitySummary(session) {
  const label = session.title || session.summary;
  const duration = session.durationMinutes ? ` (${session.durationMinutes} min)` : '';
  return `${titleCase(session.sessionType)}: ${label}${duration}`;
}

function buildActivityDetails(session) {
  const lines = [session.summary];
  if (session.exercises?.length) {
    lines.push(`Exercises: ${session.exercises.map((exercise) => exercise.exerciseName).join(', ')}`);
  }
  if (session.intensity) {
    lines.push(`Intensity: ${session.intensity}`);
  }
  if (session.metadata && Object.keys(session.metadata).length) {
    lines.push(`Metadata: ${JSON.stringify(session.metadata)}`);
  }
  if (session.rawText) {
    lines.push(`Raw: ${session.rawText}`);
  }
  return lines.join('\n');
}

function mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    sessionType: row.sessionType,
    title: row.title,
    summary: row.summary,
    durationMinutes: row.durationMinutes,
    intensity: row.intensity,
    source: row.source,
    rawText: row.rawText,
    metadata: safeParseJson(row.metadataJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapExerciseRow(row) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    exerciseName: row.exerciseName,
    canonicalName: row.canonicalName,
    category: row.category,
    sequence: row.sequence,
    notes: row.notes,
    payload: safeParseJson(row.payloadJson, {}),
    createdAt: row.createdAt,
  };
}

function getWorkout(id) {
  const database = db.openDb();
  const session = mapSessionRow(
    database
      .prepare(
        `
          SELECT
            id,
            date,
            session_type AS sessionType,
            title,
            summary,
            duration_minutes AS durationMinutes,
            intensity,
            source,
            raw_text AS rawText,
            metadata_json AS metadataJson,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM workout_sessions
          WHERE id = ?
        `
      )
      .get(id)
  );
  if (!session) return null;

  const exercises = database
    .prepare(
      `
        SELECT
          id,
          session_id AS sessionId,
          exercise_name AS exerciseName,
          canonical_name AS canonicalName,
          category,
          sequence,
          notes,
          payload_json AS payloadJson,
          created_at AS createdAt
        FROM workout_exercises
        WHERE session_id = ?
        ORDER BY sequence ASC, created_at ASC
      `
    )
    .all(id)
    .map(mapExerciseRow);

  return {
    ...session,
    exercises,
  };
}

function listWorkouts({ days = DEFAULT_LIST_DAYS, type, exercise, limit } = {}) {
  const database = db.openDb();
  const params = {};
  const clauses = [];
  let joins = '';

  if (days != null) {
    const parsedDays = parseInteger(days, 'days', { allowNull: false });
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - (parsedDays - 1));
    params.cutoff = cutoff.toISOString().slice(0, 10);
    clauses.push('ws.date >= @cutoff');
  }

  const sessionType = normalizeSessionType(type, { allowNull: true });
  if (sessionType) {
    params.sessionType = sessionType;
    clauses.push('ws.session_type = @sessionType');
  }

  const exerciseQuery = normalizeText(exercise);
  if (exerciseQuery) {
    joins = 'INNER JOIN workout_exercises we ON we.session_id = ws.id';
    params.exerciseQuery = `%${canonicalizeExerciseName(exerciseQuery)}%`;
    clauses.push('(we.canonical_name LIKE @exerciseQuery OR LOWER(we.exercise_name) LIKE LOWER(@exerciseQuery))');
  }

  const limitValue =
    limit == null || limit === '' ? null : parseInteger(limit, 'limit', { allowNull: false });
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitClause = limitValue ? `LIMIT ${limitValue}` : '';

  return database
    .prepare(
      `
        SELECT DISTINCT
          ws.id,
          ws.date,
          ws.session_type AS sessionType,
          ws.title,
          ws.summary,
          ws.duration_minutes AS durationMinutes,
          ws.intensity,
          ws.source,
          ws.raw_text AS rawText,
          ws.metadata_json AS metadataJson,
          ws.created_at AS createdAt,
          ws.updated_at AS updatedAt
        FROM workout_sessions ws
        ${joins}
        ${where}
        ORDER BY ws.date DESC, ws.created_at DESC
        ${limitClause}
      `
    )
    .all(params)
    .map(mapSessionRow);
}

function summarizeWorkouts(filters = {}) {
  const sessions = listWorkouts({ ...filters, limit: null });
  const byType = {};
  let totalDurationMinutes = 0;

  sessions.forEach((session) => {
    byType[session.sessionType] = (byType[session.sessionType] || 0) + 1;
    totalDurationMinutes += session.durationMinutes || 0;
  });

  const database = db.openDb();
  const params = {};
  let topExercises = [];
  const ids = sessions.map((session) => session.id);
  const inClause = buildInClause(ids, 'sessionId', params);
  if (inClause) {
    topExercises = database
      .prepare(
        `
          SELECT
            canonical_name AS canonicalName,
            MIN(exercise_name) AS exerciseName,
            COUNT(*) AS entryCount,
            COUNT(DISTINCT session_id) AS sessionCount
          FROM workout_exercises
          WHERE session_id IN (${inClause})
          GROUP BY canonical_name
          ORDER BY sessionCount DESC, entryCount DESC, exerciseName COLLATE NOCASE ASC
          LIMIT 10
        `
      )
      .all(params)
      .map((row) => ({
        canonicalName: row.canonicalName,
        exerciseName: row.exerciseName,
        sessionCount: row.sessionCount,
        entryCount: row.entryCount,
      }));
  }

  return {
    totalSessions: sessions.length,
    totalDurationMinutes,
    byType,
    recentSessions: sessions.slice(0, 5),
    topExercises,
  };
}

function exerciseHistory(name, { limit = 10 } = {}) {
  const exerciseName = normalizeText(name);
  if (!exerciseName) {
    throw new Error('Exercise name is required.');
  }

  const limitValue = parseInteger(limit, 'limit', { allowNull: false });
  const canonical = canonicalizeExerciseName(exerciseName);
  const database = db.openDb();

  return database
    .prepare(
      `
        SELECT
          we.id,
          we.session_id AS sessionId,
          we.exercise_name AS exerciseName,
          we.canonical_name AS canonicalName,
          we.category,
          we.sequence,
          we.notes,
          we.payload_json AS payloadJson,
          we.created_at AS createdAt,
          ws.date,
          ws.session_type AS sessionType,
          ws.title,
          ws.summary,
          ws.duration_minutes AS durationMinutes
        FROM workout_exercises we
        INNER JOIN workout_sessions ws ON ws.id = we.session_id
        WHERE we.canonical_name = @canonical
           OR LOWER(we.exercise_name) LIKE LOWER(@query)
        ORDER BY ws.date DESC, we.sequence ASC
        LIMIT ${limitValue}
      `
    )
    .all({
      canonical,
      query: `%${exerciseName}%`,
    })
    .map((row) => ({
      ...mapExerciseRow(row),
      date: row.date,
      sessionType: row.sessionType,
      title: row.title,
      summary: row.summary,
      durationMinutes: row.durationMinutes,
    }));
}

function recordWorkout(input, { draftId = null, skipActivity = false } = {}) {
  const session = normalizeSessionInput(input, { allowPartial: false });
  const database = db.openDb();

  const existing = database.prepare('SELECT id FROM workout_sessions WHERE id = ?').get(session.id);
  if (existing) {
    throw new Error(`Workout session already exists: ${session.id}`);
  }

  database.exec('BEGIN');
  try {
    database
      .prepare(
        `
          INSERT INTO workout_sessions (
            id,
            date,
            session_type,
            title,
            summary,
            duration_minutes,
            intensity,
            source,
            raw_text,
            metadata_json,
            created_at,
            updated_at
          ) VALUES (
            @id,
            @date,
            @sessionType,
            @title,
            @summary,
            @durationMinutes,
            @intensity,
            @source,
            @rawText,
            @metadataJson,
            @createdAt,
            @updatedAt
          )
        `
      )
      .run({
        id: session.id,
        date: session.date,
        sessionType: session.sessionType,
        title: session.title || null,
        summary: session.summary,
        durationMinutes: session.durationMinutes || null,
        intensity: session.intensity || null,
        source: session.source || null,
        rawText: session.rawText || null,
        metadataJson: JSON.stringify(session.metadata || {}),
        createdAt: db.nowIso(),
        updatedAt: db.nowIso(),
      });

    for (const exercise of session.exercises || []) {
      database
        .prepare(
          `
            INSERT INTO workout_exercises (
              id,
              session_id,
              exercise_name,
              canonical_name,
              category,
              sequence,
              notes,
              payload_json,
              created_at
            ) VALUES (
              @id,
              @sessionId,
              @exerciseName,
              @canonicalName,
              @category,
              @sequence,
              @notes,
              @payloadJson,
              @createdAt
            )
          `
        )
        .run({
          id: exercise.id,
          sessionId: session.id,
          exerciseName: exercise.exerciseName,
          canonicalName: exercise.canonicalName,
          category: exercise.category || null,
          sequence: exercise.sequence,
          notes: exercise.notes || null,
          payloadJson: JSON.stringify(exercise.payload || {}),
          createdAt: db.nowIso(),
        });
    }

    let activityEntry = null;
    if (!skipActivity) {
      activityEntry = db.logActivity(buildActivitySummary(session), {
        area: 'fitness',
        date: session.date,
        details: buildActivityDetails(session),
      });
      session.activityEntry = activityEntry;
    }

    database.exec('COMMIT');
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures and rethrow the original error.
    }
    throw error;
  }

  if (draftId) {
    markDraftResolved(draftId, session.id);
  }

  return {
    ...getWorkout(session.id),
    draftId: draftId || null,
  };
}

function printUsage() {
  console.log(`OpenClaw workout helper

Commands:
  list [--days 30] [--type gym] [--exercise "bench press"] [--limit 20] [--json]
  show --id <session-id> [--json]
  summary [--days 30] [--type gym] [--json]
  exercise --name "bench press" [--limit 10] [--json]
  record --file <session.json> [--draft-id <draft-id>] [--skip-activity] [--json]
  draft:list [--status open] [--json]
  draft:show --id <draft-id> [--json]
  draft:save --file <draft.json> [--json]
  draft:discard --id <draft-id> [--json]
`);
}

function printSession(session) {
  const title = session.title ? ` | ${session.title}` : '';
  const duration = session.durationMinutes ? ` | ${session.durationMinutes} min` : '';
  console.log(`${session.date} | ${session.id} | ${session.sessionType}${title}${duration}`);
  console.log(`  ${session.summary}`);
}

function printDraft(draft) {
  const missing = draft.missingFields.length ? ` | missing: ${draft.missingFields.join(', ')}` : '';
  console.log(`[${draft.status}] ${draft.id}${missing}`);
  if (draft.summary) {
    console.log(`  ${draft.summary}`);
  }
  if (draft.nextQuestion) {
    console.log(`  ask: ${draft.nextQuestion}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'summary';
  const asJson = Boolean(args.json);

  try {
    if (command === 'list') {
      const sessions = listWorkouts({
        days: args.days,
        type: args.type,
        exercise: args.exercise,
        limit: args.limit,
      });
      if (asJson) {
        console.log(JSON.stringify({ sessions }, null, 2));
      } else if (!sessions.length) {
        console.log('No workout sessions matched.');
      } else {
        sessions.forEach(printSession);
      }
      return;
    }

    if (command === 'show') {
      const session = getWorkout(args.id || args._[1]);
      if (!session) {
        throw new Error('Workout session not found.');
      }
      if (asJson) {
        console.log(JSON.stringify(session, null, 2));
      } else {
        printSession(session);
        if (session.exercises.length) {
          session.exercises.forEach((exercise) => {
            console.log(`  - ${exercise.exerciseName}`);
          });
        }
      }
      return;
    }

    if (command === 'summary') {
      const summary = summarizeWorkouts({
        days: args.days,
        type: args.type,
      });
      if (asJson) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`Sessions: ${summary.totalSessions}`);
        console.log(`Duration: ${summary.totalDurationMinutes} min`);
        console.log(
          `By type: ${Object.entries(summary.byType)
            .map(([key, value]) => `${key}=${value}`)
            .join(', ') || 'none'}`
        );
      }
      return;
    }

    if (command === 'exercise') {
      const entries = exerciseHistory(args.name || args._[1], { limit: args.limit || 10 });
      if (asJson) {
        console.log(JSON.stringify({ entries }, null, 2));
      } else if (!entries.length) {
        console.log('No exercise entries matched.');
      } else {
        entries.forEach((entry) => {
          console.log(`${entry.date} | ${entry.exerciseName} | ${entry.sessionType}`);
        });
      }
      return;
    }

    if (command === 'record') {
      const payloadPath = args.file;
      if (!payloadPath) {
        throw new Error('Use --file <session.json> for workout record input.');
      }
      const result = recordWorkout(parseJsonFile(payloadPath), {
        draftId: args['draft-id'] || null,
        skipActivity: Boolean(args['skip-activity']),
      });
      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printSession(result);
      }
      return;
    }

    if (command === 'draft:list') {
      const drafts = listDrafts({ status: args.status });
      if (asJson) {
        console.log(JSON.stringify({ drafts }, null, 2));
      } else if (!drafts.length) {
        console.log('No workout drafts matched.');
      } else {
        drafts.forEach(printDraft);
      }
      return;
    }

    if (command === 'draft:show') {
      const draft = getDraft(args.id || args._[1]);
      if (!draft) {
        throw new Error('Workout draft not found.');
      }
      if (asJson) {
        console.log(JSON.stringify(draft, null, 2));
      } else {
        printDraft(summarizeDraft(draft));
      }
      return;
    }

    if (command === 'draft:save') {
      if (!args.file) {
        throw new Error('Use --file <draft.json> for draft input.');
      }
      const draft = saveDraft(parseJsonFile(args.file));
      if (asJson) {
        console.log(JSON.stringify(draft, null, 2));
      } else {
        printDraft(summarizeDraft(draft));
      }
      return;
    }

    if (command === 'draft:discard') {
      const draft = discardDraft(args.id || args._[1]);
      if (asJson) {
        console.log(JSON.stringify(draft, null, 2));
      } else {
        printDraft(summarizeDraft(draft));
      }
      return;
    }

    printUsage();
    process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db.closeDb();
  }
}

module.exports = {
  WORKOUT_DRAFTS_PATH,
  discardDraft,
  exerciseHistory,
  getDraft,
  getWorkout,
  listDrafts,
  listWorkouts,
  loadDraftState,
  normalizeSessionInput,
  recordWorkout,
  saveDraft,
  summarizeWorkouts,
};

if (require.main === module) {
  main();
}
