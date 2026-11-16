'use strict';
const AppError = require('../../shared/AppError');
const integration = require('../integration/service');
const { User } = require('../auth/model');
const { ScheduleTask } = require('./models/ScheduleTask');
const { ScheduleSettings } = require('./models/ScheduleSettings');
const { ScheduleVersion } = require('./models/ScheduleVersion');
const { ScheduleLeave } = require('./models/ScheduleLeave');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SETTINGS = { workdays: [1, 2, 3, 4, 5], hoursPerDay: 8, startHour: 9, sprintDays: 10, firstSprintNumber: 1 };
const dateOf = (value) => new Date(value);
const startOfDay = (value) => { const date = dateOf(value); date.setHours(0, 0, 0, 0); return date; };
const endOfDay = (value) => { const date = dateOf(value); date.setHours(23, 59, 59, 999); return date; };

function apiTask(task, requirementTitles = new Map()) {
  const assigneeIds = (task.assigneeIds ?? []).map(String);
  return {
    id: task.taskId,
    taskId: task.taskId,
    projectId: task.projectId,
    requirementId: task.requirementId,
    requirementTitle: requirementTitles.get(task.requirementId) ?? null,
    phaseId: task.phaseId,
    phaseName: task.phaseName,
    name: task.name,
    description: task.description,
    role: task.role,
    durationMinutes: task.estimateMinutes,
    estimatedEffortHours: task.estimateMinutes / 60,
    remainingDurationMinutes: task.status === 'done' ? 0 : Math.ceil(task.estimateMinutes * (100 - task.progress) / 100),
    status: task.status,
    progress: task.progress,
    assigneeId: assigneeIds[0] ?? null,
    assigneeIds,
    start: task.start,
    end: task.end,
    baselineStart: task.baselineStart,
    baselineEnd: task.baselineEnd,
    dependencies: task.dependencies,
    sprintNumber: task.sprintNumber,
    plannedSprintNumber: task.plannedSprintNumber,
    critical: task.critical,
    milestone: task.milestone,
  };
}

function remainingMinutes(task) {
  return task.status === 'done' ? 0 : Math.ceil(task.estimateMinutes * (100 - task.progress) / 100);
}

function dependencyIds(task) { return task.dependencies ?? []; }

function topologicalTasks(tasks) {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const state = new Map();
  const result = [];
  function visit(task, trail) {
    const mark = state.get(task.taskId);
    if (mark === 'done') return;
    if (mark === 'visiting') throw new AppError(400, 'DEPENDENCY_CYCLE', `Task dependency cycle: ${[...trail, task.taskId].join(' -> ')}`);
    state.set(task.taskId, 'visiting');
    for (const id of dependencyIds(task)) {
      const dependency = byId.get(id);
      if (dependency) visit(dependency, [...trail, task.taskId]);
    }
    state.set(task.taskId, 'done');
    result.push(task);
  }
  [...tasks].sort((a, b) => dateOf(a.start) - dateOf(b.start)).forEach((task) => visit(task, []));
  return result;
}

function sprintWindow(anchor, number, settings) {
  const offset = (number - settings.firstSprintNumber) * settings.sprintDays;
  const start = new Date(startOfDay(anchor).getTime() + offset * DAY_MS);
  const end = new Date(start.getTime() + (settings.sprintDays - 1) * DAY_MS);
  let workdays = 0;
  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    if (settings.workdays.includes(day.getDay())) workdays += 1;
  }
  return { start, end: endOfDay(end), capacityMinutes: workdays * settings.hoursPerDay * 60 };
}

function normalizeWorkingStart(value, settings) {
  let cursor = dateOf(value);
  for (let i = 0; i < 370; i += 1) {
    if (!settings.workdays.includes(cursor.getDay())) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(settings.startHour ?? 9, 0, 0, 0);
      continue;
    }
    const open = new Date(cursor);
    open.setHours(settings.startHour ?? 9, 0, 0, 0);
    const close = new Date(open.getTime() + settings.hoursPerDay * 60 * 60 * 1000);
    if (cursor < open) return open;
    if (cursor < close) return cursor;
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(settings.startHour ?? 9, 0, 0, 0);
  }
  throw new AppError(400, 'SCHEDULE_RANGE', 'Could not find a working time in the planning range');
}

