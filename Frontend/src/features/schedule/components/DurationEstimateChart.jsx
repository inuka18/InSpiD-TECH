import { daysBetween } from "../lib/scheduleUtils";

function duration(task, startKey, endKey) {
  return Math.max(1, daysBetween(task[startKey], task[endKey]) + 1);
}

// Compares original estimates with the current re-optimized plan.
export function DurationEstimateChart({ tasks = [], onSelectTask }) {
  const rows = tasks
    .map((task) => ({ task, planned: duration(task, "baselineStart", "baselineEnd"), forecast: duration(task, "start", "end") }))
    .sort((a, b) => Math.abs(b.forecast - b.planned) - Math.abs(a.forecast - a.planned))
    .slice(0, 6);
  const maxDays = Math.max(1, ...rows.flatMap((row) => [row.planned, row.forecast]));

  if (!rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">No task estimates to compare yet.</p>;

  return (
    <div className="space-y-3">
      {rows.map(({ task, planned, forecast }) => {
        const delta = forecast - planned;
        const isLonger = delta > 0;
        return (
          <button key={task.id} type="button" onClick={() => onSelectTask?.(task)} className="w-full rounded-lg p-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-xs font-medium text-foreground">{task.name}</span>
              <span className={isLonger ? "shrink-0 text-xs font-semibold text-status-dropped-fg" : "shrink-0 text-xs font-semibold text-status-confirmed-fg"}>{planned}d → {forecast}d {delta ? `(${delta > 0 ? "+" : ""}${delta}d)` : ""}</span>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2"><span className="w-14 text-[10px] text-muted-foreground">Planned</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary/45" style={{ width: `${(planned / maxDays) * 100}%` }} /></span></div>
              <div className="flex items-center gap-2"><span className="w-14 text-[10px] text-muted-foreground">Forecast</span><span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className={isLonger ? "block h-full rounded-full bg-status-dropped-fg" : "block h-full rounded-full bg-status-confirmed-fg"} style={{ width: `${(forecast / maxDays) * 100}%` }} /></span></div>
            </div>
          </button>
        );
      })}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground"><span>Planned = original baseline duration</span><span>Forecast = current re-optimized duration</span></div>
    </div>
  );
}
