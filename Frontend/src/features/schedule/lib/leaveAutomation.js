import { addDays, endOfDay, formatShortDate, isSameDay, isTaskActiveOn, startOfDay, TODAY, taskAssigneeIds } from "./scheduleUtils";
import { addWorkingMinutes, normalizeWorkingStart, workingDaysBetween, DEFAULT_WORK_CALENDAR } from "../context/WorkCalendarContext";

export const LEAVE_TYPES = [
  { value: "full-day", label: "Full day", hours: 8 },
  { value: "half-day", label: "Half day", hours: 4 },
  { value: "custom", label: "Custom", hours: null },
];

export function getLeaveHours(leaveType, customHours, settings = DEFAULT_WORK_CALENDAR) {
  if (leaveType === "half-day") return settings.hoursPerDay / 2;
  if (leaveType === "full-day") return settings.hoursPerDay;
  const parsed = Number(customHours);
  return !Number.isFinite(parsed) || parsed <= 0 ? settings.hoursPerDay : Math.min(parsed, 24);
}

export function getLeaveLabel(leaveType, customHours) {
  if (leaveType === "custom") return `${Number(customHours) || 0}h custom`;
  return LEAVE_TYPES.find((option) => option.value === leaveType)?.label ?? "Full day";
}

function isAvailable(candidate, date) {
  if (candidate.leaveDate && candidate.returnDate) {
    return date < startOfDay(candidate.leaveDate) || date > new Date(candidate.returnDate);
  }
  return !(candidate.offToday && (!candidate.returnDate || date <= new Date(candidate.returnDate)));
}

function replacementFor(capacityRecords, currentCapacity, date, plannedLoad, requiredHours) {
  return (capacityRecords ?? [])
    .filter((c) => c.projectId === currentCapacity?.projectId && c.memberId !== currentCapacity?.memberId && c.role === currentCapacity?.role && isAvailable(c, date))
    .map((candidate) => {
      const committed = plannedLoad.get(candidate.memberId) ?? 0;
      const available = Math.max(0, Number(candidate.availableHours) - Number(candidate.plannedHours) - committed);
      return { candidate, available, utilization: (Number(candidate.plannedHours) + committed) / Math.max(1, Number(candidate.availableHours)) };
    })
    .filter(({ available }) => available >= requiredHours)
    .sort((a, b) => a.utilization - b.utilization)[0]?.candidate ?? null;
}

export function previewLeaveImpact({ capacity, phases, capacityRecords, leaveType, customHours, leaveDate = TODAY, settings = DEFAULT_WORK_CALENDAR }) {
  const leaveHours = getLeaveHours(leaveType, customHours, settings);
  const date = startOfDay(leaveDate);
  const workingDay = settings.workdays.includes(date.getDay());
  const affectedTasks = workingDay ? (phases?.flatMap((phase) => phase.tasks.map((task) => ({ ...task, _task: task, phaseName: phase.name }))) ?? []).filter(
    (task) => taskAssigneeIds(task._task).includes(capacity?.memberId) && task.status !== "done" && isTaskActiveOn(task, leaveDate)
  ) : [];
  const plannedLoad = new Map();
  const taskPlans = affectedTasks.map((task) => {
    const replacement = replacementFor(capacityRecords, capacity, leaveDate, plannedLoad, Math.min(settings.hoursPerDay, leaveHours));
    if (replacement) plannedLoad.set(replacement.memberId, (plannedLoad.get(replacement.memberId) ?? 0) + Math.min(settings.hoursPerDay, leaveHours));
    return { task: task._task, replacement };
  });
  const replacement = taskPlans.find((plan) => plan.replacement)?.replacement ?? null;
  const leaveDays = Math.max(1, Math.ceil(leaveHours / settings.hoursPerDay));
  let returnDate = date;
  let remaining = leaveHours * 60;
  while (remaining > 0) {
    returnDate = addDays(returnDate, 1);
    if (settings.workdays.includes(returnDate.getDay())) remaining -= settings.hoursPerDay * 60;
  }
  return { leaveHours, leaveDays, affectedTasks: affectedTasks.map((t) => t._task), taskPlans, replacement, estimatedDelayDays: taskPlans.filter((p) => !p.replacement).length ? leaveDays : 0, returnDate: formatShortDate(returnDate), returnDateValue: returnDate };
}

export function applyLeavePlan({ capacity, phases, capacityRecords, leaveType, customHours, leaveDate = TODAY, settings = DEFAULT_WORK_CALENDAR }) {
  const preview = previewLeaveImpact({ capacity, phases, capacityRecords, leaveType, customHours, leaveDate, settings });
  const { leaveHours, leaveDays, affectedTasks, taskPlans } = preview;
  const snapshots = [];
  const previousLeaveHours = capacity.leaveHours || 0;
  capacity.offToday = isSameDay(leaveDate, TODAY);
  capacity.leaveType = leaveType;
  capacity.leaveHours = leaveHours;
  capacity.leaveDate = leaveDate.toISOString();
  capacity.returnDate = endOfDay(preview.returnDateValue).toISOString();
  capacity.availableHours = Math.max(0, Number(capacity.availableHours) + previousLeaveHours - leaveHours);
  const ratioPct = capacity.availableHours > 0 ? Math.round((capacity.plannedHours / capacity.availableHours) * 100) : 100;
  capacity.status = ratioPct > 100 ? "Over-allocated" : ratioPct >= 85 ? "Near Capacity" : ratioPct >= 65 ? "Balanced" : "Under-utilized";

  taskPlans.forEach(({ task, replacement }) => {
    snapshots.push({ task, prevAssigneeId: task.assigneeId, prevAssigneeIds: task.assigneeIds, prevStart: task.start, prevEnd: task.end, prevDurationMinutes: task.durationMinutes, prevOriginalAssigneeId: task.originalAssigneeId, prevReplacement: task.resourceReplacement, prevReallocatedFrom: task.reallocatedFrom, prevLeaveImpactHours: task.leaveImpactHours, prevLeaveType: task.leaveType, prevLeaveDate: task.leaveDate, prevChangeDate: task.changeDate });
    const durationMinutes = Number(task.durationMinutes) || workingDaysBetween(task.start, task.end, settings.workdays) * settings.hoursPerDay * 60;
    task.originalAssigneeId ??= task.assigneeId;
    task.prevAssigneeId = task.assigneeId;
    task.leaveType = leaveType;
    task.leaveDate = leaveDate.toISOString();
    task.leaveImpactHours = leaveHours;
    task.reallocatedFrom = capacity.name;
    task.changeDate = leaveDate.toISOString();
    if (replacement) {
      const assignedIds = taskAssigneeIds(task).filter((id) => id !== capacity.memberId);
      if (!assignedIds.includes(replacement.memberId)) assignedIds.push(replacement.memberId);
      task.assigneeIds = assignedIds;
      if (task.assigneeId === capacity.memberId || !task.assigneeId) task.assigneeId = replacement.memberId;
      task.resourceReplacement = replacement.name;
    } else {
      if (new Date(task.start) >= startOfDay(leaveDate)) {
        const nextStart = normalizeWorkingStart(addDays(startOfDay(leaveDate), 1), settings);
        task.start = nextStart.toISOString();
        task.durationMinutes = durationMinutes;
        task.end = addWorkingMinutes(nextStart, durationMinutes, settings).toISOString();
      } else {
        task.durationMinutes = durationMinutes + leaveHours * 60;
        task.end = addWorkingMinutes(task.end, leaveHours * 60, settings).toISOString();
      }
    }
  });
  return { preview, snapshots, replacement: preview.replacement, leaveHours, leaveDays, affectedTasks };
}
