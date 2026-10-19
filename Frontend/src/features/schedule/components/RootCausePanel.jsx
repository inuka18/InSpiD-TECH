import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { causeStyle } from "../lib/scheduleUtils";
import { cn } from "../../../lib/utils";

const CAUSE_ORDER = ["requirement-change", "resource-disruption", "ripple-propagation"];

export function RootCausePanel({ tasks = [], label, onSelectCause }) {
  const causeTasks = tasks.filter((task) => task.cause);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-status-atrisk-fg" />
          <CardTitle className="text-base">Root Cause Analysis — {label} View</CardTitle>
        </div>
        <CardDescription>
          {causeTasks.length
            ? `${causeTasks.length} of ${tasks.length} task${tasks.length === 1 ? "" : "s"} in this ${label.toLowerCase()} have a recorded delay cause.`
            : `No delay causes recorded for this ${label.toLowerCase()}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {causeTasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No delay causes recorded for this view.</p>
        ) : CAUSE_ORDER.map((type) => {
          const count = causeTasks.filter((task) => task.cause.type === type).length;
          if (count === 0) return null;
          const pct = Math.round((count / causeTasks.length) * 100);
          const style = causeStyle(type);
          return (
            <button key={type} type="button" onClick={() => onSelectCause?.(type)} className={cn("w-full rounded-lg border border-border bg-background p-3 text-left transition-colors", onSelectCause && "cursor-pointer hover:border-primary/40 hover:bg-primary/5")}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full", style.dotClass)} /><span className="text-xs font-semibold">{style.label}</span></div>
                <div className="flex items-center gap-2"><Badge variant={style.badgeVariant} className="text-[10px]">{count} task{count !== 1 ? "s" : ""}</Badge><span className="text-[11px] font-bold text-muted-foreground">{pct}%</span></div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", style.dotClass)} style={{ width: `${pct}%` }} /></div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
