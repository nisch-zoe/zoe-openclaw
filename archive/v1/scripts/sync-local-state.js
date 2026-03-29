#!/usr/bin/env node

const db = require('./db');
const managerState = require('./manager-state');

function summarizePriority(priority) {
  return {
    taskKey: priority.taskKey,
    title: priority.title,
    status: priority.status,
    area: priority.area || null,
    priority: priority.priority || null,
    dueDate: priority.dueDate || null,
    slipCount: priority.slipCount || 0,
  };
}

function summarizeCompletedTask(task) {
  return {
    taskKey: task.taskKey,
    title: task.title,
    area: task.area || null,
    completedAt: task.completedAt || null,
  };
}

function buildDailyLogPayload({ date, dashboard, ideasState, archivedSignalCount = null }) {
  const existing = db.getDailyLog(date);
  const existingContext = existing?.context || {};
  const isToday = date === dashboard.today.date;
  const recentDay = (dashboard.momentum.recentDays || []).find((entry) => entry.date === date) || null;
  const dailyFields = isToday ? managerState.buildDailySummaryFields(dashboard, ideasState) : null;

  const fitnessSessions = Array.isArray(recentDay?.fitnessSessions)
    ? recentDay.fitnessSessions
    : isToday
      ? Array.from(new Set(dashboard.context.fitnessDone || []))
      : Array.isArray(existingContext.fitnessSessions)
        ? existingContext.fitnessSessions
        : [];

  const touchedAreas = Array.isArray(recentDay?.touchedAreas)
    ? recentDay.touchedAreas
    : Array.isArray(existingContext.touchedAreas)
      ? existingContext.touchedAreas
      : [];

  const context = {
    ...existingContext,
    archivedSignalCount:
      archivedSignalCount === null ? existingContext.archivedSignalCount || 0 : archivedSignalCount,
    metrics: isToday ? dailyFields.metrics : existingContext.metrics || null,
    workLoad: recentDay?.workLoad ?? (isToday ? dashboard.context.workLoad : existingContext.workLoad ?? null),
    sleepQuality:
      recentDay?.sleepQuality ??
      (isToday ? dashboard.context.sleepQuality : existingContext.sleepQuality ?? null),
    energyLevel:
      recentDay?.energyLevel ?? (isToday ? dashboard.context.energyLevel : existingContext.energyLevel ?? null),
    mood: isToday ? dashboard.context.mood || existingContext.mood || null : existingContext.mood || null,
    fitnessIntent:
      isToday ? dashboard.context.fitnessIntent || existingContext.fitnessIntent || null : existingContext.fitnessIntent || null,
    fitnessSessions,
    touchedAreas,
    completedCount: isToday
      ? dashboard.today.completed.length
      : recentDay?.completedCount ?? existingContext.completedCount ?? 0,
    plannedCount: isToday
      ? dashboard.today.priorities.length
      : recentDay?.plannedCount ?? existingContext.plannedCount ?? 0,
    ideaInboxCount: managerState.countIdeasByStatus(ideasState, 'inbox'),
    currentFocusNote: dashboard.life.currentFocusNote || null,
    priorities: isToday
      ? dashboard.today.priorities.map(summarizePriority)
      : Array.isArray(existingContext.priorities)
        ? existingContext.priorities
        : [],
    completed: isToday
      ? dashboard.today.completed.map(summarizeCompletedTask)
      : Array.isArray(existingContext.completed)
        ? existingContext.completed
        : [],
  };

  return {
    date,
    summary:
      isToday
        ? dailyFields.summary
        : existing?.summary || (archivedSignalCount ? 'Manager archive updated from local signals.' : null),
    blockers: isToday ? dailyFields.blockers : existing?.blockers || null,
    nextPriority: isToday ? dailyFields.nextPriority : existing?.nextPriority || null,
    context,
  };
}

function upsertLocalDailyLog({ date, dashboard, ideasState, archivedSignalCount = null }) {
  const payload = buildDailyLogPayload({
    date,
    dashboard,
    ideasState,
    archivedSignalCount,
  });
  return db.upsertDailyLog(payload);
}