function addWorkingMinutes(value, minutes, settings) {
  let cursor = normalizeWorkingStart(value, settings);
  let remaining = Math.max(0, Number(minutes) || 0);
  while (remaining > 0) {
    const close = new Date(cursor);
    close.setHours((settings.startHour ?? 9) + settings.hoursPerDay, 0, 0, 0);
    const capacity = Math.max(0, Math.floor((close - cursor) / 60000));
    if (remaining <= capacity) return new Date(cursor.getTime() + remaining * 60000);
    remaining -= capacity;
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(settings.startHour ?? 9, 0, 0, 0);
    cursor = normalizeWorkingStart(cursor, settings);
  }
  return cursor;
}

function planTasks(tasks, settings) {
  if (!tasks.length) return { updates: [], requirements: [], sprintDays: settings.sprintDays };
  const ordered = topologicalTasks(tasks);
  const firstDate = settings.projectStart ?? new Date(Math.min(...tasks.map((task) => dateOf(task.baselineStart).getTime())));
  const anchor = startOfDay(firstDate);
  const assigned = new Map(tasks.filter((task) => task.status === 'done').map((task) => [task.taskId, task.sprintNumber ?? task.plannedSprintNumber ?? settings.firstSprintNumber]));
  const finishes = new Map(tasks.filter((task) => task.status === 'done').map((task) => [task.taskId, task.end]));
  const sprintLoads = new Map();
  const updates = [];

  for (const task of ordered) {
    if (task.status === 'done') continue;
    const effort = remainingMinutes(task);
    if (effort <= 0) continue;
    const predecessors = dependencyIds(task).map((id) => tasks.find((item) => item.taskId === id)).filter(Boolean);
    const minSprint = Math.max(settings.firstSprintNumber, ...predecessors.map((item) => assigned.get(item.taskId) ?? settings.firstSprintNumber));
    const predecessorDates = predecessors.map((item) => finishes.get(item.taskId) ?? item.end).filter(Boolean).map(dateOf);
    const predecessorFinish = predecessorDates.length ? new Date(Math.max(...predecessorDates.map((date) => date.getTime()))) : anchor;
    let sprintNumber = minSprint;
    let proposal;
    for (let attempt = 0; attempt < 500; attempt += 1, sprintNumber += 1) {
      const window = sprintWindow(anchor, sprintNumber, settings);
      const used = sprintLoads.get(sprintNumber) ?? 0;
      const overCapacity = effort > window.capacityMinutes && used === 0;
      if (used + effort > window.capacityMinutes && !overCapacity) continue;
      const start = normalizeWorkingStart(predecessorFinish > window.start ? predecessorFinish : window.start, settings);
      const end = addWorkingMinutes(start, effort, settings);
      if (start > window.end || (end > window.end && !overCapacity)) continue;
      proposal = { task, start, end, sprintNumber, remainingMinutes: effort, overCapacity };
      sprintLoads.set(sprintNumber, used + effort);
      break;
    }
    if (!proposal) throw new AppError(400, 'UNSCHEDULABLE_TASK', `Unable to place task ${task.taskId} in the sprint plan`);
    assigned.set(task.taskId, proposal.sprintNumber);
    finishes.set(task.taskId, proposal.end);
    updates.push(proposal);
  }

  const requirementIds = [...new Set(tasks.map((task) => task.requirementId || 'unlinked'))];
  const requirements = requirementIds.map((requirementId) => {
    const requirementTasks = tasks.filter((task) => (task.requirementId || 'unlinked') === requirementId);
    const requirementUpdates = updates.filter((update) => (update.task.requirementId || 'unlinked') === requirementId);
    const sprintNumbers = [...new Set(requirementUpdates.map((update) => update.sprintNumber))].sort((a, b) => a - b);
    return {
      requirementId: requirementId === 'unlinked' ? null : requirementId,
      taskCount: requirementTasks.length,
      totalMinutes: requirementTasks.reduce((sum, task) => sum + task.estimateMinutes, 0),
      remainingMinutes: requirementTasks.reduce((sum, task) => sum + remainingMinutes(task), 0),
      sprintNumbers,
      overCapacityTaskIds: requirementUpdates.filter((update) => update.overCapacity).map((update) => update.task.taskId),
    };
  });
  return { updates, requirements, sprintDays: settings.sprintDays, anchor };
}

