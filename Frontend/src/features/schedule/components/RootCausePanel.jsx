import { AlertTriangle, CircleHelp, Code2, Cpu, Server, UsersRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { cn } from "../../../lib/utils";

const CAUSE_CATEGORIES = [
  { key: "technical", label: "Technical", icon: Code2, color: "text-blue-700 dark:text-blue-300", dot: "bg-blue-600 dark:bg-blue-500", track: "bg-blue-100 dark:bg-blue-950/60" },
  { key: "human", label: "Human", icon: UsersRound, color: "text-violet-700 dark:text-violet-300", dot: "bg-violet-600 dark:bg-violet-500", track: "bg-violet-100 dark:bg-violet-950/60" },
  { key: "hardware", label: "Hardware", icon: Cpu, color: "text-amber-700 dark:text-amber-300", dot: "bg-amber-500 dark:bg-amber-400", track: "bg-amber-100 dark:bg-amber-950/60" },
  { key: "server", label: "Server", icon: Server, color: "text-cyan-700 dark:text-cyan-300", dot: "bg-cyan-600 dark:bg-cyan-500", track: "bg-cyan-100 dark:bg-cyan-950/60" },
  { key: "other", label: "Other", icon: CircleHelp, color: "text-slate-600 dark:text-slate-300", dot: "bg-slate-500 dark:bg-slate-400", track: "bg-slate-100 dark:bg-slate-800" },
];

function classifyCause(task) {
  const type = task.cause?.type ?? "";
  const details = `${task.name ?? ""} ${task.cause?.description ?? ""}`.toLowerCase();
  if (type === "resource-disruption" || /over.?allocat|capacity|leave|pto|reviewer|handoff|staff|team member/.test(details)) return "human";
  if (/hardware|device|android|ios|enclave|firmware|sensor|chipset/.test(details)) return "hardware";
  if (/server|backend|database|network|cloud|infrastructure|deployment|api outage|service outage/.test(details)) return "server";
  if (["requirement-change", "ripple-propagation"].includes(type) || /technical|complexity|integration|implementation|code|build|test matrix|compatib/.test(details)) return "technical";
  return "other";
}

export function RootCausePanel({ tasks = [], label, onSelectCause }) {
  const causeTasks = tasks.filter((task) => task.cause);
  const denominator = Math.max(causeTasks.length, 1);
  const categories = CAUSE_CATEGORIES.map((category) => ({
    ...category,
    tasks: causeTasks.filter((task) => classifyCause(task) === category.key),
  }));
  return (
    <Card className="overflow-hidden border-border bg-card shadow-sm">
      <CardHeader className="border-b border-border bg-muted/20 pb-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Schedule diagnostics</p>
            <CardTitle className="text-base">Root Cause Analysis{label ? ` · ${label}` : ""}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 p-4">
        {categories.map((category) => {
          const Icon = category.icon;
          const count = category.tasks.length;
          const percent = causeTasks.length ? Math.round((count / denominator) * 100) : 0;
          const content = (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", category.track, category.color)}><Icon className="h-4 w-4" /></span>
                  <span className="truncate text-xs font-semibold text-foreground">{category.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] font-semibold tabular-nums text-foreground">{count}</span>
                  <span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">{percent}%</span>
                </span>
              </div>
              <div className={cn("mt-2 h-1.5 overflow-hidden rounded-full", category.track)}>
                <div className={cn("h-full rounded-full transition-[width]", category.dot)} style={{ width: `${percent}%` }} />
              </div>
            </>
          );
          return onSelectCause && count > 0 ? (
            <button
              key={category.key}
              type="button"
              onClick={() => onSelectCause(category.label, category.tasks)}
              className="w-full rounded-lg border border-border bg-background p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {content}
            </button>
          ) : (
            <div key={category.key} className="rounded-lg border border-border bg-background p-3">{content}</div>
          );
        })}
        <p className="px-1 pt-1 text-[10px] leading-relaxed text-muted-foreground">Categories are inferred from the existing task cause and description.</p>
      </CardContent>
    </Card>
  );
}
