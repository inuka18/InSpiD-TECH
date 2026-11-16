import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/skeleton";
import { useSchedulePhases } from "../../../hooks/useSchedulePhases";
import { useResourceCapacity } from "../../../hooks/useResourceCapacity";
import { getTeamMemberById } from "../../../data/mockTeam";
import { flattenTasks, startOfMonth, addDays, isSameDay, TODAY, statusBarClass, statusLabel } from "../lib/scheduleUtils";
import { cn } from "../../../lib/utils";
import { addWorkingDays, addWorkingMinutes, endOfWorkingDays, normalizeWorkingStart, useWorkCalendar } from "../context/WorkCalendarContext";
import { useScheduleHistory } from "../context/ScheduleHistoryContext";
import { useRole, ROLES } from "../../../context/RoleContext";
import { getTaskEffortMinutes } from "../lib/requirementPlanner";


const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Legend swatches shown above the grid. These are a visual reference for the
// colors statusBarClass() applies to task pills — if your status taxonomy
// differs from this list, update the labels/dot colors below to match.
const LEGEND_ITEMS = [
  { label: "Milestone", swatch: "bg-amber-700", dot: true },
  { label: "Sprint", swatch: "bg-violet-600" },
  { label: "Public holiday", swatch: "bg-rose-500" },
  { label: "Team leave", swatch: "bg-orange-500" },
];

// The prototype is set in 2026 and is based in Sri Lanka. Keep holiday data
// close to the calendar until it is supplied by the backend/calendar service.
const PUBLIC_HOLIDAYS = [
  ["2026-06-29", "Poson Full Moon Poya Day"],
  ["2026-07-29", "Esala Full Moon Poya Day"],
  ["2026-08-26", "Milad-Un-Nabi"],
  ["2026-08-27", "Nikini Full Moon Poya Day"],
  ["2026-09-26", "Binara Full Moon Poya Day"],
];

function dateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Monday-start week helper — computed locally so the grid's week start
// doesn't depend on whatever default scheduleUtils' startOfWeek assumes.
function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun ... 6 = Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// A full alternate view for the whole Schedule feature, toggled from
// ScheduleLayout's "📅 Calendar view" button, which swaps the entire
// content area (in place of whichever Day/Week/Sprint/Project tab was
// showing) for this month grid, the same way switching tabs would. It
// owns its own month, data fetch, and drill-down modal rather than
// inheriting them from a parent page, since it no longer has one.
export function CalendarView({ projectId, project, onOpenDay }) {
  const { data: phases, loading } = useSchedulePhases(projectId);
  const { data: capacity } = useResourceCapacity(projectId);
  const navigate = useNavigate();
  const calendarToday = projectId === "proj-inspid-platform" ? new Date() : TODAY;
  const [monthAnchor, setMonthAnchor] = useState(() => project?.startDate ? new Date(project.startDate) : TODAY);
  const { settings } = useWorkCalendar();
  const { pushHistory, refreshSchedule } = useScheduleHistory();
  const { role } = useRole();
  const canReschedule = role === ROLES.PM;


  useEffect(() => {
    setMonthAnchor(project?.startDate ? new Date(project.startDate) : TODAY);
  }, [projectId, project?.startDate]);


  const tasks = useMemo(() => flattenTasks(phases), [phases, settings]);
  const leaveByDate = useMemo(() => {
    const entries = new Map();
    const addLeave = (date, name, label) => {
      if (!date) return;
      const key = dateKey(date);
      entries.set(key, [...(entries.get(key) ?? []), { name, label }]);
    };

    capacity.forEach((member) => {
      if (member.leaveDate) addLeave(member.leaveDate, member.name, "Leave");
      else if (member.offToday) addLeave(calendarToday, member.name, "Leave");
    });
    tasks.forEach((task) => {
      if (task.leaveDate) addLeave(task.leaveDate, getTeamMemberById(task.assigneeId)?.name ?? "Team member", task.leaveType === "half-day" ? "Half-day leave" : "Leave");
    });
    return entries;
  }, [capacity, tasks, calendarToday]);

  const gridStart = mondayOf(startOfMonth(monthAnchor));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const anchorMonth = monthAnchor.getMonth();
  const monthLabel = monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const sprint = project?.activeSprint;
  const sprintStartDate = sprint ? addWorkingDays(new Date(sprint.startDate), 0, settings.workdays) : null;
  const sprintEndDate = sprintStartDate ? endOfWorkingDays(sprintStartDate, Number(settings.sprintDays ?? 10), settings.workdays) : null;

  const tasksForDay = (day) =>
    tasks.filter((t) => {
      const start = new Date(t.start);
      const end = new Date(t.end);
      return (
        day >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) &&
        day <= new Date(end.getFullYear(), end.getMonth(), end.getDate())
      );
    });

  const shiftMonth = (delta) => {
    setMonthAnchor((d) => {
      const next = new Date(d);
      next.setMonth(next.getMonth() + delta);
      return next;
    });
  };

  const shiftYear = (delta) => {
    setMonthAnchor((d) => {
      const next = new Date(d);
      next.setFullYear(next.getFullYear() + delta);
      return next;
    });
  };

  const openDay = (day) => {
    onOpenDay?.();
    navigate(`/projects/${projectId}/schedule/day?date=${dateKey(day)}`);
  };

  const handleTaskDrop = (event, targetDay) => {
    event.preventDefault();
    const task = tasks.find((item) => item.id === event.dataTransfer.getData("text/task-id"));
    if (!task || !canReschedule) return;
    const originalStart = task.start;
    const originalEnd = task.end;
    const sourceDay = new Date(`${event.dataTransfer.getData("text/source-date")}T12:00:00`);
    if (Number.isNaN(sourceDay.getTime()) || !settings.workdays.includes(targetDay.getDay())) return;
    const taskStart = new Date(task.start);
    const sourceDate = new Date(sourceDay.getFullYear(), sourceDay.getMonth(), sourceDay.getDate());
    const startDate = new Date(taskStart.getFullYear(), taskStart.getMonth(), taskStart.getDate());
    let workdayOffset = 0;
    for (const cursor = new Date(startDate); cursor < sourceDate; cursor.setDate(cursor.getDate() + 1)) {
      if (settings.workdays.includes(cursor.getDay())) workdayOffset += 1;
    }
    const nextStart = normalizeWorkingStart(addWorkingDays(targetDay, -workdayOffset, settings.workdays), settings);
    if (dateKey(nextStart) === dateKey(task.start)) return;
    task.start = nextStart.toISOString();
    task.end = addWorkingMinutes(nextStart, getTaskEffortMinutes(task, settings), settings).toISOString();
    pushHistory(`Rescheduled "${task.name}" from calendar`, () => {
      task.start = originalStart;
      task.end = originalEnd;
    });
    refreshSchedule();
  };

  if (loading) {
    return <Skeleton className="h-[36rem] w-full rounded-xl" />;
  }

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border pb-3">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            {item.dot ? (
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", item.swatch)} />
            ) : (
              <span
                className={cn(
                  "h-2.5 w-4 shrink-0 rounded-sm",
                  item.swatch
                )}
              />
            )}
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Month nav */}
      <div className="grid grid-cols-3 items-center">
        <div />
        <div className="flex items-center justify-center gap-1.5">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => shiftYear(-1)} aria-label="Previous year">
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="min-w-[10rem] text-center text-lg font-semibold text-foreground">{monthLabel}</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => shiftYear(1)} aria-label="Next year">
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setMonthAnchor(calendarToday)}>
            Today
          </Button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border pb-2">
        {WEEKDAY_LABELS.map((d, i) => (
          <div
            key={d}
            className={cn(
              "text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground",
              !settings.workdays.includes((i + 1) % 7) && "text-muted-foreground/70"
            )}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-2 rounded-xl bg-muted/30 p-2">
        {days.map((day, idx) => {
          const inMonth = day.getMonth() === anchorMonth;
          const today = isSameDay(day, calendarToday);
          const weekend = !settings.workdays.includes(day.getDay());
          const isWorkingDay = settings.workdays.includes(day.getDay());
          const dayTasks = inMonth && isWorkingDay ? tasksForDay(day) : [];
          const milestoneCount = dayTasks.filter((task) => task.milestone).length;
          const inSprint = sprint && day >= sprintStartDate && day <= sprintEndDate;
          const sprintStart = sprint && isSameDay(day, sprintStartDate);
          const leaves = leaveByDate.get(dateKey(day)) ?? [];

          return (
            <button
              key={idx}
              type="button"
              onClick={() => openDay(day)}
              onDragOver={canReschedule && settings.workdays.includes(day.getDay()) ? (event) => event.preventDefault() : undefined}
              onDrop={canReschedule && settings.workdays.includes(day.getDay()) ? (event) => handleTaskDrop(event, day) : undefined}
              aria-label={`Open day view for ${day.toLocaleDateString()}`}
              className={cn(
                "min-h-[6.5rem] rounded-lg border p-2 text-left transition-all hover:border-primary/50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                inMonth ? "border-border bg-background" : "border-border/50 bg-muted/20",
                inMonth && weekend && "border-rose-100 bg-rose-50/70",
                inMonth && !isWorkingDay && "opacity-75",
                inMonth && inSprint && "border-t-2 border-t-violet-500",
                today && "border-2 border-blue-400 bg-background"
              )}
            >
              <span className={cn("text-sm font-medium", inMonth ? (weekend ? "text-rose-700" : "text-foreground") : "text-muted-foreground/50")}>
                {day.getDate()}
              </span>

              {inMonth && sprintStart && (
                <span className="mt-1 block truncate rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold text-white" title={sprint.name}>
                  {sprint.name}
                </span>
              )}

              {inMonth && PUBLIC_HOLIDAYS.filter(([date]) => date === dateKey(day)).map(([date, name]) => (
                <span key={date} className="mt-1 block truncate rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-800" title={name}>
                  {name}
                </span>
              ))}

              {inMonth && leaves.slice(0, 1).map((leave) => (
                <span key={`${leave.name}-${leave.label}`} className="mt-1 block truncate rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800" title={`${leave.name} · ${leave.label}`}>
                  {leave.name} · {leave.label}
                </span>
              ))}

              {milestoneCount > 0 && (
                <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-amber-800" title={`${milestoneCount} milestone${milestoneCount === 1 ? "" : "s"}`}>
                  <span className="h-2 w-2 rounded-full bg-amber-700" />
                  {milestoneCount} milestone{milestoneCount === 1 ? "" : "s"}
                </span>
              )}
              {inMonth && dayTasks.length > 0 && (
                <div className="mt-1 space-y-1">
                  {dayTasks.slice(0, 3).map((task) => (
                    <div
                      key={task.id}
                      draggable={canReschedule}
                      onDragStart={canReschedule ? (event) => {
                        event.stopPropagation();
                        event.dataTransfer.setData("text/task-id", task.id);
                        event.dataTransfer.setData("text/source-date", dateKey(day));
                        event.dataTransfer.effectAllowed = "move";
                      } : undefined}
                      onClick={(event) => event.stopPropagation()}
                      title={`${task.name} · ${statusLabel(task)} · ${canReschedule ? "Drag to reschedule" : task.id}`}
                      className={cn("truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white", statusBarClass(task), canReschedule && "cursor-grab active:cursor-grabbing")}
                    >
                      {task.name}
                    </div>
                  ))}
                  {dayTasks.length > 3 && <span className="block truncate px-1 text-[9px] text-muted-foreground">+{dayTasks.length - 3} more tasks</span>}
                </div>
              )}
            </button>
          );
        })}
      </div>

    </div>
  );
}