async function getSettings(projectId) {
  return ScheduleSettings.findOneAndUpdate({ projectId }, { $setOnInsert: { projectId, ...DEFAULT_SETTINGS } }, { new: true, upsert: true, setDefaultsOnInsert: true }).lean();
}

async function getTasks(projectId) {
  return ScheduleTask.find({ projectId }).sort({ start: 1, taskId: 1 }).lean();
}

async function getTitles(projectId) {
  const { requirements } = await integration.liveState(projectId);
  return new Map(requirements.map((requirement) => [requirement.id, requirement.title]));
}

async function validateLinks(projectId, body, excludingTaskId, allowedTaskIds = []) {
  if (body.requirementId) {
    const { requirements } = await integration.liveState(projectId);
    if (!requirements.some((item) => item.id === body.requirementId)) throw new AppError(400, 'INVALID_REQUIREMENT', `Requirement ${body.requirementId} does not belong to this project`);
  }
  const deps = body.dependencies ?? [];
  if (deps.includes(excludingTaskId ?? body.taskId)) throw new AppError(400, 'INVALID_DEPENDENCY', 'A task cannot depend on itself');
  if (deps.length) {
    const found = await ScheduleTask.find({ projectId, taskId: { $in: deps } }, { taskId: 1 }).lean();
    const knownIds = new Set([...found.map((task) => task.taskId), ...allowedTaskIds]);
    if (deps.some((id) => !knownIds.has(id))) throw new AppError(400, 'INVALID_DEPENDENCY', 'Every dependency must be another task in this project');
  }
  if (body.assigneeIds?.length) {
    const found = await User.countDocuments({ _id: { $in: body.assigneeIds }, projectIds: projectId });
    if (found !== new Set(body.assigneeIds).size) throw new AppError(400, 'INVALID_ASSIGNEE', 'Every assignee must be a member of this project');
  }
  if (body.start && body.end && dateOf(body.end) <= dateOf(body.start)) throw new AppError(400, 'INVALID_DATES', 'Task end must be later than task start');
}

async function listTasks(projectId) {
  const [tasks, titles] = await Promise.all([getTasks(projectId), getTitles(projectId)]);
  return tasks.map((task) => apiTask(task, titles));
}

async function getSchedule(projectId) {
  const [tasks, settings, titles] = await Promise.all([getTasks(projectId), getSettings(projectId), getTitles(projectId)]);
  const phasesById = new Map();
  tasks.forEach((task) => {
    const phaseId = task.phaseId || 'schedule-phase-default';
    if (!phasesById.has(phaseId)) phasesById.set(phaseId, { id: phaseId, name: task.phaseName || 'Scheduled work', tasks: [] });
    phasesById.get(phaseId).tasks.push(apiTask(task, titles));
  });
  return { projectId, settings, phases: [...phasesById.values()], tasks: tasks.map((task) => apiTask(task, titles)) };
}

async function createTask(projectId, body) {
  await validateLinks(projectId, body);
  const start = dateOf(body.start);
  const end = dateOf(body.end);
  const doc = await ScheduleTask.create({
    ...body,
    projectId,
    requirementId: body.requirementId ?? null,
    start,
    end,
    baselineStart: body.baselineStart ? dateOf(body.baselineStart) : start,
    baselineEnd: body.baselineEnd ? dateOf(body.baselineEnd) : end,
    progress: body.status === 'done' ? 100 : body.status === 'not-started' ? 0 : body.progress ?? 0,
    originalAssigneeIds: body.assigneeIds,
  });
  return apiTask(doc.toObject(), await getTitles(projectId));
}

