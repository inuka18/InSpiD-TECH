import { useMemo, useState } from "react";
import { CalendarClock, Diamond, X, ZoomIn, ZoomOut } from "lucide-react";
import { createPortal } from "react-dom";
import { getTeamMemberById } from "../../../data/mockTeam";
import { formatShortDate, daysBetween } from "../lib/scheduleUtils";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { GanttChart } from "./GanttChart";

function initialsFor(name) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase();
}

// Initial Plan Table

function InitialPlanTable({ phases }) {
  let rowNum = 1;
  const statusStyle = {
    "not-started": "bg-slate-100 text-slate-600",
    "in-progress": "bg-blue-50 text-blue-700",
    review: "bg-amber-50 text-amber-700",
    done: "bg-emerald-50 text-emerald-700",
  };
  const statusText = { "not-started": "Not started", "in-progress": "In progress", review: "In review", done: "Complete" };

  return (
    <div className="overflow-auto rounded-2xl border border-border/80 bg-card shadow-[0_8px_24px_-16px_rgba(15,23,42,0.25)]">
      <table className="w-full min-w-[940px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            {["#", "Task", "Owner", "Planned start", "Planned finish", "Duration", "Status", "Points"].map((heading) => (
              <th key={heading} className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-4 py-3.5 text-left text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 backdrop-blur first:pl-5 whitespace-nowrap">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        {phases.map((phase) => (
          <tbody key={phase.id}>
            <tr className="bg-blue-50/55">
              <td colSpan={8} className="border-b border-t border-blue-100/80 px-5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700">{phase.name}</span>
                  <span className="rounded-full border border-blue-100 bg-white/80 px-2 py-0.5 text-[9px] font-semibold text-slate-500">{phase.tasks.length} tasks</span>
                </div>
              </td>
            </tr>
            {phase.tasks.map((task) => {
              const assignees = (task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : []).map(getTeamMemberById).filter(Boolean);
              const duration = daysBetween(task.baselineStart, task.baselineEnd) + 1;
              const number = rowNum++;
              return (
                <tr key={task.id} className="group transition-colors hover:bg-blue-50/35 even:bg-slate-50/45">
                  <td className="border-b border-slate-100 px-4 py-3.5 pl-5 text-center font-mono text-[10px] tabular-nums text-slate-400">{String(number).padStart(2, "0")}</td>
                  <td className="max-w-[310px] border-b border-slate-100 px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      {task.critical && <span className="h-2 w-1 shrink-0 rounded-full bg-rose-500" title="Critical path" />}
                      {task.milestone && <Diamond className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-600" />}
                      <span className="truncate font-semibold text-slate-800" title={task.name}>{task.name}</span>
                    </div>
                    <span className="ml-3.5 mt-1 block truncate font-mono text-[10px] text-slate-400">{task.id}</span>
                  </td>
                  <td className="border-b border-slate-100 px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-2" title={assignees.map((person) => person.name).join(", ") || "Unassigned"}>
                      <div className="flex -space-x-2">
                        {assignees.length ? assignees.slice(0, 3).map((person) => (
                          <Avatar key={person.id} className="h-7 w-7 border-2 border-white text-[8px] shadow-sm"><AvatarFallback>{initialsFor(person.name)}</AvatarFallback></Avatar>
                        )) : <Avatar className="h-7 w-7 border-2 border-white text-[8px]"><AvatarFallback>?</AvatarFallback></Avatar>}
                      </div>
                      <span className="text-[11px] font-medium text-slate-600">{assignees.length ? assignees[0].name : "Unassigned"}{assignees.length > 1 && <span className="ml-1 text-slate-400">+{assignees.length - 1}</span>}</span>
                    </div>
                  </td>
                  <td className="border-b border-slate-100 px-4 py-3.5 whitespace-nowrap font-medium tabular-nums text-slate-700">{formatShortDate(task.baselineStart)}</td>
                  <td className="border-b border-slate-100 px-4 py-3.5 whitespace-nowrap font-medium tabular-nums text-slate-700">{formatShortDate(task.baselineEnd)}</td>
                  <td className="border-b border-slate-100 px-4 py-3.5 whitespace-nowrap text-slate-500">{duration}d</td>
                  <td className="border-b border-slate-100 px-4 py-3.5 whitespace-nowrap">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusStyle[task.status] ?? statusStyle["not-started"]}`}><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-75" />{statusText[task.status] ?? "Not started"}</span>
                  </td>
                  <td className="border-b border-slate-100 px-4 py-3.5 whitespace-nowrap"><span className="inline-flex min-w-8 justify-center rounded-md bg-indigo-50 px-2 py-1 font-semibold tabular-nums text-indigo-700">{task.storyPoints ?? "-"}</span></td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PlanSummary({ phases }) {
  const allTasks    = phases.flatMap((p) => p.tasks);
  const milestones  = allTasks.filter((t) => t.milestone).length;
  const critical    = allTasks.filter((t) => t.critical).length;
  const totalPoints = allTasks.reduce((s, t) => s + (t.storyPoints || 0), 0);
  const tiles = [
    { label: "Total Tasks",   value: allTasks.length },
    { label: "Milestones",    value: milestones },
    { label: "Critical Path", value: critical },
    { label: "Story Points",  value: totalPoints },
    { label: "Phases",        value: phases.length },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {tiles.map(({ label, value }) => (
        <div key={label} className="rounded-xl border border-border bg-muted/20 p-3 text-center">
          <p className="text-xl font-bold text-foreground">{value}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

const MIN_PX_PER_DAY = 2;
const MAX_PX_PER_DAY = 60;
const ZOOM_STEP = 2;

export function BaselineCompareModal({ open, onOpenChange, tasks = [], label = "", showGantt = true }) {
  const [activeTab, setActiveTab] = useState("timeline");
  const [pxPerDay, setPxPerDay] = useState(10);

  // Group scoped tasks by phase
  const phases = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];
    const map = new Map();
    tasks.forEach((t) => {
      const key = t.phaseName ?? "General";
      if (!map.has(key)) map.set(key, { id: key, name: key, tasks: [] });
      map.get(key).tasks.push(t);
    });
    return [...map.values()];
  }, [tasks]);

  const plannedPhases = useMemo(
    () => phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) => ({
        ...task,
        start: task.baselineStart,
        end: task.baselineEnd,
      })),
    })),
    [phases]
  );

  // Range from baseline dates only
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (tasks.length === 0) return { rangeStart: new Date(), rangeEnd: new Date() };
    const dates = tasks.flatMap((t) => [new Date(t.baselineStart), new Date(t.baselineEnd)]);
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    min.setDate(min.getDate() - 1);
    max.setDate(max.getDate() + 1);
    return { rangeStart: min, rangeEnd: max };
  }, [tasks]);

  if (!open) return null;

  const content = (
    <div className="fixed inset-0 z-[90] flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3 shadow-sm sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/10 bg-primary/10 text-primary shadow-sm">
            <CalendarClock className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Initial Plan — {label} View</h2>
            <p className="text-[11px] text-muted-foreground">
              Original schedule as planned at kickoff · {formatShortDate(rangeStart)} – {formatShortDate(rangeEnd)} · {tasks.length} task{tasks.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showGantt && (
            <>
              {activeTab === "timeline" && <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
                <button type="button" onClick={() => setPxPerDay((v) => Math.max(MIN_PX_PER_DAY, v - ZOOM_STEP))} disabled={pxPerDay <= MIN_PX_PER_DAY} aria-label="Zoom out original schedule" title="Zoom out" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40">
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="min-w-9 text-center text-[10px] font-medium tabular-nums text-muted-foreground">{pxPerDay}px</span>
                <button type="button" onClick={() => setPxPerDay((v) => Math.min(MAX_PX_PER_DAY, v + ZOOM_STEP))} disabled={pxPerDay >= MAX_PX_PER_DAY} aria-label="Zoom in original schedule" title="Zoom in" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-40">
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>}
              <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
                <button type="button" onClick={() => setActiveTab("timeline")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${activeTab === "timeline" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Gantt chart</button>
                <button type="button" onClick={() => setActiveTab("table")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${activeTab === "table" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Table</button>
              </div>
            </>
          )}
        <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close original schedule"
            title="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
          <X className="h-4 w-4" />
        </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/10 scrollbar-thin">
        <div className="w-full space-y-5 px-4 py-5 sm:px-6 lg:px-8">
          {tasks.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">No tasks in this window.</p>
          ) : (
            <>
              <PlanSummary phases={phases} />
              {showGantt && activeTab === "timeline" ? (
                <GanttChart
                  phases={plannedPhases}
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  pxPerDay={pxPerDay}
                  isPM={false}
                />
              ) : <InitialPlanTable phases={phases} />}
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
