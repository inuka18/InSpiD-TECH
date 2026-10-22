import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, GitCompare } from "lucide-react";
import { RootCausePanel } from "./components/RootCausePanel";
import { BaselineCompareModal } from "./components/BaselineCompareModal";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { ScheduleStatRow } from "./components/ScheduleStatRow";
import { VarianceDrillDownModal } from "./components/VarianceDrillDownModal";
import { BurndownChart } from "./components/BurndownChart";
import { TaskAssignmentList } from "./components/TaskAssignmentList";
import { GanttChart } from "./components/GanttChart";
import { getTeamMemberById } from "../../data/mockTeam";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { isLate, isSameDay, statusLabel } from "./lib/scheduleUtils";
import { useSchedulePhases } from "../../hooks/useSchedulePhases";
import { useResourceCapacity } from "../../hooks/useResourceCapacity";
import { useScheduleView } from "../../hooks/useScheduleView";
import { useWorkCalendar } from "./context/WorkCalendarContext";
import {
  flattenTasks,
  isAtRisk,
  isTaskActiveOn,
  overlapsRange,
  startOfWeek,
  addDays,
  endOfDay,
  TODAY,
  formatShortDate,
  taskAssigneeIds,
  isOnLeaveOnDate,
} from "./lib/scheduleUtils";

