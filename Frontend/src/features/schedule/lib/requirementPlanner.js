import { startOfDay } from "./scheduleUtils";
import { addWorkingMinutes, addWorkingDays, endOfWorkingDays, normalizeWorkingStart, workingDaysBetween } from "../context/WorkCalendarContext";

const BASELINE_HOURS_PER_DAY = 8;
const HOURS_PER_STORY_POINT = 4;

export function getTaskEffortMinutes(task, settings) {
  if (Number(task.durationMinutes) > 0) return Number(task.durationMinutes);
  if (Number(task.estimatedEffortHours) > 0) return Number(task.estimatedEffortHours) * 60;
  if (Number(task.durationDays) > 0) return Number(task.durationDays) * BASELINE_HOURS_PER_DAY * 60;
  if (task.start && task.end) return workingDaysBetween(task.start, task.end, [1, 2, 3, 4, 5]) * BASELINE_HOURS_PER_DAY * 60;
  if (Number(task.storyPoints) > 0) return Number(task.storyPoints) * HOURS_PER_STORY_POINT * 60;
  return Math.max(1, Number(settings?.hoursPerDay) || BASELINE_HOURS_PER_DAY) * 60;
}

export function getTaskRemainingEffortMinutes(task, settings) {
  const totalMinutes = getTaskEffortMinutes(task, settings);
  if (task.status === "done") return 0;
  const progress = Math.min(100, Math.max(0, Number(task.progress) || 0));
  return Math.ceil(totalMinutes * (100 - progress) / 100);
}

function dependencyIdsFor(task) {
  return task.dependencies?.length
    ? task.dependencies.map((item) => typeof item === "string" ? item : item.id ?? item.predecessorId).filter(Boolean)
    : (task.dependencyDetails ?? []).map((item) => item.predecessorId).filter(Boolean);
}

function topologicalSort(items, getId, getDependencies) {
  const itemById = new Map(items.map((item) => [getId(item), item]));
  const visited = new Set();
  const visiting = new Set();
  const sorted = [];
  const visit = (item) => {
    const id = getId(item);
    if (visited.has(id) || visiting.has(id)) return;
    visiting.add(id);
    getDependencies(item).map((dependencyId) => itemById.get(dependencyId)).filter(Boolean).forEach(visit);
    visiting.delete(id);
    visited.add(id);
    sorted.push(item);
  };
  [...items].sort((a, b) => new Date(a.start) - new Date(b.start)).forEach(visit);
  return sorted;
}

function sprintWindow(anchor, sprintNumber, sprintDays, settings, firstSprintNumber) {
  const workingDayOffset = (sprintNumber - firstSprintNumber) * sprintDays;
  const start = addWorkingDays(anchor, workingDayOffset, settings.workdays);
  const end = endOfWorkingDays(start, sprintDays, settings.workdays);
  return { start, end, capacityMinutes: sprintDays * settings.hoursPerDay * 60 };
}

