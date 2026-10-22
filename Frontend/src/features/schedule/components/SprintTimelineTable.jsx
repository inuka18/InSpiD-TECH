import { useMemo } from "react";
import { CheckCircle2, AlertTriangle, TrendingUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../../components/ui/card";
import { overlapsRange, isAtRisk, varianceDays, formatShortDate, addDays, daysBetween } from "../lib/scheduleUtils";
import { cn } from "../../../lib/utils";
import { useWorkCalendar } from "../context/WorkCalendarContext";

function buildAllSprints(tasks, activeSprint, sprintLength) {
  if (tasks.length === 0) return [];

  const projectStart = activeSprint?.startDate
    ? new Date(activeSprint.startDate)
    : new Date(Math.min(...tasks.map((t) => new Date(t.baselineStart))));
  const projectEnd   = new Date(Math.max(...tasks.map((t) => new Date(t.end))));

  const sprints = [];
  let cur = new Date(projectStart);
  cur.setHours(9, 0, 0, 0);
  let idx = activeSprint?.number ?? 1;

  while (cur <= projectEnd) {
    const start = new Date(cur);
    const end   = new Date(addDays(cur, sprintLength - 1));
    end.setHours(18, 0, 0, 0);

    const isActive = activeSprint ? idx === activeSprint.number : false;
    const label = isActive ? activeSprint.name : `Sprint ${idx}`;

    const sprintTasks = tasks.filter((task) => {
      const assignedSprint = Number.isInteger(task.plannedSprintNumber)
        ? task.plannedSprintNumber
        : task.status === "done" && Number.isInteger(task.sprintNumber) ? task.sprintNumber : null;
      return assignedSprint === null ? overlapsRange(task, start, end) : assignedSprint === idx;
    });
    const delayed     = sprintTasks.filter(isAtRisk);
    const onTrack     = sprintTasks.filter((t) => !isAtRisk(t));
    const totalSlip   = delayed.reduce((s, t) => s + Math.max(0, varianceDays(t)), 0);

    const actualEnd = sprintTasks.length > 0
      ? new Date(Math.max(...sprintTasks.map((t) => new Date(t.end))))
      : end;

    const sprintVariance = daysBetween(end, actualEnd);

    const health = delayed.length === 0
      ? "on-track"
      : delayed.length <= Math.ceil(sprintTasks.length / 3)
      ? "at-risk"
      : "delayed";

    sprints.push({
      id: `sprint-${idx}`,
      label,
      isActive,
      number: idx,
      start,
      end,
      actualEnd,
      sprintVariance,
      total:    sprintTasks.length,
      onTrack:  onTrack.length,
      delayed:  delayed.length,
      totalSlip,
      health,
      avgProgress: sprintTasks.length
        ? Math.round(sprintTasks.reduce((s, t) => s + t.progress, 0) / sprintTasks.length)
        : 0,
    });

    cur = addDays(cur, sprintLength);
    idx++;
  }

  return sprints;
}

function HealthBadge({ health }) {
  if (health === "on-track") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      <CheckCircle2 className="h-2.5 w-2.5" />On Track
    </span>
  );
  if (health === "at-risk") return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      <AlertTriangle className="h-2.5 w-2.5" />At Risk
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <AlertTriangle className="h-2.5 w-2.5" />Delayed
    </span>
  );
}

export function SprintTimelineTable({ tasks = [], activeSprint }) {
  const { settings } = useWorkCalendar();
  const sprintLength = Number(settings.sprintDays ?? 10);
  const sprints = useMemo(() => buildAllSprints(tasks, activeSprint, sprintLength), [tasks, activeSprint, sprintLength]);

  if (sprints.length === 0) return null;

  const totalSprints = sprints.length;
  const onTrackCount = sprints.filter((s) => s.health === "on-track").length;
  const delayedCount = sprints.filter((s) => s.health === "delayed").length;
  const atRiskCount  = sprints.filter((s) => s.health === "at-risk").length;

  const HEADERS = ["Sprint", "Planned Start", "Planned End", "Actual End", "Tasks", "On Track", "Delayed", "Slip", "Avg %", "Health"];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">All Sprints — Original vs Actual</CardTitle>
            </div>
            <CardDescription className="mt-0.5">
              {totalSprints} sprint{totalSprints !== 1 ? "s" : ""} derived from project task range · {sprintLength}-day windows
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              {onTrackCount} on track
            </span>
            {atRiskCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                {atRiskCount} at risk
              </span>
            )}
            {delayedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                {delayedCount} delayed
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="bg-muted/40">
                {HEADERS.map((h) => (
                  <th key={h} className="border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sprints.map((sprint, i) => {
                const isEven = i % 2 === 0;
                const slipColor = sprint.sprintVariance > 0
                  ? "text-red-600 dark:text-red-400"
                  : sprint.sprintVariance < 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground";

                return (
                  <tr key={sprint.id} className={cn(isEven ? "bg-card" : "bg-muted/10", sprint.isActive && "ring-1 ring-inset ring-primary/30")}>
                    {/* Sprint name */}
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {sprint.isActive && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse" title="Active sprint" />
                        )}
                        <span className={cn("font-semibold", sprint.isActive ? "text-primary" : "text-foreground")}>
                          {sprint.label}
                        </span>
                      </div>
                    </td>
                    {/* Planned start */}
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatShortDate(sprint.start)}
                    </td>
                    {/* Planned end */}
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                      {formatShortDate(sprint.end)}
                    </td>
                    {/* Actual end */}
                    <td className={cn("border-b border-border/40 px-3 py-2.5 whitespace-nowrap font-semibold", sprint.sprintVariance > 0 ? "text-red-600 dark:text-red-400" : "text-foreground")}>
                      {formatShortDate(sprint.actualEnd)}
                    </td>
                    {/* Tasks */}
                    <td className="border-b border-border/40 px-3 py-2.5 text-center font-medium text-foreground">
                      {sprint.total}
                    </td>
                    {/* On track */}
                    <td className="border-b border-border/40 px-3 py-2.5 text-center font-bold text-emerald-600 dark:text-emerald-400">
                      {sprint.onTrack}
                    </td>
                    {/* Delayed */}
                    <td className="border-b border-border/40 px-3 py-2.5 text-center font-bold text-red-600 dark:text-red-400">
                      {sprint.delayed}
                    </td>
                    {/* Slip */}
                    <td className={cn("border-b border-border/40 px-3 py-2.5 whitespace-nowrap font-bold", slipColor)}>
                      {sprint.sprintVariance > 0 ? `+${sprint.sprintVariance}d` : sprint.sprintVariance < 0 ? `${sprint.sprintVariance}d` : "—"}
                    </td>
                    {/* Avg progress */}
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn("h-full rounded-full", sprint.health === "on-track" ? "bg-emerald-500" : sprint.health === "at-risk" ? "bg-amber-500" : "bg-red-500")}
                            style={{ width: `${sprint.avgProgress}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground">{sprint.avgProgress}%</span>
                      </div>
                    </td>
                    {/* Health */}
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap">
                      <HealthBadge health={sprint.health} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
