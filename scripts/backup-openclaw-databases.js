#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const localDb = require('./db');

const BACKUP_ROOT = path.join(localDb.WORKSPACE, 'backups', 'databases');
const MANIFEST_PATH = path.join(BACKUP_ROOT, 'manifest.json');
const SUPPORTED_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3']);

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function safeUnlink(targetPath) {
  try {
    fs.unlinkSync(targetPath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function hashFile(targetPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(targetPath)).digest('hex');
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function listDatabaseFiles() {
  ensureDir(localDb.DATA_DIR);
  return fs
    .readdirSync(localDb.DATA_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    )
    .map((entry) => ({
      name: entry.name,
      sourcePath: path.join(localDb.DATA_DIR, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createSnapshot(sourcePath, tempPath) {
  safeUnlink(tempPath);

  const db = new DatabaseSync(sourcePath, { timeout: 5000 });
  try {
    db.exec('PRAGMA wal_checkpoint(FULL);');
    db.exec(`VACUUM INTO '${escapeSqlString(tempPath)}'`);
  } finally {
    db.close();
  }
}

function isSameSnapshot(candidatePath, existingPath) {
  if (!fs.existsSync(existingPath)) {
    return false;
  }

  const candidateStat = fs.statSync(candidatePath);
  const existingStat = fs.statSync(existingPath);
  if (candidateStat.size !== existingStat.size) {
    return false;
  }

  return hashFile(candidatePath) === hashFile(existingPath);
}

function removeStaleBackups(liveNames) {
  if (!fs.existsSync(BACKUP_ROOT)) {
    return [];
  }

  const removed = [];
  for (const entry of fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === path.basename(MANIFEST_PATH)) continue;
    if (!SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    if (liveNames.has(entry.name)) continue;

    fs.unlinkSync(path.join(BACKUP_ROOT, entry.name));
    removed.push(entry.name);
  }

  return removed.sort((left, right) => left.localeCompare(right));
}

function buildManifestEntry({
  name,
  sourcePath,
  backupPath,
  sourceModifiedAt,
  snapshotAt,
  sizeBytes,
  sha256,
}) {
  return {
    name,
    sourcePath,
    backupPath,
    sourceModifiedAt,
    snapshotAt,
    sizeBytes,
    sha256,
  };
}

function syncDatabaseBackups() {
  ensureDir(BACKUP_ROOT);

  const previousManifest = readManifest();
  const previousEntries = new Map(
    Array.isArray(previousManifest && previousManifest.databases)
      ? previousManifest.databases.map((entry) => [entry.name, entry])
      : []
  );

  const databaseFiles = listDatabaseFiles();
  const liveNames = new Set(databaseFiles.map((entry) => entry.name));
  const removedBackups = removeStaleBackups(liveNames);
  const nowIso = new Date().toISOString();

  const updatedBackups = [];
  const databases = [];

  for (const entry of databaseFiles) {
    const backupPath = path.join(BACKUP_ROOT, entry.name);
    const tempPath = `${backupPath}.tmp-${process.pid}`;

    createSnapshot(entry.sourcePath, tempPath);

    const snapshotChanged = !isSameSnapshot(tempPath, backupPath);
    if (snapshotChanged) {
      fs.renameSync(tempPath, backupPath);
      updatedBackups.push(entry.name);
    } else {
      safeUnlink(tempPath);
    }

    const snapshotStat = fs.statSync(backupPath);
    const snapshotHash = hashFile(backupPath);
    const previousEntry = previousEntries.get(entry.name);
    const sourceStat = fs.statSync(entry.sourcePath);

    databases.push(
      buildManifestEntry({
        name: entry.name,
        sourcePath: path.relative(localDb.WORKSPACE, entry.sourcePath),
        backupPath: path.relative(localDb.WORKSPACE, backupPath),
        sourceModifiedAt: sourceStat.mtime.toISOString(),
        snapshotAt: snapshotChanged ? nowIso : previousEntry && previousEntry.snapshotAt
          ? previousEntry.snapshotAt
          : nowIso,
        sizeBytes: snapshotStat.size,
        sha256: snapshotHash,
      })
    );
  }

  const generatedAt =
    updatedBackups.length || removedBackups.length
      ? nowIso
      : previousManifest && previousManifest.generatedAt
        ? previousManifest.generatedAt
        : nowIso;

  const nextManifest = {
    version: 1,
    format: 'sqlite-vacuum-into',
    sourceDir: path.relative(localDb.WORKSPACE, localDb.DATA_DIR),
    backupDir: path.relative(localDb.WORKSPACE, BACKUP_ROOT),
    generatedAt,
    databases,
  };

  const nextManifestText = `${JSON.stringify(nextManifest, null, 2)}\n`;
  const previousManifestText = fs.existsSync(MANIFEST_PATH)
    ? fs.readFileSync(MANIFEST_PATH, 'utf8')
    : null;
  const manifestChanged = nextManifestText !== previousManifestText;

  if (manifestChanged) {
    fs.writeFileSync(MANIFEST_PATH, nextManifestText);
  }

  return {
    backupRoot: BACKUP_ROOT,
    databaseFiles,
    updatedBackups,
    removedBackups,
    manifestChanged,
  };
}

function main() {
  const result = syncDatabaseBackups();

  if (!result.databaseFiles.length && !result.removedBackups.length) {
    console.log(`No databases found in ${localDb.DATA_DIR}.`);
    return;
  }

  for (const name of result.updatedBackups) {
    console.log(`Updated database snapshot: ${name}`);
  }

  for (const name of result.removedBackups) {
    console.log(`Removed stale database snapshot: ${name}`);
  }

  if (
    !result.updatedBackups.length &&
    !result.removedBackups.length &&
    !result.manifestChanged
  ) {
    console.log('Database backups are already up to date.');
    return;
  }

  if (
    !result.updatedBackups.length &&
    !result.removedBackups.length &&
    result.manifestChanged
  ) {
    console.log('Database backup manifest refreshed.');
    return;
  }

  console.log(
    `Database backup summary: ${result.updatedBackups.length} updated, ${result.removedBackups.length} removed.`
  );
}

module.exports = {
  BACKUP_ROOT,
  MANIFEST_PATH,
  syncDatabaseBackups,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
