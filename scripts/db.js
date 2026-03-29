#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const WORKSPACE = path.resolve(__dirname, '..');
const OPENCLAW_HOME = path.resolve(WORKSPACE, '..');
const DATA_DIR = path.join(OPENCLAW_HOME, 'data');
const DB_PATH = path.join(DATA_DIR, 'openclaw.db');
const ARCHIVE_V1_DIR = path.join(WORKSPACE, 'archive', 'v1');
const LEGACY_DB_BACKUP_PATH = path.join(ARCHIVE_V1_DIR, 'data', 'openclaw-pre-v2.db');

const CORE_SCHEMA_VERSION = '003-v2-schema';
const SCHEMA_VERSION = '004-workout-tracking';
const OPEN_STATUSES = ['doing', 'next', 'parked', 'someday'];
const ALL_STATUSES = [...OPEN_STATUSES, 'done', 'dropped'];

const CORE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'next',
    area TEXT,
    project TEXT,
    context TEXT,
    due TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    done_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    area TEXT,
    summary TEXT NOT NULL,
    details TEXT,
    content_worthy INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_area ON tasks(area);
  CREATE INDEX IF NOT EXISTS idx_activity_date ON activity(date DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_content ON activity(content_worthy) WHERE content_worthy = 1;
`;

const WORKOUT_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS workout_sessions (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    session_type TEXT NOT NULL,
    title TEXT,
    summary TEXT NOT NULL,
    duration_minutes INTEGER,
    intensity TEXT,
    source TEXT,
    raw_text TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) STRICT;

  CREATE TABLE IF NOT EXISTS workout_exercises (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    exercise_name TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    category TEXT,
    sequence INTEGER NOT NULL,
    notes TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_workout_sessions_date ON workout_sessions(date DESC);
  CREATE INDEX IF NOT EXISTS idx_workout_sessions_type ON workout_sessions(session_type);
  CREATE INDEX IF NOT EXISTS idx_workout_exercises_session ON workout_exercises(session_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_workout_exercises_name ON workout_exercises(canonical_name, session_id);
`;

const CURRENT_SCHEMA_SQL = `${CORE_SCHEMA_SQL}
${WORKOUT_SCHEMA_SQL}`;

let dbSingleton = null;

function nowIso() {
  return new Date().toISOString();
}

function todayDate() {
  return nowIso().slice(0, 10);
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function normalizeText(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeDate(value) {
  const date = normalizeText(value);
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Expected YYYY-MM-DD date, received "${value}".`);
  }
  return date;
}

function normalizeStatus(value, fallback = 'next') {
  const status = normalizeText(value);
  if (!status) return fallback;
  const normalized = status.toLowerCase();
  if (!ALL_STATUSES.includes(normalized)) {
    throw new Error(
      `Invalid status "${value}". Use one of: ${ALL_STATUSES.join(', ')}.`
    );
  }
  return normalized;
}

function normalizeBooleanFlag(value) {
  if (value === true) return 1;
  if (value == null || value === false) return 0;

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return 1;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return 0;
  throw new Error(`Invalid boolean value "${value}".`);
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

function splitCsv(value) {
  if (value == null || value === '') return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseInteger(value, flagName) {
  if (value == null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer for ${flagName}.`);
  }
  return parsed;
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
}

function tableExists(db, tableName) {
  const row = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `
    )
    .get(tableName);
  return Boolean(row);
}

function listTableColumns(db, tableName) {
  if (!tableExists(db, tableName)) return [];
  const escapedTableName = tableName.replace(/"/g, '""');
  return db.prepare(`PRAGMA table_info("${escapedTableName}")`).all().map((row) => row.name);
}

function hasV2CoreSchema(db) {
  const expectedTaskColumns = [
    'id',
    'title',
    'status',
    'area',
    'project',
    'context',
    'due',
    'created_at',
    'updated_at',
    'done_at',
  ];
  const expectedActivityColumns = [
    'id',
    'date',
    'area',
    'summary',
    'details',
    'content_worthy',
    'created_at',
  ];

  const taskColumns = listTableColumns(db, 'tasks');
  const activityColumns = listTableColumns(db, 'activity');

  return (
    expectedTaskColumns.every((column) => taskColumns.includes(column)) &&
    expectedActivityColumns.every((column) => activityColumns.includes(column))
  );
}

function hasWorkoutSchema(db) {
  const expectedSessionColumns = [
    'id',
    'date',
    'session_type',
    'title',
    'summary',
    'duration_minutes',
    'intensity',
    'source',
    'raw_text',
    'metadata_json',
    'created_at',
    'updated_at',
  ];
  const expectedExerciseColumns = [
    'id',
    'session_id',
    'exercise_name',
    'canonical_name',
    'category',
    'sequence',
    'notes',
    'payload_json',
    'created_at',
  ];

  const sessionColumns = listTableColumns(db, 'workout_sessions');
  const exerciseColumns = listTableColumns(db, 'workout_exercises');

  return (
    expectedSessionColumns.every((column) => sessionColumns.includes(column)) &&
    expectedExerciseColumns.every((column) => exerciseColumns.includes(column))
  );
}

function hasCurrentSchema(db) {
  return hasV2CoreSchema(db) && hasWorkoutSchema(db);
}

function hasLegacySchema(db) {
  if (
    tableExists(db, 'projects') ||
    tableExists(db, 'daily_logs') ||
    tableExists(db, 'content_items')
  ) {
    return true;
  }

  const legacyTaskColumns = [
    'priority',
    'project_id',
    'due_date',
    'source_ref',
    'notes',
    'metadata_json',
    'completed_at',
  ];
  const taskColumns = listTableColumns(db, 'tasks');
  return legacyTaskColumns.some((column) => taskColumns.includes(column));
}

function listMigrations(db) {
  ensureMigrationTable(db);
  return db
    .prepare('SELECT id, applied_at AS appliedAt FROM schema_migrations ORDER BY id')
    .all();
}

function backupLegacyDatabase(db) {
  if (fs.existsSync(LEGACY_DB_BACKUP_PATH)) {
    return LEGACY_DB_BACKUP_PATH;
  }

  const userTables = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name != 'schema_migrations'
      `
    )
    .all()
    .map((row) => row.name);

  if (!userTables.length) {
    return null;
  }

  ensureDir(path.dirname(LEGACY_DB_BACKUP_PATH));
  db.exec('PRAGMA wal_checkpoint(FULL);');
  db.exec(`VACUUM INTO '${escapeSqlString(LEGACY_DB_BACKUP_PATH)}'`);
  return LEGACY_DB_BACKUP_PATH;
}