async function importTasks(projectId, tasks) {
  const incomingIds = new Set(tasks.map((task) => task.taskId));
  for (const task of tasks) await validateLinks(projectId, task, undefined, [...incomingIds]);
  const writes = tasks.map((body) => {
    const start = dateOf(body.start);
    const end = dateOf(body.end);
    const doc = {
      ...body,
      projectId,
      requirementId: body.requirementId ?? null,
      start,
      end,
      baselineStart: body.baselineStart ? dateOf(body.baselineStart) : start,
      baselineEnd: body.baselineEnd ? dateOf(body.baselineEnd) : end,
      progress: body.status === 'done' ? 100 : body.status === 'not-started' ? 0 : body.progress ?? 0,
      originalAssigneeIds: body.assigneeIds,
    };
    return { updateOne: { filter: { projectId, taskId: body.taskId }, update: { $setOnInsert: doc }, upsert: true } };
  });
  const result = await ScheduleTask.bulkWrite(writes, { ordered: true });
  return { projectId, importedCount: result.upsertedCount, existingCount: result.matchedCount, tasks: await listTasks(projectId) };
}

async function updateTask(projectId, taskId, body, actor) {
  const task = await ScheduleTask.findOne({ projectId, taskId });
  if (!task) throw new AppError(404, 'NOT_FOUND', `Task ${taskId} not found`);
  if (actor.role !== 'PM') {
    if (!task.assigneeIds.some((id) => String(id) === actor.id)) throw new AppError(403, 'FORBIDDEN', 'Team members may update only tasks assigned to them');
    if (Object.keys(body).some((key) => !['status', 'progress'].includes(key))) throw new AppError(403, 'FORBIDDEN', 'Team members may update task status and progress only');
  }
  await validateLinks(projectId, body, taskId);
  if (body.status === 'done') body.progress = 100;
  else if (body.status === 'not-started') body.progress = 0;
  else if (body.status && body.progress === undefined && task.progress >= 100) body.progress = body.status === 'review' ? 90 : 50;
  Object.assign(task, body, {
    ...(body.start ? { start: dateOf(body.start) } : {}),
    ...(body.end ? { end: dateOf(body.end) } : {}),
  });
  await task.save();
  return apiTask(task.toObject(), await getTitles(projectId));
}

async function deleteTask(projectId, taskId) {
  if (await ScheduleTask.exists({ projectId, dependencies: taskId })) throw new AppError(409, 'TASK_HAS_DEPENDENTS', 'Remove dependent task links before deleting this task');
  const deleted = await ScheduleTask.findOneAndDelete({ projectId, taskId }).lean();
  if (!deleted) throw new AppError(404, 'NOT_FOUND', `Task ${taskId} not found`);
  return { taskId, deleted: true };
}

async function updateSettings(projectId, body) {
  const settings = await ScheduleSettings.findOneAndUpdate({ projectId }, { $set: body, $setOnInsert: { projectId } }, { new: true, upsert: true, runValidators: true }).lean();
  return settings;
}

async function previewPlan(projectId) {
  const [tasks, settings] = await Promise.all([getTasks(projectId), getSettings(projectId)]);
  return planTasks(tasks, settings);
}

async function saveVersion(projectId, label, actor) {
  const [tasks, settings] = await Promise.all([getTasks(projectId), getSettings(projectId)]);
  const version = await ScheduleVersion.create({ projectId, label, createdBy: actor.id, settings, tasks, taskCount: tasks.length });
  return { id: String(version._id), projectId, label, createdAt: version.createdAt, taskCount: tasks.length };
}

async function applyPlan(projectId, actor) {
  const [tasks, settings] = await Promise.all([getTasks(projectId), getSettings(projectId)]);
  const plan = planTasks(tasks, settings);
  const version = await ScheduleVersion.create({ projectId, label: 'Before sprint replan', createdBy: actor.id, settings, tasks, taskCount: tasks.length });
  const writes = plan.updates.map(({ task, start, end, sprintNumber }) => ({
    updateOne: { filter: { projectId, taskId: task.taskId, status: { $ne: 'done' } }, update: { $set: { start, end, plannedSprintNumber: sprintNumber } } },
  }));
  if (writes.length) await ScheduleTask.bulkWrite(writes);
  return { ...plan, versionId: String(version._id), appliedTaskCount: writes.length, completedTasksPreserved: tasks.filter((task) => task.status === 'done').length };
}