export function calculateRequirementSprintPlan(phases, settings, projectStart, firstSprintNumber = 1) {
  const tasks = phases.flatMap((phase) => phase.tasks ?? []);
  if (!tasks.length) return { requirements: [], updates: [], sprintDays: Number(settings.sprintDays) || 10 };

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const groupsById = new Map();
  tasks.forEach((task) => {
    const requirementId = task.requirementId || "unlinked";
    if (!groupsById.has(requirementId)) groupsById.set(requirementId, { id: requirementId, title: task.requirementTitle || task.requirement || requirementId, tasks: [] });
    groupsById.get(requirementId).tasks.push(task);
  });

  const groups = [...groupsById.values()];
  const orderedTasks = topologicalSort(tasks, (task) => task.id, dependencyIdsFor);
  const initial = projectStart ? new Date(projectStart) : new Date(Math.min(...tasks.map((task) => new Date(task.start).getTime())));
  const anchor = startOfDay(initial);
  const sprintDays = Math.max(1, Number(settings.sprintDays) || 10);
  const sprintBase = Math.max(1, Number(firstSprintNumber) || 1);
  const updates = [];
  const scheduledEnds = new Map(tasks.filter((task) => task.status === "done").map((task) => [task.id, task.end]));
  const plannedSprintByTask = new Map(tasks.filter((task) => task.status === "done").map((task) => [task.id, Number.isInteger(task.sprintNumber) ? task.sprintNumber : sprintBase]));
  const minutesBySprint = new Map();
  orderedTasks.forEach((task) => {
    if (task.status === "done") return;
    const remainingDurationMinutes = getTaskRemainingEffortMinutes(task, settings);
    if (remainingDurationMinutes <= 0) return;

    const dependencyIds = dependencyIdsFor(task);
    const dependencyFinishDates = dependencyIds
      .map((id) => scheduledEnds.get(id) ?? tasksById.get(id)?.end)
      .filter(Boolean)
      .map((date) => new Date(date));
    const dependencyFinish = dependencyFinishDates.length
      ? new Date(Math.max(...dependencyFinishDates.map((date) => date.getTime())))
      : anchor;
    const dependencySprint = dependencyIds.reduce((latest, id) => Math.max(latest, plannedSprintByTask.get(id) ?? sprintBase), sprintBase);

    let assignedSprint = dependencySprint;
    let assignedWindow;
    let start;
    let end;
    let overCapacity = false;
    for (let attempt = 0; attempt < 500; attempt += 1) {
      assignedWindow = sprintWindow(anchor, assignedSprint, sprintDays, settings, sprintBase);
      const usedMinutes = minutesBySprint.get(assignedSprint) ?? 0;
      const canFitEffort = usedMinutes + remainingDurationMinutes <= assignedWindow.capacityMinutes;
      const oversizedTask = remainingDurationMinutes > assignedWindow.capacityMinutes && usedMinutes === 0;
      if (!canFitEffort && !oversizedTask) {
        assignedSprint += 1;
        continue;
      }

      const earliestStart = dependencyFinish > assignedWindow.start ? dependencyFinish : assignedWindow.start;
      start = normalizeWorkingStart(earliestStart, settings);
      end = addWorkingMinutes(start, remainingDurationMinutes, settings);
      const windowEnd = new Date(assignedWindow.end);
      windowEnd.setHours(23, 59, 59, 999);
      if (start > windowEnd || (end > windowEnd && !oversizedTask)) {
        assignedSprint += 1;
        continue;
      }
      overCapacity = oversizedTask;
      minutesBySprint.set(assignedSprint, usedMinutes + remainingDurationMinutes);
      break;
    }
    if (!start || !end) return;

    plannedSprintByTask.set(task.id, assignedSprint);
    updates.push({ task, start: start.toISOString(), end: end.toISOString(), durationMinutes: getTaskEffortMinutes(task, settings), remainingDurationMinutes, plannedSprintNumber: assignedSprint, overCapacity });
    scheduledEnds.set(task.id, end.toISOString());
  });

  const requirements = groups.map((group) => {
    const requirementUpdates = updates.filter((update) => (update.task.requirementId || "unlinked") === group.id);
    const sprintNumbers = [...new Set(requirementUpdates.map((update) => update.plannedSprintNumber))].sort((a, b) => a - b);
    const sprint = sprintNumbers[0] ?? group.tasks.map((task) => plannedSprintByTask.get(task.id) ?? task.sprintNumber ?? sprintBase).sort((a, b) => a - b)[0];
    const plannedStart = requirementUpdates.length ? new Date(Math.min(...requirementUpdates.map((update) => new Date(update.start).getTime()))) : new Date(Math.min(...group.tasks.map((task) => new Date(task.start).getTime())));
    const plannedEnd = requirementUpdates.length ? new Date(Math.max(...requirementUpdates.map((update) => new Date(update.end).getTime()))) : new Date(Math.max(...group.tasks.map((task) => new Date(task.end).getTime())));
    const totalMinutes = group.tasks.reduce((sum, task) => sum + getTaskEffortMinutes(task, settings), 0);
    const remainingMinutes = group.tasks.reduce((sum, task) => sum + getTaskRemainingEffortMinutes(task, settings), 0);
    return {
      id: group.id,
      title: group.title,
      taskCount: group.tasks.length,
      sprintNumber: sprint,
      sprintNumbers,
      totalMinutes,
      remainingMinutes,
      start: plannedStart,
      end: plannedEnd,
      overCapacityMinutes: requirementUpdates.filter((update) => update.overCapacity).reduce((sum, update) => sum + Math.max(0, update.remainingDurationMinutes - sprintWindow(anchor, update.plannedSprintNumber, sprintDays, settings, sprintBase).capacityMinutes), 0),
    };
  }).sort((a, b) => a.sprintNumber - b.sprintNumber || a.start - b.start);

  return { requirements, updates, sprintDays, anchor };
}

export function applyRequirementSprintPlan(phases, settings, projectStart, firstSprintNumber = 1) {
  const plan = calculateRequirementSprintPlan(phases, settings, projectStart, firstSprintNumber);
  const snapshots = plan.updates.map(({ task }) => ({ task, start: task.start, end: task.end, durationMinutes: task.durationMinutes, plannedSprintNumber: task.plannedSprintNumber, remainingDurationMinutes: task.remainingDurationMinutes }));
  plan.updates.forEach(({ task, start, end, durationMinutes, remainingDurationMinutes, plannedSprintNumber }) => {
    Object.assign(task, { start, end, durationMinutes, remainingDurationMinutes, plannedSprintNumber });
  });
  return { ...plan, snapshots };
}