export function WeekViewPage() {
  const { activeProject, activeProjectId } = useScheduleView();
  const navigate = useNavigate();
  const { data: phases, loading } = useSchedulePhases(activeProjectId);
  const { data: capacity } = useResourceCapacity(activeProjectId);
  const { settings: workCalendar } = useWorkCalendar();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedTask, setSelectedTask] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const baseWeekStart = startOfWeek(activeProject?.activeSprint?.startDate ?? TODAY);
  const weekStart = addDays(baseWeekStart, weekOffset * 7);
  const weekEnd = endOfDay(addDays(weekStart, 6));
  const isCurrentWeek = weekStart <= TODAY && weekEnd >= TODAY;

  useEffect(() => {
    setWeekOffset(0);
  }, [activeProjectId]);

  // Deep link support: Activity Feed / Notifications items pointing at a
  // task land here with ?task=<id> and open it automatically, same
  // pattern as every other feature in this app.
  useEffect(() => {
    const taskId = searchParams.get("task");
    if (!taskId || loading) return;
    const match = flattenTasks(phases).find((t) => t.id === taskId);
    if (match) setSelectedTask(match);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("task");
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, phases]);

  const weekTasks = useMemo(
    () => flattenTasks(phases).filter((t) => overlapsRange(t, weekStart, weekEnd)),
    [phases, weekStart, weekEnd, workCalendar]
  );
  const delayedTasks = weekTasks.filter(isAtRisk);
  const peopleCount = new Set(weekTasks.flatMap(taskAssigneeIds)).size;
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      return { date, tasks: flattenTasks(phases).filter((task) => isTaskActiveOn(task, date)) };
    }).filter(({ date }) => workCalendar.workdays.includes(date.getDay())),
    [phases, weekStart, workCalendar]
  );
  const leaveAssignments = useMemo(() => {
    const calendarDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const tasks = flattenTasks(phases);
    return calendarDates.flatMap((date) => capacity
      .filter((resource) => isOnLeaveOnDate(resource, date))
      .map((resource) => {
        const relatedTasks = tasks.filter((task) => {
          const assignedBeforeLeave = task.originalAssigneeId === resource.memberId
            || task.prevAssigneeId === resource.memberId;
          const assignedNow = taskAssigneeIds(task).includes(resource.memberId);
          const recordedForLeave = task.reallocatedFrom === resource.name
            && task.leaveDate && isSameDay(task.leaveDate, date);
          return recordedForLeave || ((assignedNow || assignedBeforeLeave)
            && (isTaskActiveOn(task, date) || overlapsRange(task, weekStart, weekEnd)));
        });
        return { resource, date, tasks: relatedTasks };
      })
    );
  }, [weekStart, weekEnd, capacity, phases]);

  const handleSelectDay = (day) => {
    const date = new Date(day);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    navigate(`/projects/${activeProjectId}/schedule/day?date=${dateKey}`);
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-4">
        <Card className="border-primary/20 bg-primary/[0.03] shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></span>
              <div>
              <CardTitle className="text-base">
                Week of {formatShortDate(weekStart)} – {formatShortDate(weekEnd)}
              </CardTitle>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Previous week" title="Previous week" onClick={() => setWeekOffset((o) => o - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Next week" title="Next week" onClick={() => setWeekOffset((o) => o + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              {weekOffset !== 0 && <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)}>This week</Button>}
              <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
                <GitCompare className="h-4 w-4" />
                Original Schedule
              </Button>
            </div>
          </CardHeader>
        </Card>

        <ScheduleStatRow tasks={weekTasks} delayedCount={delayedTasks.length} peopleCount={peopleCount} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {loading ? (
          <Skeleton className="min-h-[38rem] w-full" />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weekly Gantt plan</CardTitle>
            </CardHeader>
            <CardContent>
              <GanttChart phases={phases} rangeStart={weekStart} rangeEnd={weekEnd} onSelectTask={setSelectedTask} />
            </CardContent>
          </Card>
        )}

        {!loading && (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Week Burndown</CardTitle>
              </CardHeader>
              <CardContent><BurndownChart tasks={weekTasks} rangeStart={weekStart} rangeEnd={weekEnd} height={220} /></CardContent>
            </Card>
            <RootCausePanel
            tasks={weekTasks}
            label="Week"
            onSelectCause={(category, affected) => {
              setSelectedTask({ _causeList: true, tasks: affected, title: category, subtitle: `${affected.length} task${affected.length !== 1 ? "s" : ""} affected this week` });
            }}
            />
          </div>
        )}

        {!loading && (
          <>
            <TaskAssignmentList tasks={weekTasks} onSelectTask={setSelectedTask} />

            {leaveAssignments.length > 0 && <Card className="overflow-hidden border-amber-200/70">
              <CardHeader className="border-b border-amber-200/60 bg-amber-50/60 py-3 dark:bg-amber-950/15">
                <div className="flex items-center justify-between"><CardTitle className="text-sm">Team leave</CardTitle><Badge variant="outline">{leaveAssignments.length} leave day{leaveAssignments.length === 1 ? "" : "s"}</Badge></div>
              </CardHeader>
              <CardContent className="divide-y divide-border p-0">
                {leaveAssignments.map(({ resource, date, tasks }) => (
                  <div key={`${resource.id}-${date.toISOString()}`} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <Avatar className="h-8 w-8 shrink-0 text-[10px]"><AvatarFallback>{resource.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</AvatarFallback></Avatar>
                    <div className="min-w-36 flex-1">
                      <p className="text-sm font-medium text-foreground">{resource.name}</p>
                      <p className="text-xs text-muted-foreground">{date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {resource.role} · {resource.leaveType ? `${resource.leaveType} leave` : "On leave"}</p>
                    </div>
                    <div className="flex min-w-52 flex-1 flex-wrap gap-1.5">
                      {tasks.length ? tasks.map((task) => <button key={task.id} type="button" onClick={() => setSelectedTask(task)} className="max-w-full truncate rounded-md border border-border bg-background px-2 py-1 text-left text-xs font-medium text-primary hover:border-primary/40 hover:bg-primary/5">{task.name}</button>) : <span className="text-xs text-muted-foreground">No tasks assigned</span>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>}

            <Card className="overflow-hidden rounded-2xl border-border/80 shadow-sm">
              <CardHeader className={`border-b border-border/70 px-5 py-4 ${isCurrentWeek ? "bg-gradient-to-r from-primary/[0.07] via-primary/[0.025] to-card" : "bg-gradient-to-r from-muted/35 to-card"}`}>
                <div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">Weekly planner</CardTitle>{isCurrentWeek && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] font-medium text-blue-700">Current week</Badge>}</div>
                <CardDescription className="mt-1">{formatShortDate(weekStart)} – {formatShortDate(weekEnd)}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto bg-muted/20 p-3 sm:p-4">
                  <div className="grid min-w-[1000px] gap-3" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
                    {days.map(({ date, tasks }) => (
                      <section key={date.toISOString()} className={`min-h-[310px] overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${isSameDay(date, TODAY) ? "border-primary/40 ring-1 ring-primary/15" : "border-border/80"}`}>
                        <button type="button" onClick={() => handleSelectDay(date)} className={`w-full min-h-[78px] border-b px-3 py-3 text-left transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${isSameDay(date, TODAY) ? "border-primary/15 bg-primary/[0.07]" : "border-border/70 bg-muted/20"}`}>
                          <div className="flex items-center justify-between gap-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{date.toLocaleDateString(undefined, { weekday: "long" })}</p>{isSameDay(date, TODAY) && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">Today</span>}</div>
                          <div className="mt-1 flex items-end justify-between"><p className="text-lg font-semibold leading-none text-foreground">{date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p><span className="text-[10px] font-medium text-muted-foreground">{tasks.length} task{tasks.length === 1 ? "" : "s"}</span></div>
                        </button>
                        <div className="min-h-48 space-y-2 p-2.5">
                          {tasks.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-border px-2 py-5 text-center text-xs text-muted-foreground">No scheduled work</p>
                          ) : tasks.slice(0, 4).map((task) => {
                            const assignees = taskAssigneeIds(task).map(getTeamMemberById).filter(Boolean);
                            const assigneeNames = assignees.map((person) => person.name).join(", ") || "Unassigned";
                            const progress = Math.min(100, Math.max(0, task.progress ?? 0));
                            const late = isLate(task);
                            const statusTone = late ? "text-red-600" : task.status === "done" ? "text-emerald-700" : task.status === "review" ? "text-amber-700" : task.status === "in-progress" ? "text-blue-700" : "text-slate-500";
                            const statusDot = late ? "bg-red-500" : task.status === "done" ? "bg-emerald-500" : task.status === "review" ? "bg-amber-500" : task.status === "in-progress" ? "bg-blue-500" : "bg-slate-400";
                            return (
                              <button key={task.id} type="button" onClick={() => setSelectedTask(task)} title={`${task.name} · ${task.id} · ${progress}% complete · ${formatShortDate(task.start)} to ${formatShortDate(task.end)} · Assigned to ${assigneeNames}`} aria-label={`Open ${task.name}, ${task.id}, ${progress}% complete, assigned to ${assigneeNames}`} className={`group relative w-full overflow-hidden rounded-lg border bg-card p-2.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selectedTask?.id === task.id ? "border-primary/50 ring-1 ring-primary/20 shadow-sm" : "border-border/80 hover:border-primary/30"}`}>
                                <span className={`absolute inset-y-0 left-0 w-[3px] ${statusDot}`} />
                                <div className="pl-1.5">
                                <div className="flex items-start justify-between gap-1.5"><p className="line-clamp-2 min-h-9 text-[11px] font-semibold leading-[1.15rem] text-foreground">{task.name}</p><span className="mt-0.5 shrink-0 text-[9px] font-semibold tabular-nums text-foreground/70">{progress}%</span></div>
                                <div className="mt-2 flex min-w-0 items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{task.id}</span>
                                  <span className={`flex shrink-0 items-center gap-1 text-[9px] font-medium ${statusTone}`} title={late ? "Delayed" : task.status}><i className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />{late ? "Delayed" : statusLabel(task)}</span>
                                </div>
                                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${statusDot}`} style={{ width: `${progress}%` }} /></div>
                                <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-border/70 pt-2" aria-label={`Assigned to ${assigneeNames}`}>
                                  <div className="flex shrink-0 items-center -space-x-1.5">
                                    {assignees.slice(0, 2).map((person) => <Avatar key={person.id} title={person.name} className="h-5 w-5 border-2 border-card text-[7px]"><AvatarFallback className="bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{person.initials ?? person.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</AvatarFallback></Avatar>)}
                                    {assignees.length > 2 && <span className="z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-muted text-[8px] font-semibold text-muted-foreground" title={assignees.slice(2).map((person) => person.name).join(", ")}>+{assignees.length - 2}</span>}
                                    {assignees.length === 0 && <Avatar title="Unassigned" className="h-5 w-5 border-2 border-card text-[7px]"><AvatarFallback className="bg-muted text-muted-foreground">—</AvatarFallback></Avatar>}
                                  </div>
                                  <span className="min-w-0 truncate text-[10px] font-medium text-muted-foreground">{assigneeNames}</span>
                                </div>
                                </div>
                              </button>
                            );
                          })}
                          {tasks.length > 4 && <button type="button" onClick={() => handleSelectDay(date)} className="w-full rounded-md px-2 py-2 text-left text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-950/30">+{tasks.length - 4} more tasks <span className="float-right text-[10px] font-medium text-muted-foreground">View day →</span></button>}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <VarianceDrillDownModal
        task={selectedTask?._causeList ? null : selectedTask}
        tasks={selectedTask?._causeList ? selectedTask.tasks : undefined}
        title={selectedTask?._causeList ? selectedTask.title : undefined}
        subtitle={selectedTask?._causeList ? selectedTask.subtitle : undefined}
        projectId={activeProjectId}
        open={Boolean(selectedTask)}
        onOpenChange={(o) => !o && setSelectedTask(null)}
      />
      <BaselineCompareModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        tasks={weekTasks}
        label="Week"
      />
    </div>
  );
}
