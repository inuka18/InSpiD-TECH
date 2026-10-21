import { addDays, endOfDay, formatShortDate, isSameDay, isTaskActiveOn, startOfDay, TODAY } from "./scheduleUtils";

export const LEAVE_TYPES = [
  { value: "full-day", label: "Full day", hours: 8 },
  { value: "half-day", label: "Half day", hours: 4 },
  { value: "custom", label: "Custom", hours: null },
];

export function getLeaveHours(leaveType, customHours) {
  if (leaveType === "half-day") return 4;
  if (leaveType === "full-day") return 8;
  const parsed = Number(customHours);
  if (!Number.isFinite(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 24);
}

export function getLeaveLabel(leaveType, customHours) {
  if (leaveType === "custom") return `${getLeaveHours(leaveType, customHours)}h custom`;
  return LEAVE_TYPES.find((option) => option.value === leaveType)?.label ?? "Full day";
}

export function findReplacementMember(capacityRecords, currentCapacity, leaveDate = TODAY) {
  if (!currentCapacity) return null;
  return capacityRecords
    .filter((candidate) => candidate.projectId === currentCapacity.projectId)
    .filter((candidate) => candidate.memberId !== currentCapacity.memberId)
    .filter((candidate) => candidate.role === currentCapacity.role)
    .filter((candidate) => !candidate.offToday || (candidate.leaveDate && !isSameDay(candidate.leaveDate, leaveDate)))
    .map((candidate) => {
      const ratio = candidate.availableHours > 0 ? candidate.plannedHours / candidate.availableHours : Infinity;
      const leavePenalty = candidate.returnDate && new Date(candidate.returnDate) > startOfDay(leaveDate) ? 0.15 : 0;
      const slack = Math.max(candidate.availableHours - candidate.plannedHours, 0);
      return {
        candidate,
        score: ratio - slack / 100 - leavePenalty,
      };
    })
    .sort((a, b) => a.score - b.score)[0]?.candidate ?? null;
}

export function previewLeaveImpact({ capacity, phases, capacityRecords, leaveType, customHours, leaveDate = TODAY }) {
  const leaveHours = getLeaveHours(leaveType, customHours);
  const leaveDays = Math.max(1, Math.ceil(leaveHours / 8));
  const affectedTasks = (phases?.flatMap((phase) => phase.tasks.map((task) => ({ ...task, phaseName: phase.name }))) ?? []).filter(
    (task) => task.assigneeId === capacity?.memberId && task.status !== "done" && isTaskActiveOn(task, leaveDate)
  );
  const replacement = findReplacementMember(capacityRecords ?? [], capacity, leaveDate);

  return {
    leaveHours,
    leaveDays,
    affectedTasks,
    replacement,
    estimatedDelayDays: replacement ? 0 : leaveDays,
    returnDate: formatShortDate(addDays(leaveDate, leaveDays)),
  };
}

export function applyLeavePlan({ capacity, phases, capacityRecords, leaveType, customHours, leaveDate = TODAY }) {
  const preview = previewLeaveImpact({ capacity, phases, capacityRecords, leaveType, customHours, leaveDate });
  const { leaveHours, leaveDays, affectedTasks, replacement } = preview;
  const snapshots = [];

  capacity.offToday = true;
  capacity.leaveType = leaveType;
  capacity.leaveHours = leaveHours;
  capacity.leaveDate = leaveDate.toISOString();
  capacity.returnDate = addDays(endOfDay(leaveDate), leaveDays).toISOString();
  capacity.availableHours = Math.max(0, capacity.availableHours - leaveHours);
  const ratioPct = capacity.availableHours > 0 ? Math.round((capacity.plannedHours / capacity.availableHours) * 100) : 100;
  capacity.status = ratioPct > 100 ? "Over-allocated" : ratioPct >= 85 ? "Near Capacity" : ratioPct >= 65 ? "Balanced" : "Under-utilized";

  affectedTasks.forEach((task) => {
    snapshots.push({
      task,
      prevAssigneeId: task.assigneeId,
      prevStart: task.start,
      prevEnd: task.end,
      prevReplacement: task.resourceReplacement,
      prevReallocatedFrom: task.reallocatedFrom,
      prevLeaveImpactHours: task.leaveImpactHours,
      prevLeaveType: task.leaveType,
      prevLeaveDate: task.leaveDate,
      prevChangeDate: task.changeDate,
    });

    task.originalAssigneeId ??= task.assigneeId;
    task.prevAssigneeId = task.assigneeId;
    task.leaveType = leaveType;
    task.leaveDate = leaveDate.toISOString();

    if (replacement) {
      task.assigneeId = replacement.memberId;
      task.resourceReplacement = replacement.name;
      task.reallocatedFrom = capacity.name;
      task.leaveImpactHours = leaveHours;
      task.changeDate = leaveDate.toISOString();
      return;
    }

    const shiftedStart = new Date(task.start);
    const shiftedEnd = new Date(task.end);
    shiftedStart.setDate(shiftedStart.getDate() + leaveDays);
    shiftedEnd.setDate(shiftedEnd.getDate() + leaveDays);
    task.start = shiftedStart.toISOString();
    task.end = shiftedEnd.toISOString();
    task.leaveImpactHours = leaveHours;
    task.reallocatedFrom = capacity.name;
    task.changeDate = leaveDate.toISOString();
  });

  return {
    preview,
    snapshots,
    replacement,
    leaveHours,
    leaveDays,
    affectedTasks,
  };
}
