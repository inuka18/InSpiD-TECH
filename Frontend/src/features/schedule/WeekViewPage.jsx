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
import { causeStyle } from "./lib/scheduleUtils";
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

const baseWeekStart = startOfWeek(TODAY);

export function WeekViewPage() {
  const { activeProjectId } = useScheduleView();
  const navigate = useNavigate();
  const { data: phases, loading } = useSchedulePhases(activeProjectId);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedTask, setSelectedTask] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const weekStart = addDays(baseWeekStart, weekOffset * 7);
  const weekEnd = endOfDay(addDays(weekStart, 6));

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
            onSelectCause={(type) => {
              const style = causeStyle(type);
              const affected = weekTasks.filter((task) => task.cause?.type === type);
              setSelectedTask({ _causeList: true, tasks: affected, title: style.label, subtitle: `${affected.length} task${affected.length !== 1 ? "s" : ""} affected this week` });
            }}
            />
          </div>
        )}

        {!loading && (
          <>
            <TaskAssignmentList tasks={weekTasks} onSelectTask={setSelectedTask} />

            <Card className="overflow-hidden">
              <CardHeader className="border-b border-border bg-muted/20">
                <CardTitle className="text-base">Weekly planner</CardTitle>
                <CardDescription>A compact day-by-day view of scheduled work. Select a task for details or a day to open its schedule.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <div className="grid min-w-[980px] grid-cols-7 divide-x divide-border">
                    {days.map(({ date, tasks }) => (
                      <section key={date.toISOString()} className="min-h-64 bg-background">
                        <button type="button" onClick={() => handleSelectDay(date)} className="w-full border-b border-border bg-muted/30 px-3 py-3 text-left transition-colors hover:bg-primary/5">
                          <p className="text-sm font-semibold text-foreground">{formatDayOfWeek(date)}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{tasks.length} task{tasks.length === 1 ? "" : "s"} scheduled</p>
                        </button>
                        <div className="space-y-2 p-2.5">
                          {tasks.length === 0 ? (
                            <p className="rounded-md border border-dashed border-border px-2 py-4 text-center text-xs text-muted-foreground">No scheduled work</p>
                          ) : tasks.slice(0, 4).map((task) => (
                            <button key={task.id} type="button" onClick={() => setSelectedTask(task)} className="w-full rounded-md border border-border px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5">
                              <p className="truncate text-xs font-semibold text-foreground">{task.name}</p>
                              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                <span className="font-mono">{task.id}</span>
                                <span className={isAtRisk(task) ? "font-medium text-status-atrisk-fg" : ""}>{task.progress}%</span>
                              </div>
                            </button>
                          ))}
                          {tasks.length > 4 && <button type="button" onClick={() => handleSelectDay(date)} className="w-full rounded-md py-1 text-xs font-medium text-primary hover:bg-primary/5">+{tasks.length - 4} more tasks</button>}
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
