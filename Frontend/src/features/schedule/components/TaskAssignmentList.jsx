import { useMemo, useState } from "react";
import {
  AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, Pencil, Plus, Search, Trash2, Wand2, X,
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
import { getTaskEffortMinutes, getTaskRemainingEffortMinutes } from "../lib/requirementPlanner";
import { cn } from "../../../lib/utils";
import { formatShortDate, isLate, statusLabel, taskAssigneeIds } from "../lib/scheduleUtils";
import { addTaskToProject, removeTaskFromProject } from "../../../data/mockSchedulePhases";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../../../components/ui/dialog";
import { Label } from "../../../components/ui/label";

const ROLE_ALIASES = { "Mobile Developer": "Frontend Developer", "Product Manager": "Project Manager" };
const STATUS_DOT = {
  "not-started": "bg-slate-400",
  "in-progress": "bg-blue-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
};
const TASK_STATUSES = [
  { value: "not-started", label: "Not started" },
  { value: "in-progress", label: "In progress" },
  { value: "review", label: "In review" },
  { value: "done", label: "Done" },
];
const initialsFor = (name) => name.split(" ").map((part) => part[0]).join("").toUpperCase();
const durationLabel = (minutes) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
const durationHours = (task, settings) => Math.floor(getTaskEffortMinutes(task, settings) / 60);
const durationMinutesPart = (task, settings) => getTaskEffortMinutes(task, settings) % 60;

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

function dateInputValue(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function TaskEditorDialog({ task, open, onOpenChange, team, workCalendar, onSave }) {
  const [form, setForm] = useState(() => task ? {
    name: task.name,
    assigneeId: task.assigneeId ?? "",
    status: task.status,
    start: dateInputValue(task.start),
    durationDays: Math.max(1, Math.ceil(getTaskEffortMinutes(task, workCalendar) / (workCalendar.hoursPerDay * 60))),
  } : null);

  if (!task || !form) return null;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription>Update the assignment and schedule. The Gantt chart will use these values immediately.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
          <div className="space-y-1.5">
            <Label htmlFor="schedule-task-name">Task name</Label>
            <Input id="schedule-task-name" value={form.name} onChange={set("name")} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-task-assignee">Assignee</Label>
              <select id="schedule-task-assignee" value={form.assigneeId} onChange={set("assigneeId")} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                <option value="">Unassigned</option>
                {team.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-task-status">Status</Label>
              <select id="schedule-task-status" value={form.status} onChange={set("status")} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
                {TASK_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-task-start">Start date</Label>
              <Input id="schedule-task-start" type="date" value={form.start} onChange={set("start")} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-task-duration">Duration (working days)</Label>
              <Input id="schedule-task-duration" type="number" min="1" value={form.durationDays} onChange={set("durationDays")} required />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit">Save changes</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TaskAssignmentList({ tasks = [], onSelectTask, isPM, projectId: providedProjectId }) {
  const { pushHistory, saveVersion, refreshSchedule } = useScheduleHistory();
  const { settings: workCalendar } = useWorkCalendar();
  const { role } = useRole();
  const canEdit = isPM ?? role === ROLES.PM;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [editingTask, setEditingTask] = useState(null);
  const [pendingNewTask, setPendingNewTask] = useState(null);
  const pageSize = 8;
  const projectId = providedProjectId || tasks[0]?.projectId || (tasks[0]?.id?.includes("-mp-") ? "proj-meridianpay" : "proj-novacart");
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
    const assignedRole = taskAssigneeIds(task).map(getTeamMemberById).find((person) => person?.jobTitle)?.jobTitle;
    const requiredRole = task.role ?? requirementsById.get(task.requirementId)?.resourceRole ?? assignedRole;
    const matchingRole = ROLE_ALIASES[requiredRole] ?? requiredRole;
    return team.filter((person) => person.jobTitle === matchingRole);
  };
  const updateTask = (task, update, label) => {
    const previous = { name: task.name, assigneeId: task.assigneeId, assigneeIds: task.assigneeIds, durationMinutes: task.durationMinutes, start: task.start, end: task.end, assignmentMode: task.assignmentMode, status: task.status, progress: task.progress, plannedSprintNumber: task.plannedSprintNumber, remainingDurationMinutes: task.remainingDurationMinutes };
    Object.assign(task, update);
    pushHistory(label, () => Object.assign(task, previous));
    setRevision((value) => value + 1);
    refreshSchedule();
  };
  const saveEditedTask = (form) => {
    const start = normalizeWorkingStart(new Date(`${form.start}T09:00:00`), workCalendar);
    const durationMinutes = Math.max(1, Number(form.durationDays) || 1) * workCalendar.hoursPerDay * 60;
    const assigneeIds = form.assigneeId ? [form.assigneeId] : [];
    const progress = form.status === "done" ? 100 : form.status === "not-started" ? 0 : form.status === "review" ? 90 : Math.max(20, Number(editingTask.progress) || 0);
    updateTask(editingTask, {
      name: form.name.trim(),
      assigneeId: form.assigneeId || undefined,
      assigneeIds,
      status: form.status,
      progress,
      start: start.toISOString(),
      durationMinutes,
      end: addWorkingMinutes(start, durationMinutes, workCalendar).toISOString(),
      assignmentMode: "manual",
    }, `Edited task "${editingTask.name}"`);
    if (pendingNewTask === editingTask) {
      pushHistory(`Added task "${editingTask.name}"`, () => removeTaskFromProject(projectId, editingTask.id));
    }
    setPendingNewTask(null);
    setEditingTask(null);
  };
  const createTask = () => {
    const start = normalizeWorkingStart(new Date(), workCalendar);
    const durationMinutes = workCalendar.hoursPerDay * 60;
    const task = {
      id: `task-schedule-${Date.now()}`,
      name: "New schedule task",
      assigneeId: undefined,
      assigneeIds: [],
      start: start.toISOString(),
      end: addWorkingMinutes(start, durationMinutes, workCalendar).toISOString(),
      baselineStart: start.toISOString(),
      baselineEnd: addWorkingMinutes(start, durationMinutes, workCalendar).toISOString(),
      durationMinutes,
      storyPoints: 1,
      progress: 0,
      status: "not-started",
      critical: false,
      milestone: false,
      dependencies: [],
      requirementId: null,
      cause: null,
      projectId,
    };
    if (!addTaskToProject(projectId, task)) return;
    setPendingNewTask(task);
    setEditingTask(task);
  };
  const closeEditor = (open) => {
    if (open) return;
    if (pendingNewTask) {
      removeTaskFromProject(projectId, pendingNewTask.id);
      setPendingNewTask(null);
    }
    setEditingTask(null);
  };
  const removeTask = (task) => {
    if (!canEdit) return;
    const removed = removeTaskFromProject(projectId, task.id);
    if (!removed) return;
    pushHistory(`Removed task "${task.name}"`, () => addTaskToProject(projectId, removed.task, removed.phaseId));
    setRevision((value) => value + 1);
    refreshSchedule();
  };
  const manuallySetStatus = (task, nextStatus) => {
    if (!canEdit || !TASK_STATUSES.some((item) => item.value === nextStatus) || task.status === nextStatus) return;
    const existingProgress = Number(task.progress);
    const progress = nextStatus === "done"
      ? 100
      : nextStatus === "not-started"
        ? 0
        : Number.isFinite(existingProgress) && existingProgress > 0 && existingProgress < 100
          ? existingProgress
          : nextStatus === "review" ? 90 : 50;
    updateTask(task, { status: nextStatus, progress, remainingDurationMinutes: undefined }, `Changed status for "${task.name}" to ${statusLabel({ status: nextStatus })}`);
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
      const minutes = getTaskEffortMinutes(task, workCalendar);
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

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-gradient-to-r from-muted/40 to-card px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></span>
          <div><h3 className="text-sm font-semibold text-foreground">Task assignments</h3></div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-background">{filteredTasks.length} {filteredTasks.length === 1 ? "task" : "tasks"}</Badge>
          <Button size="sm" variant="outline" onClick={createTask} disabled={!canEdit} title={!canEdit ? "Only Project Managers can update assignments" : undefined}><Plus className="h-4 w-4" />Add task</Button>
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
          <thead><tr className="sticky top-0 z-10 bg-slate-50/95 text-[10px] font-semibold uppercase tracking-wider text-slate-500 backdrop-blur dark:bg-slate-900/95 dark:text-slate-400">
            <th className="w-[26%] px-5 py-3">Task / Requirement</th><th className="w-[21%] px-4 py-3">Assigned team</th><th className="w-[15%] px-4 py-3">Schedule</th><th className="w-[13%] px-4 py-3">Effort</th><th className="w-[10%] px-4 py-3">Status</th><th className="w-[10%] px-4 py-3">Progress</th><th className="w-[5%] px-4 py-3">Actions</th>
          </tr></thead>
          <tbody>
            {visibleTasks.map((task, index) => {
              const assignees = taskAssigneeIds(task).map(getTeamMemberById).filter(Boolean);
              const isCompleted = task.status === "done";
              const editable = canEdit && !isCompleted;
              const peopleForRole = relevantPeople(task);
              const requirement = requirementsById.get(task.requirementId);
              const resourceRole = task.role || requirement?.resourceRole || [...new Set(assignees.map((person) => person.jobTitle).filter(Boolean))].join(", ") || "Role not set";
              const progress = Math.min(100, Math.max(0, task.progress ?? 0));
              const late = isLate(task);
              const progressColor = late ? "bg-red-500" : task.status === "done" ? "bg-emerald-500" : task.status === "review" ? "bg-amber-500" : task.status === "in-progress" ? "bg-blue-500" : "bg-slate-400";
              return (
                <tr key={task.id} onClick={() => onSelectTask?.(task)} className={cn("group border-t border-border/60 transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/15", index % 2 && "bg-slate-50/60 dark:bg-slate-900/15", task.critical && "border-l-2 border-l-red-400", onSelectTask && "cursor-pointer")}>
                  <td className="px-5 py-3.5 align-top"><div className="flex items-start gap-2.5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] font-medium text-muted-foreground">{task.id}</span>{task.critical && <Badge variant="danger" className="px-1.5 py-0 text-[9px]">Critical</Badge>}</div><p className="mt-1 max-w-sm font-semibold leading-snug text-foreground">{task.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{requirement?.title ?? task.requirementId ?? "No requirement linked"}</p></div></div></td>
                  <td className="px-4 py-3.5 align-top"><div className="flex items-start gap-2.5"><div className="flex shrink-0 items-center -space-x-2">{assignees.length ? assignees.slice(0, 3).map((person) => <Avatar key={person.id} title={person.name} className="h-7 w-7 border-2 border-card text-[8px] shadow-sm ring-1 ring-border/50"><AvatarFallback className="bg-primary/10 text-primary">{person.initials ?? initialsFor(person.name)}</AvatarFallback></Avatar>) : <Avatar className="h-7 w-7 border-2 border-card text-[8px]"><AvatarFallback className="bg-muted text-muted-foreground">?</AvatarFallback></Avatar>}{assignees.length > 3 && <span className="z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[8px] font-semibold text-muted-foreground" title={assignees.slice(3).map((person) => person.name).join(", ")}>+{assignees.length - 3}</span>}</div><div className="min-w-0"><p className="whitespace-normal break-words text-xs font-medium leading-4 text-foreground">{assignees.length ? assignees.map((person) => person.name).join(", ") : "Unassigned"}</p><p className="mt-1 text-[10px] leading-3 text-muted-foreground">{resourceRole}</p></div></div>
                    {canEdit && !isCompleted && <select aria-label={`Change assignees for ${task.name}`} onClick={(event) => event.stopPropagation()} onChange={(event) => { manuallyAssign(task, event.target.value); event.target.value = ""; }} defaultValue="" className="mt-2 h-7 max-w-full rounded-md border border-input bg-background px-2 text-[10px] text-muted-foreground"><option value="" disabled>Manage team</option>{peopleForRole.map((person) => <option key={person.id} value={person.id} disabled={capacityByMember.get(person.id)?.offToday}>{taskAssigneeIds(task).includes(person.id) ? `Remove ${person.name}` : `Add ${person.name}`}{capacityByMember.get(person.id)?.offToday ? " · unavailable" : ""}</option>)}</select>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 align-top"><div className={cn("flex items-center gap-2 text-xs font-medium", late ? "text-red-600 dark:text-red-400" : "text-foreground")}><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{formatShortDate(task.start)}</div><p className={cn("mt-1.5 pl-[22px] text-[11px]", late ? "text-red-600/80 dark:text-red-400/80" : "text-muted-foreground")}>to {formatShortDate(task.end)}{late && <span className="ml-1 font-semibold">· Late</span>}</p></td>
                  <td className="px-4 py-3.5 align-top"><div className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><Input aria-label={`Effort hours for ${task.name}`} type="number" min="0" step="1" value={durationHours(task, workCalendar)} onClick={(event) => event.stopPropagation()} onChange={(event) => manuallySetDuration(task, event.target.value, durationMinutesPart(task, workCalendar))} disabled={!editable} className="h-8 w-14 px-1.5 text-center text-xs" /><span className="text-[10px] text-muted-foreground">h</span><Input aria-label={`Effort minutes for ${task.name}`} type="number" min="0" max="59" step="1" value={durationMinutesPart(task, workCalendar)} onClick={(event) => event.stopPropagation()} onChange={(event) => manuallySetDuration(task, durationHours(task, workCalendar), event.target.value)} disabled={!editable} className="h-8 w-12 px-1 text-center text-xs" /><span className="text-[10px] text-muted-foreground">m</span></div><p className="mt-1.5 pl-5 text-[10px] text-muted-foreground">{durationLabel(getTaskEffortMinutes(task, workCalendar))} estimate · {durationLabel(getTaskRemainingEffortMinutes(task, workCalendar))} remaining</p></td>
                  <td className="px-4 py-3.5 align-top"><div className="flex items-center gap-1.5"><i className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[task.status] ?? "bg-muted-foreground")} /><select aria-label={`Update status for ${task.name}`} value={task.status} disabled={!canEdit} onClick={(event) => event.stopPropagation()} onChange={(event) => manuallySetStatus(task, event.target.value)} className="h-8 min-w-28 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60">{TASK_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div></td>
                  <td className="px-4 py-3.5 align-top"><div className="flex items-center justify-between gap-2"><span className={cn("text-xs font-semibold tabular-nums", late ? "text-red-600 dark:text-red-400" : "text-foreground")}>{progress}%</span>{progress === 100 ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="text-[10px] text-muted-foreground">complete</span>}</div><div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full transition-[width]", progressColor)} style={{ width: `${progress}%` }} /></div></td>
                  <td className="px-4 py-3.5 align-top"><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${task.name}`} onClick={(event) => { event.stopPropagation(); setEditingTask(task); }} disabled={!canEdit}><Pencil className="h-3.5 w-3.5" /></Button><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" aria-label={`Remove ${task.name}`} onClick={(event) => { event.stopPropagation(); removeTask(task); }} disabled={!canEdit}><Trash2 className="h-3.5 w-3.5" /></Button></div></td>
                </tr>
              );
            })}
            {filteredTasks.length === 0 && <tr><td colSpan={7} className="px-5 py-12 text-center"><AlertCircle className="mx-auto h-5 w-5 text-muted-foreground/60" /><p className="mt-2 text-sm font-medium text-foreground">No matching tasks</p><p className="mt-1 text-xs text-muted-foreground">Try changing the search or filters.</p></td></tr>}
          </tbody>
        </table>
      </div>

      <TaskEditorDialog key={editingTask?.id} task={editingTask} open={Boolean(editingTask)} onOpenChange={closeEditor} team={team} workCalendar={workCalendar} onSave={saveEditedTask} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/15 px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <p>Showing <span className="font-medium text-foreground">{filteredTasks.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, filteredTasks.length)}</span> of <span className="font-medium text-foreground">{filteredTasks.length}</span> tasks</p>
        <div className="flex items-center gap-2"><span className="tabular-nums">Page {currentPage + 1} of {pageCount}</span><Button variant="outline" size="icon" className="h-7 w-7" aria-label="Previous page" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" className="h-7 w-7" aria-label="Next page" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage >= pageCount - 1}><ChevronRight className="h-4 w-4" /></Button></div>
      </div>
    </section>
  );
}
