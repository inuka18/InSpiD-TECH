import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus, CheckCircle2, AlertTriangle, Clock, Users } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { getTeamMemberById } from "../../../data/mockTeam";
import {
  varianceDays, isLate, isAtRisk, statusLabel, statusBadgeVariant,
  formatShortDate, daysBetween,
} from "../lib/scheduleUtils";
import { cn } from "../../../lib/utils";

function initialsFor(name) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase();
}

// ── KPI strip ─────────────────────────────────────────────────────────────────
function KpiStrip({ tasks }) {
  const total     = tasks.length;
  const done      = tasks.filter((t) => t.status === "done").length;
  const inProg    = tasks.filter((t) => t.status === "in-progress").length;
  const atRisk    = tasks.filter(isAtRisk).length;
  const onTime    = tasks.filter((t) => !isLate(t)).length;
  const totalSlip = tasks.reduce((s, t) => s + Math.max(0, varianceDays(t)), 0);
  const avgProg   = total ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / total) : 0;
  const people    = new Set(tasks.map((t) => t.assigneeId).filter(Boolean)).size;

  const tiles = [
    { label: "Total Tasks",    value: total,         color: "text-foreground",                          bg: "bg-muted/30" },
    { label: "Done",           value: done,          color: "text-emerald-600 dark:text-emerald-400",   bg: "bg-emerald-50 dark:bg-emerald-900/20" },
    { label: "In Progress",    value: inProg,        color: "text-primary",                             bg: "bg-primary/5" },
    { label: "At Risk",        value: atRisk,        color: "text-red-600 dark:text-red-400",           bg: "bg-red-50 dark:bg-red-900/20" },
    { label: "On Time",        value: onTime,        color: "text-emerald-600 dark:text-emerald-400",   bg: "bg-emerald-50 dark:bg-emerald-900/20" },
    { label: "Total Slip",     value: `${totalSlip}d`, color: totalSlip > 0 ? "text-red-600 dark:text-red-400" : "text-foreground", bg: "bg-muted/30" },
    { label: "Avg Progress",   value: `${avgProg}%`, color: "text-primary",                             bg: "bg-primary/5" },
    { label: "Resources",      value: people,        color: "text-foreground",                          bg: "bg-muted/30" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {tiles.map(({ label, value, color, bg }) => (
        <div key={label} className={cn("rounded-lg border border-border p-2.5 text-center", bg)}>
          <p className={cn("text-lg font-bold leading-none", color)}>{value}</p>
          <p className="mt-1 text-[9px] text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ value, late }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", late ? "bg-red-500" : value === 100 ? "bg-emerald-500" : "bg-primary")}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{value}%</span>
    </div>
  );
}

// ── Variance chip ─────────────────────────────────────────────────────────────
function VarianceChip({ task }) {
  const v = varianceDays(task);
  if (v > 0) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <TrendingUp className="h-2.5 w-2.5" />+{v}d
    </span>
  );
  if (v < 0) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      <TrendingDown className="h-2.5 w-2.5" />{v}d
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
      <Minus className="h-2.5 w-2.5" />On time
    </span>
  );
}

// ── Comparison table ──────────────────────────────────────────────────────────
function ComparisonTable({ tasks, onSelectTask }) {
  if (tasks.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No tasks in this window.</p>;
  }

  // Sort: at-risk first, then by baseline start
  const sorted = [...tasks].sort((a, b) => {
    const aR = isAtRisk(a) ? 0 : 1, bR = isAtRisk(b) ? 0 : 1;
    if (aR !== bR) return aR - bR;
    return new Date(a.baselineStart) - new Date(b.baselineStart);
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[800px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="bg-muted/50">
            {["#", "Task", "Assignee", "Planned Start", "Planned End", "Actual Start", "Actual End", "Dur (Plan)", "Dur (Act)", "Variance", "Progress", "Status"].map((h) => (
              <th key={h} className="border-b border-border px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((task, i) => {
            const assignee  = getTeamMemberById(task.assigneeId);
            const late      = isLate(task);
            const risk      = isAtRisk(task);
            const isEven    = i % 2 === 0;
            const planDur   = daysBetween(task.baselineStart, task.baselineEnd) + 1;
            const actDur    = daysBetween(task.start, task.end) + 1;
            return (
              <tr
                key={task.id}
                className={cn("cursor-pointer transition-colors hover:bg-primary/5", isEven ? "bg-card" : "bg-muted/10", risk && "border-l-2 border-l-red-500")}
                onClick={() => onSelectTask?.(task)}
              >
                <td className="border-b border-border/40 px-2.5 py-2 text-center text-muted-foreground/60">{i + 1}</td>
                <td className="border-b border-border/40 px-2.5 py-2 max-w-[180px]">
                  <div className="flex items-center gap-1.5">
                    {task.critical && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title="Critical path" />}
                    <span className={cn("truncate font-semibold", late ? "text-red-600 dark:text-red-400" : "text-foreground")} title={task.name}>
                      {task.name}
                    </span>
                  </div>
                  {task.phaseName && <p className="mt-0.5 text-[9px] text-muted-foreground">{task.phaseName}</p>}
                </td>
                <td className="border-b border-border/40 px-2.5 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <Avatar className="h-5 w-5 shrink-0 text-[8px]">
                      <AvatarFallback>{assignee ? initialsFor(assignee.name) : "?"}</AvatarFallback>
                    </Avatar>
                    <span className="text-muted-foreground">{assignee?.name ?? "—"}</span>
                  </div>
                </td>
                <td className="border-b border-border/40 px-2.5 py-2 whitespace-nowrap text-muted-foreground">{formatShortDate(task.baselineStart)}</td>
                <td className="border-b border-border/40 px-2.5 py-2 whitespace-nowrap text-muted-foreground">{formatShortDate(task.baselineEnd)}</td>
                <td className={cn("border-b border-border/40 px-2.5 py-2 whitespace-nowrap font-medium", late ? "text-red-600 dark:text-red-400" : "text-foreground")}>{formatShortDate(task.start)}</td>
                <td className={cn("border-b border-border/40 px-2.5 py-2 whitespace-nowrap font-medium", late ? "text-red-600 dark:text-red-400" : "text-foreground")}>{formatShortDate(task.end)}</td>
                <td className="border-b border-border/40 px-2.5 py-2 whitespace-nowrap text-muted-foreground">{planDur}d</td>
                <td className={cn("border-b border-border/40 px-2.5 py-2 whitespace-nowrap font-medium", actDur > planDur ? "text-red-600 dark:text-red-400" : actDur < planDur ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>{actDur}d</td>
                <td className="border-b border-border/40 px-2.5 py-2 whitespace-nowrap"><VarianceChip task={task} /></td>
                <td className="border-b border-border/40 px-2.5 py-2 whitespace-nowrap"><ProgressBar value={task.progress} late={late} /></td>
                <td className="border-b border-border/40 px-2.5 py-2 whitespace-nowrap">
                  <Badge variant={statusBadgeVariant(task)} className="text-[9px]">{statusLabel(task)}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
export function ViewComparisonTable({ tasks = [], label = "", onSelectTask }) {
  if (tasks.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Planned vs Actual — {label} View</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <KpiStrip tasks={tasks} />
        <ComparisonTable tasks={tasks} onSelectTask={onSelectTask} />
      </CardContent>
    </Card>
  );
}
