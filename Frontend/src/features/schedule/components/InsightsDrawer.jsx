import { BarChart3, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { BurndownChart } from "./BurndownChart";
import { getTeamMemberById } from "../../../data/mockTeam";
import {
  isTaskActiveOn,
  varianceDays,
  isLate,
  statusBadgeVariant,
  statusLabel,
  formatShortDate,
  formatDayOfWeek,
  addDays,
} from "../lib/scheduleUtils";
import { cn } from "../../../lib/utils";

function initialsFor(name) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase();
}

// Shared insights content for Week/Sprint. It can still render as the old
// docked side drawer, but the embedded mode is used when the page wants
// the charts/backlog stacked directly beneath the Gantt instead.
export function InsightsDrawer({
  open,
  onClose,
  view,
  tasks,
  rangeStart,
  rangeEnd,
  onSelectTask,
  onSelectDay,
  className,
  embedded = false,
}) {
  const days =
    view === "week"
      ? Array.from({ length: 7 }, (_, i) => {
          const date = addDays(rangeStart, i);
          return { date, tasks: tasks.filter((t) => isTaskActiveOn(t, date)) };
        })
      : [];

  return (
    <div
      className={cn(
        embedded ? "w-full" : "shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out",
        embedded ? "" : open ? "w-full lg:w-[420px]" : "w-0",
        className
      )}
    >
      <div
        className={cn(
          embedded ? "gap-6 rounded-2xl border border-border bg-card p-5 shadow-sm" : "flex h-full min-w-[320px] flex-col gap-5 rounded-xl border border-border bg-card p-4 lg:min-w-[420px]"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BarChart3 className="h-4 w-4 text-primary" />
            Variance &amp; {view === "week" ? "Day-by-Day Breakdown" : "Sprint Backlog"}
          </div>
          {!embedded && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className={embedded ? "rounded-xl border border-border bg-muted/20 p-4" : ""}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Burndown</p>
          <BurndownChart tasks={tasks} rangeStart={rangeStart} rangeEnd={rangeEnd} onSelectDay={onSelectDay} height={embedded ? 220 : 200} />
        </div>

        {view === "week" ? (
          <div className={embedded ? "min-h-0" : "min-h-0 flex-1"}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day by Day</p>
            <div className="overflow-x-auto pb-2 scrollbar-thin">
              <div className="grid min-w-[980px] grid-cols-7 gap-2">
                {days.map(({ date, tasks: dayTasks }) => {
                  const isToday = date.toDateString() === new Date().toDateString();
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  const delayed = dayTasks.filter((t) => t.critical || (t.status !== "done" && new Date(t.end) < new Date(t.baselineEnd)));
                  return (
                    <div
                      key={date.toISOString()}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectDay?.(date)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelectDay?.(date)}
                      className={cn(
                        "group flex min-h-[14rem] cursor-pointer flex-col rounded-xl border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md",
                        isToday
                          ? "border-primary/60 ring-1 ring-primary/30"
                          : isWeekend
                          ? "border-border/50 bg-muted/30"
                          : "border-border hover:border-primary/40"
                      )}
                    >
                      {/* Day header */}
                      <div className={cn(
                        "flex items-center justify-between gap-1 rounded-t-xl px-3 py-2 border-b",
                        isToday ? "bg-primary/10 border-primary/20" : isWeekend ? "bg-muted/50 border-border/40" : "bg-muted/30 border-border/50"
                      )}>
                        <div>
                          <p className={cn("text-[11px] font-bold uppercase tracking-wide", isToday ? "text-primary" : "text-muted-foreground")}>
                            {date.toLocaleDateString(undefined, { weekday: "short" })}
                          </p>
                          <p className={cn("text-sm font-semibold leading-tight", isToday ? "text-primary" : "text-foreground")}>
                            {date.getDate()}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold",
                            dayTasks.length > 0 ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                          )}>
                            {dayTasks.length}
                          </span>
                          {delayed.length > 0 && (
                            <span className="inline-flex items-center rounded-full bg-status-dropped-bg px-1.5 py-0.5 text-[9px] font-bold text-status-dropped-fg">
                              {delayed.length} late
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Task list */}
                      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 scrollbar-thin">
                        {dayTasks.length === 0 ? (
                          <div className="flex flex-1 items-center justify-center">
                            <p className="text-[10px] text-muted-foreground/60">No tasks</p>
                          </div>
                        ) : (
                          dayTasks.map((task) => {
                            const isLateTask = task.status !== "done" && new Date(task.end) > new Date(task.baselineEnd);
                            return (
                              <button
                                key={task.id}
                                onClick={(e) => { e.stopPropagation(); onSelectTask?.(task); }}
                                className={cn(
                                  "block w-full truncate rounded border px-2 py-1.5 text-left text-[10px] font-medium transition-colors",
                                  isLateTask
                                    ? "border-status-dropped-fg/30 bg-status-dropped-bg/40 text-status-dropped-fg hover:bg-status-dropped-bg/70"
                                    : task.status === "done"
                                    ? "border-status-confirmed-fg/30 bg-status-confirmed-bg/40 text-status-confirmed-fg hover:bg-status-confirmed-bg/70"
                                    : "border-border/60 bg-background text-foreground hover:border-primary/40 hover:bg-primary/5"
                                )}
                                title={task.name}
                              >
                                {task.name}
                              </button>
                            );
                          })
                        )}
                      </div>

                      {/* Footer */}
                      <div className="border-t border-border/40 px-3 py-1.5">
                        <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60 transition-colors group-hover:text-primary">
                          Open day view →
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className={embedded ? "min-h-0" : "min-h-0 flex-1 overflow-y-auto scrollbar-thin"}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sprint Backlog</p>
            {tasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No tasks in this sprint.</p>
            ) : (
              <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {tasks.map((task) => {
                  const assignee = getTeamMemberById(task.assigneeId);
                  const v = varianceDays(task);
                  const late = isLate(task);
                  return (
                    <li key={task.id}>
                      <button
                        onClick={() => onSelectTask?.(task)}
                        className="flex w-full items-start gap-2 rounded-xl border border-border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                      >
                        <Avatar className="h-6 w-6 shrink-0 text-[9px]">
                          <AvatarFallback>{assignee ? initialsFor(assignee.name) : "?"}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{task.name}</p>
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {assignee?.name ?? "Unassigned"} · {formatShortDate(task.start)} – {formatShortDate(task.end)}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <Badge variant={statusBadgeVariant(task)} className="text-[9px]">
                              {statusLabel(task)}
                            </Badge>
                            {v !== 0 && (
                              <span className={cn("text-[10px] font-medium", late ? "text-status-dropped-fg" : "text-status-confirmed-fg")}>
                                {v > 0 ? `+${v}d` : `${v}d`}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