function rebuildCurrentSchema(db) {
  db.exec('BEGIN');
  try {
    db.exec(`
      DROP TABLE IF EXISTS workout_exercises;
      DROP TABLE IF EXISTS workout_sessions;
      DROP TABLE IF EXISTS activity;
      DROP TABLE IF EXISTS content_items;
      DROP TABLE IF EXISTS daily_logs;
      DROP TABLE IF EXISTS projects;
      DROP TABLE IF EXISTS tasks;
      DELETE FROM schema_migrations;
    `);
    db.exec(CURRENT_SCHEMA_SQL);
    db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
      SCHEMA_VERSION,
      nowIso()
    );
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures and rethrow the original error.
    }
    throw error;
  }
}

function applyWorkoutSchemaMigration(db, applied = new Set()) {
  if (hasWorkoutSchema(db) && applied.has(SCHEMA_VERSION)) {
    return;
  }

  db.exec('BEGIN');
  try {
    db.exec(WORKOUT_SCHEMA_SQL);
    if (!applied.has(SCHEMA_VERSION)) {
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        SCHEMA_VERSION,
        nowIso()
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures and rethrow the original error.
    }
    throw error;
  }
}

function ensureCurrentSchema(db) {
  ensureMigrationTable(db);
  const applied = new Set(listMigrations(db).map((migration) => migration.id));
  if (hasCurrentSchema(db) && applied.has(SCHEMA_VERSION)) {
    return;
  }

  const hasLocalTables =
    tableExists(db, 'tasks') ||
    tableExists(db, 'activity') ||
    tableExists(db, 'workout_sessions') ||
    tableExists(db, 'workout_exercises');
  if (!hasLocalTables) {
    rebuildCurrentSchema(db);
    return;
  }

  if (hasLegacySchema(db)) {
    backupLegacyDatabase(db);
    rebuildCurrentSchema(db);
    return;
  }

  if (hasV2CoreSchema(db)) {
    if (!applied.has(CORE_SCHEMA_VERSION)) {
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        CORE_SCHEMA_VERSION,
        nowIso()
      );
      applied.add(CORE_SCHEMA_VERSION);
    }
    applyWorkoutSchemaMigration(db, applied);
    return;
  }

  rebuildCurrentSchema(db);
}

