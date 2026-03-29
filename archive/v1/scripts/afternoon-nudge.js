#!/usr/bin/env node

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
  const candidate = (dashboard.today.priorities || []).find(
    (priority) => priority.status !== 'done' && priority.priority === 'P0' && (priority.slipCount || 0) >= 2
  );

  if (!candidate) {
    return {
      message: 'NO_REPLY',
      syncError,
      candidate: null,
    };
  }

  let message = `Quick check. ${candidate.title} has slipped ${candidate.slipCount} times now. Is something blocking it, or should we deliberately move it?`;
  if (syncError) {
    message += ' Local state is still good, but the local archive sync needs another pass.';
  }

  return {
    message,
    syncError,
    candidate,
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
