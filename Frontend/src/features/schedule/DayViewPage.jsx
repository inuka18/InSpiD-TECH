import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, ChevronLeft, ChevronRight, PlaneTakeoff, GitCompare } from "lucide-react";
import { RootCausePanel } from "./components/RootCausePanel";
import { BaselineCompareModal } from "./components/BaselineCompareModal";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/common/EmptyState";
import { BurndownChart } from "./components/BurndownChart";
import { ScheduleStatRow } from "./components/ScheduleStatRow";
import { TaskAssignmentList } from "./components/TaskAssignmentList";
import { VarianceDrillDownModal } from "./components/VarianceDrillDownModal";
import { getLeaveLabel } from "./lib/leaveAutomation";
import { useSchedulePhases } from "../../hooks/useSchedulePhases";
import { useResourceCapacity } from "../../hooks/useResourceCapacity";
import { useScheduleView } from "../../hooks/useScheduleView";
import { getTeamMemberById } from "../../data/mockTeam";
import {
  flattenTasks,
  isTaskActiveOn,
  isAtRisk,
  statusBadgeVariant,
  statusLabel,
  TODAY,
  formatDayOfWeek,
  formatShortDate,
  addDays,
  isSameDay,
  taskAssigneeIds,
} from "./lib/scheduleUtils";

function initialsFor(name) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase();
}