function openDb() {
  if (dbSingleton && dbSingleton.isOpen) {
    return dbSingleton;
  }

  ensureDir(DATA_DIR);
  const db = new DatabaseSync(DB_PATH, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
  `);
  ensureCurrentSchema(db);
  dbSingleton = db;
  return dbSingleton;
}

function closeDb() {
  if (dbSingleton && dbSingleton.isOpen) {
    dbSingleton.close();
  }
  dbSingleton = null;
}

function buildInClause(column, values, baseName, params) {
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

  return `${column} IN (${placeholders.join(', ')})`;
}

function taskOrderBy() {
  return `
    ORDER BY
      CASE status
        WHEN 'doing' THEN 0
        WHEN 'next' THEN 1
        WHEN 'parked' THEN 2
        WHEN 'someday' THEN 3
        WHEN 'done' THEN 4
        WHEN 'dropped' THEN 5
        ELSE 6
      END,
      CASE WHEN due IS NULL OR due = '' THEN 1 ELSE 0 END,
      due ASC,
      title COLLATE NOCASE ASC
  `;
}

function mapTaskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    area: row.area,
    project: row.project,
    context: row.context,
    due: row.due,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    doneAt: row.doneAt,
  };
}

function mapActivityRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    area: row.area,
    summary: row.summary,
    details: row.details,
    contentWorthy: Boolean(row.contentWorthy),
    createdAt: row.createdAt,
  };
}

function normalizeTaskInput(task = {}) {
  const title = normalizeText(task.title);
  if (!title) {
    throw new Error('Task title is required.');
  }

  const updatedAt = task.updatedAt || nowIso();
  const status = normalizeStatus(task.status, 'next');
  const doneAt = status === 'done' ? normalizeText(task.doneAt) || updatedAt : null;

  return {
    id: normalizeText(task.id) || crypto.randomUUID(),
    title,
    status,
    area: normalizeText(task.area),
    project: normalizeText(task.project),
    context: normalizeText(task.context),
    due: normalizeDate(task.due),
    createdAt: normalizeText(task.createdAt) || updatedAt,
    updatedAt,
    doneAt,
  };
}

function normalizeActivityInput(entry = {}) {
  const summary = normalizeText(entry.summary);
  if (!summary) {
    throw new Error('Activity summary is required.');
  }

  return {
    date: normalizeDate(entry.date) || todayDate(),
    area: normalizeText(entry.area),
    summary,
    details: normalizeText(entry.details),
    contentWorthy: normalizeBooleanFlag(entry.contentWorthy),
    createdAt: normalizeText(entry.createdAt) || nowIso(),
  };
}

function getTask(id) {
  const db = openDb();
  const row = db
    .prepare(
      `
        SELECT
          id,
          title,
          status,
          area,
          project,
          context,
          due,
          created_at AS createdAt,
          updated_at AS updatedAt,
          done_at AS doneAt
        FROM tasks
        WHERE id = ?
      `
    )
    .get(id);
  return mapTaskRow(row);
}

function upsertTask(task) {
  const db = openDb();
  const input = normalizeTaskInput(task);
  db.prepare(
    `
      INSERT INTO tasks (
        id,
        title,
        status,
        area,
        project,
        context,
        due,
        created_at,
        updated_at,
        done_at
      ) VALUES (
        @id,
        @title,
        @status,
        @area,
        @project,
        @context,
        @due,
        @createdAt,
        @updatedAt,
        @doneAt
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        area = excluded.area,
        project = excluded.project,
        context = excluded.context,
        due = excluded.due,
        updated_at = excluded.updated_at,
        done_at = excluded.done_at
    `
  ).run(input);
  return getTask(input.id);
}

function updateTask(id, updates = {}) {
  const existing = getTask(id);
  if (!existing) {
    throw new Error(`Task not found: ${id}`);
  }

  return upsertTask({
    ...existing,
    ...updates,
    id,
    createdAt: existing.createdAt,
    updatedAt: updates.updatedAt || nowIso(),
  });
}

function completeTask(id, completedAt = nowIso()) {
  return updateTask(id, {
    status: 'done',
    doneAt: completedAt,
    updatedAt: completedAt,
  });
}

function dropTask(id, droppedAt = nowIso()) {
  return updateTask(id, {
    status: 'dropped',
    doneAt: null,
    updatedAt: droppedAt,
  });
}

function listTasks(filters = {}) {
  const db = openDb();
  const clauses = [];
  const params = {};

  let statuses = filters.status;
  if (statuses === undefined) {
    statuses = OPEN_STATUSES;
  }
  if (statuses !== null) {
    const normalizedStatuses = (Array.isArray(statuses) ? statuses : [statuses]).map((status) =>
      normalizeStatus(status)
    );
    const statusClause = buildInClause('status', normalizedStatuses, 'status', params);
    if (statusClause) clauses.push(statusClause);
  }

  const area = normalizeText(filters.area);
  if (area) {
    clauses.push('area = @area');
    params.area = area;
  }

  const project = normalizeText(filters.project);
  if (project) {
    clauses.push('project = @project');
    params.project = project;
  }

  const search = normalizeText(filters.search);
  if (search) {
    clauses.push('(title LIKE @search OR COALESCE(context, \'\') LIKE @search)');
    params.search = `%${search}%`;
  }

  const dueOnOrBefore = normalizeDate(filters.dueOnOrBefore);
  if (dueOnOrBefore) {
    clauses.push("COALESCE(due, '') <> '' AND due <= @dueOnOrBefore");
    params.dueOnOrBefore = dueOnOrBefore;
  }

  const limit = parseInteger(filters.limit, '--limit');
  const limitClause = limit && limit > 0 ? ` LIMIT ${limit}` : '';
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
        SELECT
          id,
          title,
          status,
          area,
          project,
          context,
          due,
          created_at AS createdAt,
          updated_at AS updatedAt,
          done_at AS doneAt
        FROM tasks
        ${where}
        ${taskOrderBy()}
        ${limitClause}
      `
    )
    .all(params);

  return rows.map(mapTaskRow);
}

function listOpenTasks(filters = {}) {
  return listTasks({
    ...filters,
    status: OPEN_STATUSES,
  });
}

function listActivity(filters = {}) {
  const db = openDb();
  const clauses = [];
  const params = {};

  const days = filters.days == null ? 14 : parseInteger(filters.days, '--days');
  if (days && days > 0) {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
    params.cutoff = cutoff.toISOString().slice(0, 10);
    clauses.push('date >= @cutoff');
  }

  const area = normalizeText(filters.area);
  if (area) {
    clauses.push('area = @area');
    params.area = area;
  }

  if (filters.contentWorthy) {
    clauses.push('content_worthy = 1');
  }

  const limit = parseInteger(filters.limit, '--limit');
  const limitClause = limit && limit > 0 ? ` LIMIT ${limit}` : '';
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(
      `
        SELECT
          id,
          date,
          area,
          summary,
          details,
          content_worthy AS contentWorthy,
          created_at AS createdAt
        FROM activity
        ${where}
        ORDER BY date DESC, id DESC
        ${limitClause}
      `
    )
    .all(params);

  return rows.map(mapActivityRow);
}

function logActivity(summary, options = {}) {
  const db = openDb();
  const input = normalizeActivityInput({
    ...options,
    summary,
  });

  const result = db
    .prepare(
      `
        INSERT INTO activity (
          date,
          area,
          summary,
          details,
          content_worthy,
          created_at
        ) VALUES (
          @date,
          @area,
          @summary,
          @details,
          @contentWorthy,
          @createdAt
        )
      `
    )
    .run(input);

  const row = db
    .prepare(
      `
        SELECT
          id,
          date,
          area,
          summary,
          details,
          content_worthy AS contentWorthy,
          created_at AS createdAt
        FROM activity
        WHERE id = ?
      `
    )
    .get(result.lastInsertRowid);

  return mapActivityRow(row);
}

function getStatusSummary() {
  const db = openDb();
  const taskCounts = Object.fromEntries(ALL_STATUSES.map((status) => [status, 0]));
  const taskCountRows = db
    .prepare('SELECT status, COUNT(*) AS count FROM tasks GROUP BY status ORDER BY status')
    .all();
  for (const row of taskCountRows) {
    taskCounts[row.status] = row.count;
  }

  const totalTasks = Object.values(taskCounts).reduce((sum, count) => sum + count, 0);
  const openTasks = OPEN_STATUSES.reduce((sum, status) => sum + (taskCounts[status] || 0), 0);
  const activityTotal = db.prepare('SELECT COUNT(*) AS count FROM activity').get().count;
  const workoutSessionTotal = db.prepare('SELECT COUNT(*) AS count FROM workout_sessions').get().count;
  const workoutExerciseTotal = db.prepare('SELECT COUNT(*) AS count FROM workout_exercises').get().count;
  const activityLast7Days = listActivity({ days: 7 }).length;
  const contentWorthyLast14Days = listActivity({ days: 14, contentWorthy: true }).length;

  return {
    dbPath: DB_PATH,
    workspaceRoot: WORKSPACE,
    openclawHome: OPENCLAW_HOME,
    schemaVersion: SCHEMA_VERSION,
    legacyBackupPath: fs.existsSync(LEGACY_DB_BACKUP_PATH) ? LEGACY_DB_BACKUP_PATH : null,
    tables: {
      tasks: totalTasks,
      activity: activityTotal,
      workoutSessions: workoutSessionTotal,
      workoutExercises: workoutExerciseTotal,
    },
    taskCounts: {
      total: totalTasks,
      open: openTasks,
      byStatus: taskCounts,
    },
    activityCounts: {
      total: activityTotal,
      last7Days: activityLast7Days,
      contentWorthyLast14Days,
    },
    migrations: listMigrations(db),
  };
}

function printUsage() {
  console.log(`OpenClaw local DB

Commands:
  summary [--json]
  tasks [--status doing,next] [--area fence] [--project fence] [--limit 10] [--json]
  task:add --title "..." [--area ...] [--status ...] [--due YYYY-MM-DD] [--context "..."] [--project ...] [--json]
  task:done <id> [--json]
  task:drop <id> [--json]
  task:update <id> [--title ...] [--status ...] [--area ...] [--due ...] [--context ...] [--project ...] [--json]
  activity [--days 7] [--area ...] [--content-worthy] [--json]
  log "summary" [--area ...] [--content-worthy] [--details "..."] [--json]
`);
}

function printTask(task) {
  const area = task.area ? ` | ${task.area}` : '';
  const project = task.project ? ` | ${task.project}` : '';
  const due = task.due ? ` | due ${task.due}` : '';
  console.log(`[${task.status}] ${task.id}${area}${project}${due} | ${task.title}`);
}

function printActivity(entry) {
  const area = entry.area ? ` | ${entry.area}` : '';
  const content = entry.contentWorthy ? ' | content' : '';
  console.log(`${entry.date} | ${entry.id}${area}${content} | ${entry.summary}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'summary';
  const asJson = Boolean(args.json);

  try {
    if (command === 'summary') {
      const summary = getStatusSummary();
      if (asJson) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log(`DB: ${summary.dbPath}`);
        console.log(`Schema: ${summary.schemaVersion}`);
        console.log(`Tasks: ${summary.taskCounts.total} total | ${summary.taskCounts.open} open`);
        console.log(
          `Status counts: ${ALL_STATUSES.map((status) => `${status}=${summary.taskCounts.byStatus[status] || 0}`).join(', ')}`
        );
        console.log(
          `Activity: ${summary.activityCounts.total} total | ${summary.activityCounts.last7Days} in last 7 days | ${summary.activityCounts.contentWorthyLast14Days} content-worthy in last 14 days`
        );
        console.log(
          `Workouts: ${summary.tables.workoutSessions} sessions | ${summary.tables.workoutExercises} exercise entries`
        );
        if (summary.legacyBackupPath) {
          console.log(`Legacy backup: ${summary.legacyBackupPath}`);
        }
      }
      return;
    }

    if (command === 'tasks' || command === 'open-tasks') {
      const payload = {
        tasks: listTasks({
          status:
            command === 'open-tasks'
              ? OPEN_STATUSES
              : args.all
                ? null
                : args.status
                  ? splitCsv(args.status)
                  : undefined,
          area: args.area,
          project: args.project,
          limit: args.limit,
        }),
      };

      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else if (!payload.tasks.length) {
        console.log('No tasks matched.');
      } else {
        payload.tasks.forEach(printTask);
      }
      return;
    }

    if (command === 'task:add') {
      const task = upsertTask({
        title: args.title || args._.slice(1).join(' '),
        status: args.status || 'next',
        area: args.area,
        project: args.project,
        context: args.context,
        due: args.due,
      });

      if (asJson) {
        console.log(JSON.stringify(task, null, 2));
      } else {
        printTask(task);
      }
      return;
    }

    if (command === 'task:done') {
      const id = args._[1];
      if (!id) throw new Error('Task id is required.');
      const task = completeTask(id);
      if (asJson) {
        console.log(JSON.stringify(task, null, 2));
      } else {
        printTask(task);
      }
      return;
    }

    if (command === 'task:drop') {
      const id = args._[1];
      if (!id) throw new Error('Task id is required.');
      const task = dropTask(id);
      if (asJson) {
        console.log(JSON.stringify(task, null, 2));
      } else {
        printTask(task);
      }
      return;
    }

    if (command === 'task:update') {
      const id = args._[1];
      if (!id) throw new Error('Task id is required.');

      const updates = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.status !== undefined) updates.status = args.status;
      if (args.area !== undefined) updates.area = args.area;
      if (args.project !== undefined) updates.project = args.project;
      if (args.context !== undefined) updates.context = args.context;
      if (args.due !== undefined) updates.due = args.due;
      if (!Object.keys(updates).length) {
        throw new Error('Provide at least one field to update.');
      }

      const task = updateTask(id, updates);
      if (asJson) {
        console.log(JSON.stringify(task, null, 2));
      } else {
        printTask(task);
      }
      return;
    }

    if (command === 'activity') {
      const payload = {
        activity: listActivity({
          days: args.days,
          area: args.area,
          contentWorthy: Boolean(args['content-worthy']),
          limit: args.limit,
        }),
      };

      if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
      } else if (!payload.activity.length) {
        console.log('No activity matched.');
      } else {
        payload.activity.forEach(printActivity);
      }
      return;
    }

    if (command === 'log') {
      const summary = args._.slice(1).join(' ');
      const entry = logActivity(summary, {
        area: args.area,
        details: args.details,
        contentWorthy: Boolean(args['content-worthy']),
        date: args.date,
      });

      if (asJson) {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        printActivity(entry);
      }
      return;
    }

    printUsage();
    process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

module.exports = {
  ARCHIVE_V1_DIR,
  DATA_DIR,
  DB_PATH,
  LEGACY_DB_BACKUP_PATH,
  OPENCLAW_HOME,
  OPEN_STATUSES,
  SCHEMA_VERSION,
  WORKSPACE,
  closeDb,
  completeTask,
  dropTask,
  getStatusSummary,
  getTask,
  listActivity,
  listOpenTasks,
  listTasks,
  logActivity,
  nowIso,
  openDb,
  todayDate,
  updateTask,
  upsertTask,
};

if (require.main === module) {
  main();
}
