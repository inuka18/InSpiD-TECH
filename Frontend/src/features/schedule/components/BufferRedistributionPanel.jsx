import { Layers, CheckCircle2, ArrowRight } from "lucide-react";
import { Badge } from "../../../components/ui/badge";

const MAX_VISIBLE_TASKS = 5;

// The two-column buffer view on Schedule Overview. Each
// critical task's own `donor` (from Redistribute Buffers, see
// pullTaskInByDays and task.bufferDonor) decides its own badge, so a
// second click after new tasks slip can redistribute again without
// resetting tasks already buffered. Undo (the global history stack)
// reverts a redistribution the same way it reverts a drag: it restores
// the exact end date and bufferDonor tag pullTaskInByDays overwrote.
export function BufferRedistributionPanel({ isPM, criticalTasks, donorTasks }) {
  const anyBuffered = criticalTasks.some((c) => c.donor);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Layers className="h-4 w-4 text-primary" />
        Slack &amp; Buffer Redistribution
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {anyBuffered
          ? "Buffer sourced from non-critical donor tasks. Task end dates were pulled in by Redistribute Buffers."
          : isPM
            ? "Use ↺ Redistribute Buffers above to pull critical tasks in using slack from donor tasks below."
            : "Only Project Managers can trigger redistribution, view-only here."}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Critical tasks needing buffer ({criticalTasks.length})
          </p>
          <div className="space-y-2">
            {criticalTasks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                No critical-path tasks behind baseline right now.
              </p>
            ) : (
              criticalTasks.slice(0, MAX_VISIBLE_TASKS).map(({ task, behindDays, donor }) => (
                <div key={task.id} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">{task.name}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{task.progress}% complete</p>
                    </div>
                    {donor ? (
                      <Badge variant="success" className="shrink-0 text-[10px]">
                        <CheckCircle2 className="h-3 w-3" />
                        Buffered
                      </Badge>
                    ) : (
                      <Badge variant="danger" className="shrink-0 text-[10px]">
                        +{behindDays}d behind
                      </Badge>
                    )}
                  </div>
                  {donor && (
                    <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      buffer sourced from {donor.name}
                    </p>
                  )}
                </div>
              ))
            )}
            {criticalTasks.length > MAX_VISIBLE_TASKS && (
              <p className="px-1 pt-1 text-[11px] text-muted-foreground">
                Showing {MAX_VISIBLE_TASKS} of {criticalTasks.length} critical tasks.
              </p>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Non-critical donors ({donorTasks.length})
          </p>
          <div className="space-y-2">
            {donorTasks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                No non-critical tasks with spare slack right now.
              </p>
            ) : (
              donorTasks.slice(0, MAX_VISIBLE_TASKS).map(({ task }) => (
                <div key={task.id} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">{task.name}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{task.progress}% complete</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      Slack available
                    </Badge>
                  </div>
                </div>
              ))
            )}
            {donorTasks.length > MAX_VISIBLE_TASKS && (
              <p className="px-1 pt-1 text-[11px] text-muted-foreground">
                Showing {MAX_VISIBLE_TASKS} of {donorTasks.length} non-critical tasks.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
