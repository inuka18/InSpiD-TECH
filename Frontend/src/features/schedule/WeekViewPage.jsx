import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, GitCompare } from "lucide-react";
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
import { isLate, isSameDay } from "./lib/scheduleUtils";
import { useSchedulePhases } from "../../hooks/useSchedulePhases";
import { useScheduleView } from "../../hooks/useScheduleView";
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
  formatDayOfWeek,
  taskAssigneeIds,
} from "./lib/scheduleUtils";

export function WeekViewPage() {
  const { activeProject, activeProjectId } = useScheduleView();
  const navigate = useNavigate();
  const { data: phases, loading } = useSchedulePhases(activeProjectId);
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
    [phases, weekStart, weekEnd]
  );
  const delayedTasks = weekTasks.filter(isAtRisk);
  const peopleCount = new Set(weekTasks.flatMap(taskAssigneeIds)).size;
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      return { date, tasks: flattenTasks(phases).filter((task) => isTaskActiveOn(task, date)) };
    }),
    [phases, weekStart]
  );

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
            <div>
              <CardTitle className="text-base">
                Week of {formatShortDate(weekStart)} – {formatShortDate(weekEnd)}
              </CardTitle>
              <CardDescription>A day-by-day assignment plan for the selected week.</CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeekOffset((o) => o + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
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
              <CardDescription>Only tasks that overlap the selected seven-day week are shown.</CardDescription>
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
                <CardDescription>Planned versus actual effort for this seven-day period.</CardDescription>
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

            <Card className="overflow-hidden">
              <CardHeader className={`border-b border-border px-4 py-4 ${isCurrentWeek ? "bg-primary/[0.035]" : "bg-background"}`}>
                <div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">Weekly planner</CardTitle>{isCurrentWeek && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] font-medium text-blue-700">Current week</Badge>}</div>
                <CardDescription>Week of {formatShortDate(weekStart)} – {formatShortDate(weekEnd)} · Select a task for details or a day to open its schedule.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <div className="grid min-w-[1470px] grid-cols-7 divide-x divide-border bg-card">
                    {days.map(({ date, tasks }) => (
                      <section key={date.toISOString()} className="min-h-64 bg-card transition-colors hover:bg-slate-50/40 dark:hover:bg-slate-900/20">
                        <button type="button" onClick={() => handleSelectDay(date)} className={`w-full min-h-[78px] border-b border-border px-3 py-3 text-left transition-colors hover:bg-blue-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-blue-950/30 ${isSameDay(date, TODAY) ? "bg-blue-50/80 dark:bg-blue-950/25" : "bg-background"}`}>
                          <div className="flex items-center justify-between gap-1"><p className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{formatDayOfWeek(date)}</p>{isSameDay(date, TODAY) && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">Today</span>}</div>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{tasks.length} task{tasks.length === 1 ? "" : "s"} scheduled</p>
                        </button>
                        <div className="min-h-48 space-y-2.5 p-2.5">
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
                              <button key={task.id} type="button" onClick={() => setSelectedTask(task)} title={`${task.name} · ${task.id} · ${progress}% complete · ${formatShortDate(task.start)} to ${formatShortDate(task.end)} · Assigned to ${assigneeNames}`} aria-label={`Open ${task.name}, ${task.id}, ${progress}% complete, assigned to ${assigneeNames}`} className={`group w-full rounded-[10px] border bg-card px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:border-blue-300 hover:bg-blue-50/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selectedTask?.id === task.id ? "border-blue-400 ring-1 ring-blue-200 dark:ring-blue-900" : "border-border"}`}>
                                <p className="truncate text-sm font-semibold leading-5 text-foreground">{task.name}</p>
                                <div className="mt-2 flex min-w-0 items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{task.id}</span>
                                  <span className="flex shrink-0 items-center gap-1.5" title={late ? "Delayed" : task.status}><i className={`h-1.5 w-1.5 rounded-full ${statusDot}`} /><span className={`text-xs font-semibold tabular-nums ${statusTone}`}>{progress}%</span></span>
                                </div>
                                <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-border/70 pt-2" aria-label={`Assigned to ${assigneeNames}`}>
                                  <div className="flex shrink-0 items-center -space-x-1.5">
                                    {assignees.slice(0, 2).map((person) => <Avatar key={person.id} title={person.name} className="h-5 w-5 border-2 border-card text-[7px]"><AvatarFallback className="bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{person.initials ?? person.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</AvatarFallback></Avatar>)}
                                    {assignees.length > 2 && <span className="z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-muted text-[8px] font-semibold text-muted-foreground" title={assignees.slice(2).map((person) => person.name).join(", ")}>+{assignees.length - 2}</span>}
                                    {assignees.length === 0 && <Avatar title="Unassigned" className="h-5 w-5 border-2 border-card text-[7px]"><AvatarFallback className="bg-muted text-muted-foreground">—</AvatarFallback></Avatar>}
                                  </div>
                                  <span className="min-w-0 truncate text-[10px] font-medium text-muted-foreground">{assigneeNames}</span>
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
