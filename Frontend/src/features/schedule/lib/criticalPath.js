const MINUTES_PER_WORKDAY = 8 * 60;

function dependencyIds(task) {
  const dependencies = task.dependencies?.length
    ? task.dependencies
    : task.dependencyDetails ?? [];
  return dependencies
    .map((dependency) => typeof dependency === "string"
      ? dependency
      : dependency.id ?? dependency.predecessorId)
    .filter(Boolean);
}

function taskDuration(task) {
  const explicitDays = Number(task.durationDays);
  if (Number.isFinite(explicitDays) && explicitDays > 0) return explicitDays;

  const effortMinutes = Number(task.durationMinutes)
    || Number(task.estimatedEffortHours) * 60;
  if (effortMinutes > 0) return Math.max(1, Math.ceil(effortMinutes / MINUTES_PER_WORKDAY));

  const start = new Date(task.baselineStart ?? task.start);
  const end = new Date(task.baselineEnd ?? task.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 1;

  // Count weekdays in the planned date range when no estimate is supplied.
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  let days = 0;
  while (cursor <= last) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(1, days);
}

/** Calculate and attach critical-path flags for one project's schedule tasks.
 *  The supplied task objects are updated in place, matching the schedule's
 *  existing shared-data mutation model. */
export function applyCriticalPath(phases) {
  const tasks = (phases ?? []).flatMap((phase) => phase.tasks ?? []);
  if (!tasks.length) return phases;

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const predecessors = new Map();
  const successors = new Map(tasks.map((task) => [task.id, []]));

  tasks.forEach((task) => {
    const ids = dependencyIds(task).filter((id) => byId.has(id) && id !== task.id);
    predecessors.set(task.id, ids);
    ids.forEach((id) => successors.get(id).push(task.id));
  });

  // Topologically order tasks. A cycle makes CPM undefined, so clear derived
  // flags instead of showing a misleading critical path.
  const ordered = [];
  const visited = new Set();
  const visiting = new Set();
  let hasCycle = false;
  const visit = (id) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      hasCycle = true;
      return;
    }
    visiting.add(id);
    predecessors.get(id).forEach(visit);
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  };
  tasks.forEach((task) => visit(task.id));

  if (hasCycle) {
    tasks.forEach((task) => {
      task.critical = false;
      task.criticalSlackDays = null;
    });
    return phases;
  }

  const durations = new Map(tasks.map((task) => [task.id, taskDuration(task)]));
  const earliestStart = new Map();
  const earliestFinish = new Map();
  ordered.forEach((id) => {
    const start = Math.max(0, ...predecessors.get(id).map((pred) => earliestFinish.get(pred) ?? 0));
    earliestStart.set(id, start);
    earliestFinish.set(id, start + durations.get(id));
  });

  const projectDuration = Math.max(0, ...earliestFinish.values());
  const latestStart = new Map();
  const latestFinish = new Map();
  [...ordered].reverse().forEach((id) => {
    const nextTasks = successors.get(id);
    const finish = nextTasks.length
      ? Math.min(...nextTasks.map((nextId) => latestStart.get(nextId)))
      : projectDuration;
    latestFinish.set(id, finish);
    latestStart.set(id, finish - durations.get(id));
  });

  tasks.forEach((task) => {
    const slack = Math.max(0, latestStart.get(task.id) - earliestStart.get(task.id));
    task.critical = slack === 0;
    task.criticalSlackDays = slack;
  });
  return phases;
}
