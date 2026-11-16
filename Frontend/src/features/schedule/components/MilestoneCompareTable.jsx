import { Diamond, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { varianceDays, isLate, isAtRisk, formatShortDate } from "../lib/scheduleUtils";
import { cn } from "../../../lib/utils";

function StatusIcon({ task }) {
  if (task.status === "done") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  if (isAtRisk(task)) return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />;
  return <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function MilestoneCompareTable({ tasks = [] }) {
  const milestones = tasks.filter((task) => task.milestone);
  const atRisk = milestones.filter(isAtRisk).length;
  const onTrack = milestones.length - atRisk;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Diamond className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Milestone Tracker — Original vs Actual</CardTitle>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{onTrack} on track</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">{atRisk} at risk</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-0 text-xs">
            <thead><tr className="bg-muted/40">
              {["", "Milestone", "Phase", "Original Date", "Actual Date", "Variance", "Progress", "Status"].map((heading, index) => (
                <th key={index} className="border-b border-border px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap">{heading}</th>
              ))}
            </tr></thead>
            <tbody>
              {milestones.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">No milestones yet. Mark a task as a milestone in the Gantt chart to track it here.</td></tr>}
              {milestones.map((task, index) => {
                const variance = varianceDays(task);
                const late = isLate(task);
                return (
                  <tr key={task.id} className={index % 2 === 0 ? "bg-card" : "bg-muted/10"}>
                    <td className="border-b border-border/40 px-3 py-2.5"><StatusIcon task={task} /></td>
                    <td className="border-b border-border/40 px-3 py-2.5 max-w-[200px]"><div className="flex items-center gap-1.5"><Diamond className="h-3 w-3 shrink-0 text-primary" /><span className="truncate font-semibold text-foreground" title={task.name}>{task.name}</span></div></td>
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap text-muted-foreground">{task.phaseName ?? "—"}</td>
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatShortDate(task.baselineEnd)}</td>
                    <td className={cn("border-b border-border/40 px-3 py-2.5 whitespace-nowrap font-semibold", late ? "text-red-600 dark:text-red-400" : "text-foreground")}>{formatShortDate(task.end)}</td>
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap">
                      {variance > 0 ? <span className="inline-flex items-center gap-1 font-bold text-red-600 dark:text-red-400"><AlertTriangle className="h-3 w-3" />+{variance}d late</span> : variance < 0 ? <span className="font-bold text-emerald-600 dark:text-emerald-400">{Math.abs(variance)}d early</span> : <span className="text-muted-foreground">On time</span>}
                    </td>
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap"><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", task.status === "done" ? "bg-emerald-500" : late ? "bg-red-500" : "bg-primary")} style={{ width: `${task.progress}%` }} /></div><span className="text-muted-foreground">{task.progress}%</span></div></td>
                    <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap"><Badge variant={task.status === "done" ? "success" : isAtRisk(task) ? "danger" : task.status === "review" ? "info" : "outline"} className="text-[9px]">{task.status === "done" ? "Done" : task.status === "review" ? "Review" : task.status === "in-progress" ? "In Progress" : "Not Started"}</Badge></td>
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
