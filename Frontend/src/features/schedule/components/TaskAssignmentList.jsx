import { useMemo, useState } from "react";
import {
  AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, Search, UsersRound, Wand2, X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { getRequirementsForProject } from "../../../data/mockRequirements";
import { getResourceCapacityForProject } from "../../../data/mockResourceCapacity";
import { getTeamForProject, getTeamMemberById } from "../../../data/mockTeam";
import { ROLES, useRole } from "../../../context/RoleContext";
import { useScheduleHistory } from "../context/ScheduleHistoryContext";
import { addWorkingMinutes, normalizeWorkingStart, useWorkCalendar } from "../context/WorkCalendarContext";
import { cn } from "../../../lib/utils";
import { formatShortDate, statusBadgeVariant, statusLabel, taskAssigneeIds } from "../lib/scheduleUtils";

export const WORKDAY_MINUTES = 480;
const MINUTES_PER_POINT = 240;
const ROLE_ALIASES = { "Mobile Developer": "Frontend Developer", "Product Manager": "Project Manager" };
const STATUS_DOT = {
  "not-started": "bg-muted-foreground/50",
  "in-progress": "bg-primary",
  review: "bg-status-modified-fg",
  done: "bg-status-confirmed-fg",
};
const initialsFor = (name) => name.split(" ").map((part) => part[0]).join("").toUpperCase();
const estimateMinutes = (task) => task.durationMinutes ?? Math.max(1, task.storyPoints ?? 1) * MINUTES_PER_POINT;
const durationLabel = (minutes) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const durationHours = (task) => Math.floor(estimateMinutes(task) / 60);
const durationMinutesPart = (task) => estimateMinutes(task) % 60;

function workingMinutesInTimeline(start, end, settings) {
  const cursor = new Date(start);
  const finish = new Date(end);
  cursor.setHours(0, 0, 0, 0);
  finish.setHours(0, 0, 0, 0);
  let minutes = 0;
  while (cursor <= finish) {
    if (settings.workdays.includes(cursor.getDay())) minutes += settings.hoursPerDay * 60;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(settings.hoursPerDay * 60, minutes);
}

export function TaskAssignmentList({ tasks = [], onSelectTask, isPM }) {
  const { pushHistory, saveVersion } = useScheduleHistory();
  const { settings: workCalendar } = useWorkCalendar();
  const { role } = useRole();
  const canEdit = isPM ?? role === ROLES.PM;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const pageSize = 8;
  const projectId = tasks[0]?.projectId || (tasks[0]?.id?.includes("-mp-") ? "proj-meridianpay" : "proj-novacart");
  const requirements = useMemo(() => getRequirementsForProject(projectId), [projectId]);
  const team = useMemo(() => getTeamForProject(projectId), [projectId]);
  const capacity = useMemo(() => getResourceCapacityForProject(projectId), [projectId]);
  const requirementsById = useMemo(() => new Map(requirements.map((item) => [item.id, item])), [requirements]);
  const capacityByMember = useMemo(() => new Map(capacity.map((item) => [item.memberId, item])), [capacity]);

  const owners = useMemo(() => {
    const people = new Map();
    tasks.flatMap(taskAssigneeIds).map(getTeamMemberById).filter(Boolean).forEach((person) => people.set(person.id, person));
    return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks, revision]);
  const filteredTasks = tasks.filter((task) => {
    const people = taskAssigneeIds(task).map(getTeamMemberById).filter(Boolean);
    const requirement = requirementsById.get(task.requirementId)?.title ?? task.requirementId ?? "";
    const term = query.trim().toLowerCase();
    const textMatch = !term || [task.id, task.name, requirement, ...people.map((person) => person.name)].some((value) => value.toLowerCase().includes(term));
    return textMatch && (status === "all" || task.status === status) && (owner === "all" || taskAssigneeIds(task).includes(owner));
  });
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleTasks = filteredTasks.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const resetPage = () => setPage(0);

  const relevantPeople = (task) => {
    const requiredRole = task.role ?? requirementsById.get(task.requirementId)?.resourceRole;
    const matchingRole = ROLE_ALIASES[requiredRole] ?? requiredRole;
    return team.filter((person) => person.jobTitle === matchingRole);
  };
  const updateTask = (task, update, label) => {
    const previous = { assigneeId: task.assigneeId, assigneeIds: task.assigneeIds, durationMinutes: task.durationMinutes, start: task.start, end: task.end, assignmentMode: task.assignmentMode };
    Object.assign(task, update);
    pushHistory(label, () => Object.assign(task, previous));
    setRevision((value) => value + 1);
  };
  const manuallyAssign = (task, memberId) => {
    if (task.status === "done") return;
    const assigneeIds = taskAssigneeIds(task).includes(memberId)
      ? taskAssigneeIds(task).filter((id) => id !== memberId)
      : [...taskAssigneeIds(task), memberId];
    updateTask(task, { assigneeId: assigneeIds[0], assigneeIds, assignmentMode: "manual" }, `Manually changed assignees for "${task.name}"`);
  };
  const manuallySetDuration = (task, hours, minutesPart) => {
    if (task.status === "done") return;
    const minutes = Math.max(1, (Math.max(0, Number(hours) || 0) * 60) + Math.min(59, Math.max(0, Number(minutesPart) || 0)));
    const start = normalizeWorkingStart(task.start, workCalendar);
    updateTask(task, { start: start.toISOString(), durationMinutes: minutes, end: addWorkingMinutes(start, minutes, workCalendar).toISOString(), assignmentMode: "manual" }, `Manually changed duration for "${task.name}"`);
  };
  const autoPlan = () => {
    const editable = tasks.filter((task) => task.status !== "done");
    if (!editable.length) return;
    saveVersion("Before automatic task assignment", tasks);
    const remaining = new Map(team.map((person) => {
      const resource = capacityByMember.get(person.id);
      return [person.id, resource ? Math.max(0, (resource.availableHours - resource.plannedHours) * 60) : Math.max(0, (100 - person.workloadPercent) * 48)];
    }));
    const snapshot = editable.map((task) => ({ task, assigneeId: task.assigneeId, assigneeIds: task.assigneeIds, durationMinutes: task.durationMinutes, start: task.start, end: task.end, assignmentMode: task.assignmentMode }));
    [...editable].sort((a, b) => Number(b.critical) - Number(a.critical) || (b.storyPoints ?? 0) - (a.storyPoints ?? 0)).forEach((task) => {
      const minutes = estimateMinutes(task);
      const timelineMinutes = workingMinutesInTimeline(task.start, task.end, workCalendar);
      const candidates = relevantPeople(task)
        .filter((person) => !capacityByMember.get(person.id)?.offToday && (remaining.get(person.id) ?? 0) > 0)
        .sort((a, b) => (remaining.get(b.id) ?? 0) - (remaining.get(a.id) ?? 0) || a.workloadPercent - b.workloadPercent);
      const peopleNeeded = Math.max(1, Math.ceil(minutes / timelineMinutes), Math.ceil((task.storyPoints ?? 1) / 5));
      const assigned = candidates.slice(0, peopleNeeded);
      task.durationMinutes = minutes;
      const start = normalizeWorkingStart(task.start, workCalendar);
      task.start = start.toISOString();
      task.end = addWorkingMinutes(start, minutes, workCalendar).toISOString();
      task.assignmentMode = "automatic";
      if (assigned.length) {
        const effortPerPerson = Math.ceil(minutes / assigned.length);
        task.assigneeId = assigned[0].id;
        task.assigneeIds = assigned.map((person) => person.id);
        assigned.forEach((person) => remaining.set(person.id, Math.max(0, (remaining.get(person.id) ?? 0) - effortPerPerson)));
      } else {
        task.assigneeId = undefined;
        task.assigneeIds = [];
      }
    });
    pushHistory(`Automatically estimated and assigned ${editable.length} task(s)`, () => snapshot.forEach(({ task, ...previous }) => Object.assign(task, previous)));
    setRevision((value) => value + 1);
  };

  if (tasks.length === 0) return <div className="rounded-xl border border-dashed border-border bg-muted/10 px-6 py-10 text-center"><CalendarDays className="mx-auto h-7 w-7 text-muted-foreground/60" /><p className="mt-2 text-sm font-medium text-foreground">No assignments in this period</p><p className="mt-1 text-xs text-muted-foreground">Tasks scheduled for this view will appear here.</p></div>;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-muted/40 to-card px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></span>
          <div><h3 className="text-sm font-semibold text-foreground">Task assignments</h3><p className="mt-0.5 text-xs text-muted-foreground">Owners, effort, and delivery dates for this schedule window</p></div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-background">{filteredTasks.length} {filteredTasks.length === 1 ? "task" : "tasks"}</Badge>
          <Button size="sm" onClick={autoPlan} disabled={!canEdit} title={!canEdit ? "Only Project Managers can update assignments" : undefined}><Wand2 className="h-4 w-4" />Auto-plan</Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-b border-border bg-background/70 p-3 sm:flex-row sm:items-center sm:px-4">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Search tasks, requirements, or people" className="h-9 border-border bg-card pl-9 pr-9" />{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); resetPage(); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}</div>
        <div className="flex gap-2">
          <select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); resetPage(); }} className="h-9 min-w-32 rounded-lg border border-input bg-card px-3 text-xs text-foreground"><option value="all">All statuses</option><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="review">Review</option><option value="done">Done</option></select>
          <select aria-label="Filter by assignee" value={owner} onChange={(event) => { setOwner(event.target.value); resetPage(); }} className="h-9 min-w-36 rounded-lg border border-input bg-card px-3 text-xs text-foreground"><option value="all">All assignees</option>{owners.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
          <thead><tr className="bg-muted/35 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th className="w-[28%] px-5 py-3">Task / Requirement</th><th className="w-[23%] px-4 py-3">Assigned team</th><th className="w-[15%] px-4 py-3">Schedule</th><th className="w-[13%] px-4 py-3">Effort</th><th className="w-[11%] px-4 py-3">Status</th><th className="w-[10%] px-4 py-3">Progress</th>
          </tr></thead>
          <tbody>
            {visibleTasks.map((task, index) => {
              const assignees = taskAssigneeIds(task).map(getTeamMemberById).filter(Boolean);
              const isCompleted = task.status === "done";
              const editable = canEdit && !isCompleted;
              const peopleForRole = relevantPeople(task);
              const requirement = requirementsById.get(task.requirementId);
              const progress = Math.min(100, Math.max(0, task.progress ?? 0));
              return (
                <tr key={task.id} onClick={() => onSelectTask?.(task)} className={cn("group border-t border-border/70 transition-colors hover:bg-primary/[0.035]", index % 2 && "bg-muted/[0.12]", onSelectTask && "cursor-pointer")}>
                  <td className="px-5 py-3.5 align-top"><div className="flex items-start gap-2.5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] font-medium text-muted-foreground">{task.id}</span>{task.critical && <Badge variant="danger" className="px-1.5 py-0 text-[9px]">Critical</Badge>}</div><p className="mt-1 max-w-sm font-semibold leading-snug text-foreground">{task.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{requirement?.title ?? task.requirementId ?? "No requirement linked"}</p></div></div></td>
                  <td className="px-4 py-3.5 align-top"><div className="flex items-center gap-2.5"><div className="flex shrink-0 -space-x-2">{assignees.length ? assignees.slice(0, 3).map((person) => <Avatar key={person.id} className="h-7 w-7 border-2 border-card text-[9px]"><AvatarFallback>{initialsFor(person.name)}</AvatarFallback></Avatar>) : <Avatar className="h-7 w-7 text-[9px]"><AvatarFallback>?</AvatarFallback></Avatar>}</div><div className="min-w-0"><p className="truncate text-xs font-medium text-foreground">{assignees.length ? assignees.map((person) => person.name).join(", ") : "Unassigned"}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{task.role ?? requirement?.resourceRole ?? "Role not set"}</p></div></div>
                    {canEdit && !isCompleted && <select aria-label={`Change assignees for ${task.name}`} onClick={(event) => event.stopPropagation()} onChange={(event) => { manuallyAssign(task, event.target.value); event.target.value = ""; }} defaultValue="" className="mt-2 h-7 max-w-full rounded-md border border-input bg-background px-2 text-[10px] text-muted-foreground"><option value="" disabled>Manage team</option>{peopleForRole.map((person) => <option key={person.id} value={person.id} disabled={capacityByMember.get(person.id)?.offToday}>{taskAssigneeIds(task).includes(person.id) ? `Remove ${person.name}` : `Add ${person.name}`}{capacityByMember.get(person.id)?.offToday ? " · unavailable" : ""}</option>)}</select>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 align-top"><div className="flex items-center gap-2 text-xs font-medium text-foreground"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{formatShortDate(task.start)}</div><p className="mt-1.5 pl-[22px] text-[11px] text-muted-foreground">to {formatShortDate(task.end)}</p></td>
                  <td className="px-4 py-3.5 align-top"><div className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><Input aria-label={`Effort hours for ${task.name}`} type="number" min="0" step="1" value={durationHours(task)} onClick={(event) => event.stopPropagation()} onChange={(event) => manuallySetDuration(task, event.target.value, durationMinutesPart(task))} disabled={!editable} className="h-8 w-14 px-1.5 text-center text-xs" /><span className="text-[10px] text-muted-foreground">h</span><Input aria-label={`Effort minutes for ${task.name}`} type="number" min="0" max="59" step="1" value={durationMinutesPart(task)} onClick={(event) => event.stopPropagation()} onChange={(event) => manuallySetDuration(task, durationHours(task), event.target.value)} disabled={!editable} className="h-8 w-12 px-1 text-center text-xs" /><span className="text-[10px] text-muted-foreground">m</span></div><p className="mt-1.5 pl-5 text-[10px] text-muted-foreground">{durationLabel(estimateMinutes(task))} total</p></td>
                  <td className="px-4 py-3.5 align-top"><Badge variant={statusBadgeVariant(task)} className="whitespace-nowrap bg-opacity-80"><span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[task.status] ?? "bg-muted-foreground")} />{statusLabel(task)}</Badge></td>
                  <td className="px-4 py-3.5 align-top"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold tabular-nums text-foreground">{progress}%</span>{progress === 100 ? <CheckCircle2 className="h-3.5 w-3.5 text-status-confirmed-fg" /> : <span className="text-[10px] text-muted-foreground">complete</span>}</div><div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} /></div></td>
                </tr>
              );
            })}
            {filteredTasks.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center"><AlertCircle className="mx-auto h-5 w-5 text-muted-foreground/60" /><p className="mt-2 text-sm font-medium text-foreground">No matching tasks</p><p className="mt-1 text-xs text-muted-foreground">Try changing the search or filters.</p></td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/15 px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <p>Showing <span className="font-medium text-foreground">{filteredTasks.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, filteredTasks.length)}</span> of <span className="font-medium text-foreground">{filteredTasks.length}</span> tasks</p>
        <div className="flex items-center gap-2"><span className="tabular-nums">Page {currentPage + 1} of {pageCount}</span><Button variant="outline" size="icon" className="h-7 w-7" aria-label="Previous page" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" className="h-7 w-7" aria-label="Next page" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage >= pageCount - 1}><ChevronRight className="h-4 w-4" /></Button></div>
      </div>
    </section>
  );
}
