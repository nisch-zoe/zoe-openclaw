#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const workspace = path.resolve(__dirname, '..');
const heartbeatScript = path.join(workspace, 'scripts', 'fence-heartbeat-check.js');

const run = spawnSync(process.execPath, [heartbeatScript, 'notion', '--json'], {
  cwd: workspace,
  encoding: 'utf8',
  env: process.env,
  timeout: 45000,
});

if (run.error) {
  console.error(`SMOKE_FAIL: ${run.error.message || String(run.error)}`);
  process.exit(1);
}

if (run.status !== 0) {
  const msg = (run.stderr || run.stdout || `exit ${run.status}`).trim();
  console.error(`SMOKE_FAIL: ${msg}`);
  process.exit(1);
}

let out;
try {
  out = JSON.parse((run.stdout || '').trim() || '{}');
} catch (e) {
  console.error(`SMOKE_FAIL: invalid JSON output from heartbeat notion mode`);
  process.exit(1);
}

if (out?.notion?.error) {
  console.error(`SMOKE_FAIL: ${out.notion.error}`);
  process.exit(1);
}

const dueToday = out?.notion?.counts?.dueToday ?? 0;
const changed = out?.notion?.counts?.changed ?? 0;
console.log(`SMOKE_OK notion integration reachable (dueToday=${dueToday}, changed=${changed})`);
