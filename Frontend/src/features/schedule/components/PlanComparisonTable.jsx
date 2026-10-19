import { Badge } from "../../../components/ui/badge";
import { getTeamMemberById } from "../../../data/mockTeam";
import { formatShortDate, varianceDays, causeStyle, statusBadgeVariant, statusLabel } from "../lib/scheduleUtils";
import { getLeaveLabel } from "../lib/leaveAutomation";

function personName(memberId) {
  return getTeamMemberById(memberId)?.name ?? "Unassigned";
}

function changeLabel(task) {
  if (task.leaveType) return `${getLeaveLabel(task.leaveType, task.leaveImpactHours)} leave`;
  if (task.cause?.type) return causeStyle(task.cause.type).label;
  return varianceDays(task) !== 0 ? "Replanned" : "On plan";
}

function changeDetail(task) {
  if (task.resourceReplacement) return `Reassigned to ${task.resourceReplacement}`;
  if (task.reallocatedFrom) return `From ${task.reallocatedFrom}`;
  if (task.leaveDate) return `Leave on ${formatShortDate(task.leaveDate)}`;
  return varianceDays(task) !== 0 ? `${Math.abs(varianceDays(task))}d variance` : "No change";
}

function originalAssignee(task) {
  return personName(task.prevAssigneeId ?? task.originalAssigneeId ?? task.assigneeId);
}

function changeSummary(task) {
  const from = originalAssignee(task);
  const to = personName(task.assigneeId);
  const reassigned = Boolean(task.resourceReplacement) || from !== to;

  if (reassigned && task.leaveType) {
    return `${from} took ${getLeaveLabel(task.leaveType, task.leaveImpactHours).toLowerCase()} leave; ${task.name} was reassigned to ${to}.`;
  }
  if (reassigned) return `${task.name} was reassigned from ${from} to ${to}.`;
  if (task.reallocatedFrom) return `${task.name} was reallocated from ${task.reallocatedFrom}.`;
  const delay = Math.abs(varianceDays(task));
  if (delay) return `${task.name} was rescheduled by ${delay} day${delay === 1 ? "" : "s"}.`;
  return `${task.name} was updated.`;
}

export function PlanComparisonTable({ tasks, comparisonTasks, title, description, rangeStart, rangeEnd, scope = "period" }) {
  const rangeStartDate = rangeStart ? new Date(rangeStart) : null;
  const rangeEndDate = rangeEnd ? new Date(rangeEnd) : null;
  if (rangeStartDate) rangeStartDate.setHours(0, 0, 0, 0);
  if (rangeEndDate) rangeEndDate.setHours(23, 59, 59, 999);

  const sourceTasks = comparisonTasks ?? tasks;
  const hasActualChange = (task) => varianceDays(task) !== 0 || task.leaveType || task.resourceReplacement || task.reallocatedFrom;
  const visibleTasks = sourceTasks.filter((task) => {
    if (!hasActualChange(task)) return false;
    if (scope === "project" || !rangeStartDate || !rangeEndDate) return true;
    const changeDate = task.changeDate || task.leaveDate;
    return changeDate && new Date(changeDate) >= rangeStartDate && new Date(changeDate) <= rangeEndDate;
  });
  const changed = visibleTasks;
  const totalSlip = changed.reduce((sum, task) => sum + Math.max(0, varianceDays(task)), 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10px]">
          <Badge variant="outline">{visibleTasks.length} tasks</Badge>
          <Badge variant="warning">{changed.length} changed</Badge>
          <Badge variant="info">{totalSlip}d slip</Badge>
        </div>
      </div>

      {visibleTasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No schedule changes in this window.</p>
      ) : (
        <>
          {changed.length > 0 ? (
            <div className="mt-4 border-y border-border">
              <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changes made</p>
              <ul className="divide-y divide-border">
                {changed.map((task) => (
                  <li key={`${task.id}-summary`} className="px-3 py-2.5 text-sm text-foreground">
                    {changeSummary(task)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-4 border-y border-border px-3 py-2.5 text-sm text-muted-foreground">No schedule changes in this window.</p>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="border-b border-border px-3 py-2">Task</th>
                <th className="border-b border-border px-3 py-2">Assigned person</th>
                <th className="border-b border-border px-3 py-2">Updated person</th>
                <th className="border-b border-border px-3 py-2">Initial plan</th>
                <th className="border-b border-border px-3 py-2">Actual plan</th>
                <th className="border-b border-border px-3 py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => (
                <tr key={task.id} className={hasActualChange(task) ? "bg-primary/[0.025] align-top" : "align-top"}>
                  <td className="border-b border-border px-3 py-3">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{task.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={statusBadgeVariant(task)} className="text-[10px]">
                          {statusLabel(task)}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{hasActualChange(task) ? "Updated" : "On plan"}</Badge>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-border px-3 py-3 text-muted-foreground">
                    {originalAssignee(task)}
                  </td>
                  <td className="border-b border-border px-3 py-3 text-foreground">
                    {personName(task.assigneeId)}
                  </td>
                  <td className="border-b border-border px-3 py-3 text-muted-foreground">
                    {formatShortDate(task.baselineStart)} – {formatShortDate(task.baselineEnd)}
                  </td>
                  <td className="border-b border-border px-3 py-3 text-foreground">
                    {formatShortDate(task.start)} – {formatShortDate(task.end)}
                  </td>
                  <td className="border-b border-border px-3 py-3 text-muted-foreground">
                    <div className="space-y-1">
                      <p>{changeLabel(task)}</p>
                      <p>{changeDetail(task)}</p>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
