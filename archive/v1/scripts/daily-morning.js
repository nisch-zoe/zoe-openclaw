#!/usr/bin/env node

const db = require('./db');
const managerState = require('./manager-state');
const localSync = require('./sync-local-state');

function syncPlanTaskUpdates(taskUpdates) {
  const results = [];
  const uniqueUpdates = Array.from(
    new Map((taskUpdates || []).filter((update) => update?.taskKey).map((update) => [update.taskKey, update])).values()
  );

  for (const update of uniqueUpdates) {
    try {
      const task = db.updateTask(update.taskKey, {
        dueDate: update.dueDate || null,
      });
      results.push({
        taskKey: update.taskKey,
        title: task?.title || update.taskKey,
      });
    } catch (error) {
      results.push({
        taskKey: update.taskKey,
        error: error.message || String(error),
      });
    }
  }

  return results;
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
  managerState.rolloverDashboardIfNeeded(dashboard);

  let openTasks = [];
  let tasksError = null;
  try {
    openTasks = db.listOpenTasks();
  } catch (error) {
    tasksError = error.message || String(error);
  }

  const plan = managerState.buildMorningPlan({
    dashboard,
    ideasState,
    openTasks,
    todayDate: managerState.currentLocalDate(),
  });

  const taskUpdateResults = syncPlanTaskUpdates(plan.taskUpdates);
  dashboard.today.morningBriefSentAt = managerState.nowIso();
  managerState.saveDashboard(dashboard);
  localSync.upsertLocalDailyLog({
    date: dashboard.today.date,
    dashboard,
    ideasState,
  });
  db.closeDb();

  let message = managerState.buildMorningMessage(plan, dashboard);
  if (tasksError) {
    message += '\n\nThe local task DB was unavailable, so I leaned on carryover state only.';
  } else if (!openTasks.length) {
    message += '\n\nThe local task DB is empty right now, so today’s plan only used carryover state.';
  }
  if (syncError) {
    message += '\n\nI still built the plan, but the local archive sync needs another pass.';
  }

  const taskUpdateFailures = taskUpdateResults.filter((result) => result.error);
  if (!tasksError && !taskUpdateFailures.length && plan.taskUpdates.length) {
    message += '\n\nI also rolled overdue planned tasks forward in the local DB.';
  } else if (taskUpdateFailures.length) {
    message += '\n\nThe plan is saved, but a few overdue task updates still need a retry in the local DB.';
  }

  return {
    date: plan.date,
    message,
    priorities: plan.priorities,
    openTasksCount: openTasks.length,
    syncError,
    tasksError,
    taskUpdateResults,
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