async function eligiblePeople(projectId, memberId, leaveDate, tasks, settings) {
  const member = await User.findOne({ _id: memberId, projectIds: projectId }).lean();
  if (!member) throw new AppError(404, 'MEMBER_NOT_FOUND', 'The selected team member is not on this project');
  const candidates = await User.find({ projectIds: projectId, _id: { $ne: memberId }, jobTitle: member.jobTitle }).lean();
  const leaveDay = startOfDay(leaveDate);
  const candidateLeaves = await ScheduleLeave.find({ projectId, memberId: { $in: candidates.map((person) => person._id) }, leaveDate: { $gte: startOfDay(leaveDay), $lte: endOfDay(leaveDay) } }).lean();
  const away = new Set(candidateLeaves.map((leave) => String(leave.memberId)));
  const sprintCapacity = settings.sprintDays * settings.hoursPerDay * 60;
  return candidates.filter((person) => !away.has(String(person._id))).map((person) => {
    const workload = tasks.filter((task) => task.status !== 'done' && task.assigneeIds.some((id) => String(id) === String(person._id)))
      .reduce((sum, task) => sum + remainingMinutes(task), 0);
    return { person, availableMinutes: Math.max(0, sprintCapacity - workload), workload };
  }).sort((a, b) => a.workload - b.workload);
}

async function previewLeave(projectId, body) {
  const leaveDate = dateOf(body.leaveDate);
  const settings = await getSettings(projectId);
  const leaveHours = body.leaveType === 'half-day' ? settings.hoursPerDay / 2 : body.leaveType === 'custom' ? body.customHours : settings.hoursPerDay;
  if (body.leaveType === 'custom' && !leaveHours) throw new AppError(400, 'INVALID_LEAVE_HOURS', 'Custom leave hours are required');
  const tasks = await getTasks(projectId);
  const people = await eligiblePeople(projectId, body.memberId, leaveDate, tasks, settings);
  const affected = settings.workdays.includes(leaveDate.getDay()) ? tasks.filter((task) => task.status !== 'done' && task.assigneeIds.some((id) => String(id) === body.memberId) && task.start <= endOfDay(leaveDate) && task.end >= startOfDay(leaveDate)) : [];
  const plannedLoad = new Map();
  const taskPlans = affected.map((task) => {
    const effort = remainingMinutes(task);
    const replacement = people.find(({ person, availableMinutes }) => availableMinutes - (plannedLoad.get(String(person._id)) ?? 0) >= effort);
    if (replacement) plannedLoad.set(String(replacement.person._id), (plannedLoad.get(String(replacement.person._id)) ?? 0) + effort);
    return { taskId: task.taskId, taskName: task.name, remainingMinutes: effort, action: replacement ? 'reassign' : 'reschedule', replacement: replacement ? { id: String(replacement.person._id), name: replacement.person.name, role: replacement.person.jobTitle } : null };
  });
  return { projectId, memberId: body.memberId, leaveDate, leaveType: body.leaveType, leaveHours, affectedTaskCount: taskPlans.length, taskPlans, doneTasksUnaffected: true };
}

async function propagateDependencies(projectId, changedTaskIds, settings) {
  if (!changedTaskIds.length) return;
  const tasks = await getTasks(projectId);
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const ordered = topologicalTasks(tasks);
  const changed = new Set(changedTaskIds);
  const writes = [];
  for (const task of ordered) {
    if (task.status === 'done' || !task.dependencies.some((id) => changed.has(id))) continue;
    const predecessors = task.dependencies.map((id) => byId.get(id)).filter(Boolean);
    const latestFinish = new Date(Math.max(...predecessors.map((item) => dateOf(item.end).getTime())));
    if (dateOf(task.start) >= latestFinish) continue;
    const start = normalizeWorkingStart(latestFinish, settings);
    const end = addWorkingMinutes(start, remainingMinutes(task), settings);
    task.start = start;
    task.end = end;
    changed.add(task.taskId);
    writes.push({ updateOne: { filter: { projectId, taskId: task.taskId, status: { $ne: 'done' } }, update: { $set: { start, end } } } });
  }
  if (writes.length) await ScheduleTask.bulkWrite(writes);
}

