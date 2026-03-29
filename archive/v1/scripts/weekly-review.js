#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const managerState = require('./manager-state');
const localSync = require('./sync-local-state');

const WORKSPACE = path.resolve(__dirname, '..');

function isoWeekString(date = new Date()) {
  const working = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = working.getUTCDay() || 7;
  working.setUTCDate(working.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(working.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((working - yearStart) / 86400000 + 1) / 7);
  return `${working.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function writeWeeklyFile(week, review) {
  const dir = path.join(WORKSPACE, 'memory', 'weekly');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${week}.md`);
  const lines = [
    `# Weekly Review: ${week}`,
    '',
    `- Completed tracked wins: ${review.stats.completed}`,
    `- Previous week tracked wins: ${review.stats.previousCompleted}`,
    `- Fitness sessions logged: ${review.stats.fitnessSessions}`,
    `- Idea inbox count: ${review.stats.inboxCount}`,
    '',
    '## Message',
    '',
    review.message,
    '',
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

function buildOutput() {
  managerState.ensureStateFiles();

  let syncError = null;
  try {
    localSync.syncLocalState();
  } catch (error) {
    syncError = error.message || String(error);
  }

  const dashboard = managerState.loadDashboard();
  const ideasState = managerState.loadIdeas();
  const review = managerState.buildWeeklyReview(dashboard, ideasState);
  const week = isoWeekString(new Date());
  const reviewFile = writeWeeklyFile(week, review);

  let message = review.message;
  if (syncError) {
    message += '\n\nLocal archive sync was flaky, so this review leans on local state first.';
  }

  return {
    week,
    message,
    reviewFile,
    stats: review.stats,
    syncError,
  };
}

function main() {
  const output = buildOutput();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  console.log(output.message);
}

main();
