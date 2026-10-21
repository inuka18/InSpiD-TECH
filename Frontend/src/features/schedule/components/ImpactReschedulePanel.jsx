import { useMemo, useState } from "react";
import { CalendarClock, GitBranch, Save } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { getGapById } from "../../../data/mockGaps";
import { addDays, formatShortDate } from "../lib/scheduleUtils";

function slipDays(run) {
  const value = Number.parseFloat(run?.sprintImpact?.expectedSprintSlip ?? run?.weekImpact?.expectedSlip ?? "0");
  return Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : 1;
}

// Uses the approved impact assessment. It does not
// re-calculate impact: it turns that approved schedule delta into an explicit,
// reviewable change to the shared schedule task objects used by every Gantt.
export function ImpactReschedulePanel({ runs = [], tasks = [], isPM, saveVersion, pushHistory, onApplied }) {
  const eligibleRuns = useMemo(() => runs.filter((run) => run.sentToC3), [runs]);
  const [runId, setRunId] = useState(eligibleRuns[0]?.id ?? "");
  const selectedRun = eligibleRuns.find((run) => run.id === runId) ?? eligibleRuns[0];
  const gap = selectedRun ? getGapById(selectedRun.gapId) : null;
  const affectedTasks = gap ? tasks.filter((task) => gap.taskIds?.includes(task.id)) : [];
  const days = slipDays(selectedRun);

  const applyImpact = () => {
    if (!selectedRun || !gap || affectedTasks.length === 0) return;
    const snapshots = affectedTasks.map((task) => ({ task, start: task.start, end: task.end }));
    saveVersion(`Before assessed impact: ${gap.id}`, tasks);
    pushHistory(`Applied assessed impact (${gap.id})`, () => {
      snapshots.forEach(({ task, start, end }) => { task.start = start; task.end = end; });
    });
    affectedTasks.forEach((task) => {
      task.start = addDays(task.start, days);
      task.end = addDays(task.end, days);
    });
    onApplied?.({ gap, days, count: affectedTasks.length });
  };

  if (!eligibleRuns.length) return null;

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><GitBranch className="h-4 w-4" /></div>
          <div>
            <p className="text-sm font-semibold text-foreground">Apply assessed impact to schedule</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Creates a version snapshot first, then updates the affected task dates in every Schedule Gantt.</p>
          </div>
        </div>
        <Badge variant="outline">{eligibleRuns.length} handoff{eligibleRuns.length === 1 ? "" : "s"}</Badge>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Impact assessment handoff
          <select value={selectedRun?.id ?? ""} onChange={(event) => setRunId(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {eligibleRuns.map((run) => {
              const itemGap = getGapById(run.gapId);
              return <option key={run.id} value={run.id}>{run.gapId} — {itemGap?.title ?? "Impact assessment"}</option>;
            })}
          </select>
        </label>
        <Button onClick={applyImpact} disabled={!isPM || affectedTasks.length === 0} title={!isPM ? "Only Project Managers can apply a re-schedule" : undefined}>
          <Save className="h-4 w-4" />Save version &amp; apply
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" />Proposed shift: +{days} day{days === 1 ? "" : "s"}</span>
        <span>{affectedTasks.length} linked task{affectedTasks.length === 1 ? "" : "s"}</span>
        {affectedTasks.length > 0 && <span>Current window: {formatShortDate(affectedTasks[0].start)} onward</span>}
      </div>
      {affectedTasks.length === 0 && <p className="mt-3 text-xs text-status-atrisk-fg">This handoff has no linked schedule tasks, so there is nothing to re-schedule yet.</p>}
    </div>
  );
}