async function applyLeave(projectId, body, actor) {
  const preview = await previewLeave(projectId, body);
  const [tasks, settings] = await Promise.all([getTasks(projectId), getSettings(projectId)]);
  const leaveDayStart = startOfDay(preview.leaveDate);
  if (await ScheduleLeave.exists({ projectId, memberId: body.memberId, leaveDate: { $gte: leaveDayStart, $lte: endOfDay(leaveDayStart) } })) {
    throw new AppError(409, 'DUPLICATE_LEAVE', 'Leave is already recorded for this member on that date');
  }
  const snapshotVersion = await saveVersion(projectId, `Before leave reschedule (${preview.leaveDate.toISOString().slice(0, 10)})`, actor);
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const changedTaskIds = [];
  const taskChanges = [];
  const leaveStart = startOfDay(preview.leaveDate);
  let nextWorkingDay = new Date(leaveStart);
  do { nextWorkingDay.setDate(nextWorkingDay.getDate() + 1); } while (!settings.workdays.includes(nextWorkingDay.getDay()));
  nextWorkingDay.setHours(9, 0, 0, 0);

  for (const plan of preview.taskPlans) {
    const task = taskById.get(plan.taskId);
    if (!task || task.status === 'done') continue;
    const before = { taskId: task.taskId, start: task.start, end: task.end, assigneeIds: task.assigneeIds.map(String), status: task.status };
    if (plan.action === 'reassign' && plan.replacement) {
      const remainingAssignees = task.assigneeIds.filter((id) => String(id) !== body.memberId);
      task.assigneeIds = [...new Set([...remainingAssignees.map(String), plan.replacement.id])];
      task.originalAssigneeIds ??= before.assigneeIds;
      await ScheduleTask.updateOne({ projectId, taskId: task.taskId, status: { $ne: 'done' } }, { $set: { assigneeIds: task.assigneeIds, originalAssigneeIds: task.originalAssigneeIds } });
    } else {
      const start = normalizeWorkingStart(nextWorkingDay, settings);
      const end = addWorkingMinutes(start, remainingMinutes(task), settings);
      task.start = start;
      task.end = end;
      await ScheduleTask.updateOne({ projectId, taskId: task.taskId, status: { $ne: 'done' } }, { $set: { start, end } });
      changedTaskIds.push(task.taskId);
    }
    taskChanges.push({ before, action: plan.action, replacement: plan.replacement });
  }
  await propagateDependencies(projectId, changedTaskIds, settings);
  const leave = await ScheduleLeave.create({ projectId, memberId: body.memberId, leaveDate: preview.leaveDate, leaveHours: preview.leaveHours, leaveType: body.leaveType, affectedTaskIds: preview.taskPlans.map((item) => item.taskId), taskChanges, createdBy: actor.id });
  return { id: String(leave._id), ...preview, versionId: snapshotVersion.id, taskChanges };
}

async function listVersions(projectId) {
  return ScheduleVersion.find({ projectId }).select('label createdBy createdAt taskCount').sort({ createdAt: -1 }).lean().then((rows) => rows.map((version) => ({ id: String(version._id), projectId, label: version.label, createdBy: String(version.createdBy), createdAt: version.createdAt, taskCount: version.taskCount })));
}

async function getVersion(projectId, versionId) {
  const version = await ScheduleVersion.findOne({ _id: versionId, projectId }).lean();
  if (!version) throw new AppError(404, 'NOT_FOUND', 'Schedule version not found');
  return { id: String(version._id), projectId, label: version.label, createdBy: String(version.createdBy), createdAt: version.createdAt, settings: version.settings, tasks: version.tasks };
}

async function listLeaves(projectId) {
  const rows = await ScheduleLeave.find({ projectId }).populate('memberId', 'name email jobTitle').sort({ leaveDate: -1 }).lean();
  return rows.map((leave) => ({
    id: String(leave._id),
    projectId,
    member: leave.memberId ? { id: String(leave.memberId._id), name: leave.memberId.name, email: leave.memberId.email, role: leave.memberId.jobTitle } : null,
    leaveDate: leave.leaveDate,
    leaveHours: leave.leaveHours,
    leaveType: leave.leaveType,
    affectedTaskIds: leave.affectedTaskIds,
    taskChanges: leave.taskChanges,
    createdAt: leave.createdAt,
  }));
}

module.exports = { getSchedule, listTasks, createTask, importTasks, updateTask, deleteTask, getSettings, updateSettings, previewPlan, applyPlan, previewLeave, applyLeave, listLeaves, listVersions, saveVersion, getVersion };
