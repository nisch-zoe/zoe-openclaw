#!/usr/bin/env node

const db = require('./db');
const managerState = require('./manager-state');
const localSync = require('./sync-local-state');

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
  managerState.rolloverDashboardIfNeeded(dashboard);

  let message = managerState.buildEveningMessage(dashboard, ideasState);
  if (syncError) {
    message += '\n\nLocal archive sync is behind right now, but I still have the local plan.';
  }

  dashboard.today.eveningPromptSentAt = managerState.nowIso();
  managerState.saveDashboard(dashboard);
  localSync.upsertLocalDailyLog({
    date: dashboard.today.date,
    dashboard,
    ideasState,
  });
  db.closeDb();

  return {
    date: dashboard.today.date,
    message,
    priorities: dashboard.today.priorities,
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