export function DayViewPage() {
  const { activeProject, activeProjectId } = useScheduleView();
  const { data: phases, loading } = useSchedulePhases(activeProjectId);
  const { data: capacity } = useResourceCapacity(activeProjectId);
  const [viewDate, setViewDate] = useState(() => new Date(activeProject?.activeSprint?.startDate ?? TODAY));
  const [selectedTask, setSelectedTask] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const sprintStart = activeProject?.activeSprint?.startDate;
    if (sprintStart) setViewDate(new Date(sprintStart));
  }, [activeProjectId]);

  // Deep link support: the Variance Drill-Down modal's task cards (and
  // Activity Feed / Notifications) land here with ?date=<iso> to jump
  // straight to the day that task starts on.
  useEffect(() => {
    const dateParam = searchParams.get("date");
    if (!dateParam) return;
    // Calendar links use a date-only value. Parsing it at midday keeps the
    // selected calendar day stable in every browser time zone.
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? `${dateParam}T12:00:00` : dateParam);
    if (!Number.isNaN(parsed.getTime())) setViewDate(parsed);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("date");
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const dayTasks = useMemo(
    () => flattenTasks(phases).filter((t) => isTaskActiveOn(t, viewDate)),
    [phases, viewDate]
  );
  const delayedTasks = dayTasks.filter(isAtRisk);
  const peopleCount = new Set(dayTasks.flatMap(taskAssigneeIds)).size;
  const offToday = capacity.filter(
    (c) => c.offToday && (c.leaveDate ? isSameDay(viewDate, c.leaveDate) : isSameDay(viewDate, TODAY))
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">{formatDayOfWeek(viewDate)}</CardTitle>
            <CardDescription>
              {dayTasks.length} task{dayTasks.length === 1 ? "" : "s"} touching this day, {delayedTasks.length} needing
              action.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setViewDate((d) => addDays(d, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant={isSameDay(viewDate, TODAY) ? "default" : "outline"}
              size="sm"
              onClick={() => setViewDate(TODAY)}
            >
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={() => setViewDate((d) => addDays(d, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
              <GitCompare className="h-4 w-4" />
              Original Schedule
            </Button>
          </div>
        </CardHeader>
      </Card>

      <ScheduleStatRow tasks={dayTasks} delayedCount={delayedTasks.length} peopleCount={peopleCount} />

      <div className="grid gap-4 xl:grid-cols-2">
      <Card>
          <CardHeader>
            <CardTitle className="text-base">Day Burndown</CardTitle>
            <CardDescription>
              Planned versus actual effort for {isSameDay(viewDate, TODAY) ? "today" : formatShortDate(viewDate)} only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BurndownChart tasks={dayTasks} rangeStart={viewDate} rangeEnd={viewDate} highlightDate={viewDate} height={180} />
          </CardContent>
      </Card>

      <RootCausePanel
        tasks={dayTasks}
        label="Day"
        onSelectCause={(category, affected) => {
          setSelectedTask({ _causeList: true, tasks: affected, title: category, subtitle: `${affected.length} task${affected.length !== 1 ? "s" : ""} affected today` });
        }}
      />
      </div>

      <TaskAssignmentList tasks={dayTasks} onSelectTask={setSelectedTask} />

      <Card className="hidden">
        <CardHeader>
          <CardTitle className="text-base">Daily assignment details</CardTitle>
          <CardDescription>Tasks scheduled for {isSameDay(viewDate, TODAY) ? "today" : formatShortDate(viewDate)} and their assigned team members.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {dayTasks.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing scheduled" description="No task's active window covers this day." />
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_minmax(15rem,.85fr)] gap-3 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
                <span>Task ID & task</span>
                <span>Assigned people</span>
              </div>
              {dayTasks.map((task) => {
              const assignees = taskAssigneeIds(task).map(getTeamMemberById).filter(Boolean);
              const assignee = assignees[0];
              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className="grid w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,.85fr)]"
                >
                  <div className="flex shrink-0 -space-x-2 sm:col-start-2 sm:row-start-1" title={assignees.map((person) => person.name).join(", ") || "Unassigned"}>
                    {assignees.length > 0 ? assignees.slice(0, 3).map((person) => (
                      <Avatar key={person.id} className="h-8 w-8 border-2 border-background text-[10px]">
                        <AvatarFallback>{initialsFor(person.name)}</AvatarFallback>
                      </Avatar>
                    )) : (
                      <Avatar className="h-8 w-8 text-[10px]"><AvatarFallback>?</AvatarFallback></Avatar>
                    )}
                  </div>
                  <div className="min-w-0 sm:contents">
                    <p className="truncate text-sm font-medium text-foreground sm:col-start-1 sm:row-start-1">
                      <span className="mr-2 font-mono text-xs font-medium text-muted-foreground">{task.id}</span>
                      {task.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:col-start-2 sm:row-start-1 sm:ml-10 sm:mt-0">
                      <Badge variant={statusBadgeVariant(task)} className="text-[10px]">
                        {statusLabel(task)}
                      </Badge>
                      <span className="text-xs font-medium text-foreground">Assigned to {assignees.map((person) => person.name).join(", ") || "Unassigned"}</span>
                      <span className="text-xs text-muted-foreground">
                        {assignee?.name ?? "Unassigned"} · {task.progress}% complete
                      </span>
                    </div>
                  </div>
                </button>
              );
              })}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Off {isSameDay(viewDate, TODAY) ? "Today" : "That Day"}</CardTitle>
          <CardDescription>Team members on PTO, from sprint capacity records.</CardDescription>
        </CardHeader>
        <CardContent>
          {offToday.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Everyone's available.</p>
          ) : (
            <ul className="space-y-2">
              {offToday.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-lg border border-dashed border-border p-3">
                  <Avatar className="h-8 w-8 shrink-0 text-[10px]">
                    <AvatarFallback>{initialsFor(c.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                    <p className="text-xs text-muted-foreground">{c.role}</p>
                    {c.offToday && <p className="mt-0.5 text-[11px] font-medium text-status-atrisk-fg">{getLeaveLabel(c.leaveType ?? "full-day", c.leaveHours)} leave</p>}
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <PlaneTakeoff className="h-3.5 w-3.5" />
                    {c.returnDate ? `Back ${formatShortDate(c.returnDate)}` : "On PTO"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
        tasks={dayTasks}
        label="Day"
        showGantt={false}
      />
    </div>
  );
}