function syncCompletedTasks(dashboard, taskKeys) {
  const completionByKey = new Map(
    (dashboard.today.completed || []).map((item) => [item.taskKey, item.completedAt || managerState.nowIso()])
  );
  const uniqueKeys = Array.from(new Set((taskKeys || []).filter(Boolean)));
  const results = [];

  for (const taskKey of uniqueKeys) {
    try {
      const existing = db.getTask(taskKey);
      if (!existing) {
        results.push({
          taskKey,
          error: 'Task not found in local DB.',
        });
        continue;
      }

      if (existing.status === 'Done') {
        results.push({
          taskKey,
          title: existing.title,
        });
        continue;
      }

      const completedTask = db.completeTask(taskKey, completionByKey.get(taskKey) || managerState.nowIso());
      results.push({
        taskKey,
        title: completedTask?.title || existing.title,
      });
    } catch (error) {
      results.push({
        taskKey,
        error: error.message || String(error),
      });
    }
  }

  return results;
}

function syncLocalState({ archiveOnly = false } = {}) {
  managerState.ensureStateFiles();

  const dashboard = managerState.loadDashboard();
  const ideasState = managerState.loadIdeas();
  const archiveState = managerState.loadArchive();

  managerState.rolloverDashboardIfNeeded(dashboard);

  const signals = managerState.collectUnsyncedSignals(archiveState);
  const applyResult = managerState.applySignalsToState({
    dashboard,
    ideasState,
    signals,
  });

  const taskResults = archiveOnly ? [] : syncCompletedTasks(dashboard, applyResult.completedTaskKeys);

  const archivedSignalCounts = {};
  for (const signal of signals) {
    archivedSignalCounts[signal.localDate] = (archivedSignalCounts[signal.localDate] || 0) + 1;
  }

  const dailyLogDates = Array.from(new Set([...Object.keys(archivedSignalCounts), dashboard.today.date])).sort();
  for (const date of dailyLogDates) {
    upsertLocalDailyLog({
      date,
      dashboard,
      ideasState,
      archivedSignalCount: archivedSignalCounts[date] || null,
    });
  }

  if (signals.length) {
    managerState.rememberSignals(archiveState, signals);
  }
  dashboard.archive.lastSignalSyncAt = managerState.nowIso();

  const memoryNotes = [];
  if (applyResult.newIdeas.length) {
    memoryNotes.push(`Captured ${applyResult.newIdeas.length} new idea(s).`);
  }
  if (applyResult.completedTaskKeys.length) {
    memoryNotes.push(`Marked ${applyResult.completedTaskKeys.length} tracked priority item(s) done from chat.`);
  }
  if (applyResult.contextTouched) {
    memoryNotes.push(
      `Updated day context: work=${dashboard.context.workLoad || 'unknown'}, sleep=${dashboard.context.sleepQuality || 'unknown'}, energy=${dashboard.context.energyLevel || 'unknown'}.`
    );
  }
  if (applyResult.latestStrategyUpdate) {
    memoryNotes.push('Refreshed focus note from chat.');
  }
  if (signals.length) {
    memoryNotes.push(`Archived ${signals.length} user message(s) into local daily logs.`);
  }
  const taskSuccessCount = taskResults.filter((result) => !result.error).length;
  if (taskSuccessCount) {
    memoryNotes.push(`Synced ${taskSuccessCount} task completion update(s) into the local DB.`);
  }
  if (memoryNotes.length) {
    managerState.appendDailyMemoryNotes(dashboard.today.date, 'Manager Sync', memoryNotes);
  }

  managerState.saveDashboard(dashboard);
  managerState.saveIdeas(ideasState);
  managerState.saveArchive(archiveState);
  db.closeDb();

  return {
    date: dashboard.today.date,
    archivedSignals: signals.length,
    newIdeas: applyResult.newIdeas.length,
    completedTaskUpdates: applyResult.completedTaskKeys.length,
    localTaskUpdates: taskResults,
    dailyLogDates,
  };
}

function main() {
  const archiveOnly = process.argv.includes('--archive-only');
  const asJson = process.argv.includes('--json');
  const result = syncLocalState({ archiveOnly });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `Synced local manager state: ${result.archivedSignals} message(s), ${result.newIdeas} idea(s), ${result.completedTaskUpdates} completion update(s).`
  );
}

module.exports = {
  buildDailyLogPayload,
  syncCompletedTasks,
  syncLocalState,
  upsertLocalDailyLog,
};

if (require.main === module) {
  main();
}
