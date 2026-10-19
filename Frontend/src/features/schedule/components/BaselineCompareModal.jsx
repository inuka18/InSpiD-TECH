import { useMemo, useState } from "react";
import { CalendarClock, ChevronDown, ChevronRight, Diamond, Table2, ChartNoAxesGantt, X, ZoomIn, ZoomOut } from "lucide-react";
import { createPortal } from "react-dom";
import { getTeamMemberById } from "../../../data/mockTeam";
import {
  formatShortDate, daysBetween, addDays, startOfWeek, startOfMonth,
} from "../lib/scheduleUtils";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { cn } from "../../../lib/utils";

// ── Shared constants — must match GanttChart exactly ─────────────────────────
const HEADER_H = 40;
const PHASE_H  = 28;
const ROW_H    = 36;

const COLS = [
  { key: "num",      label: "#",         w: 32,  align: "center" },
  { key: "name",     label: "Task Name", w: 170, align: "left"   },
  { key: "duration", label: "Dur",       w: 40,  align: "center" },
  { key: "start",    label: "Start",     w: 68,  align: "left"   },
  { key: "finish",   label: "Finish",    w: 68,  align: "left"   },
  { key: "resource", label: "Resource",  w: 110, align: "left"   },
];
const LEFT_W = COLS.reduce((s, c) => s + c.w, 0); // 488px

function initialsFor(name) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase();
}

// ── Shared zoom constants ────────────────────────────────────────────────────
// ── Tick builder (mirrors GanttChart's buildTicks) ────────────────────────────
function buildTicks(rangeStart, rangeEnd, pxPerDay) {
  const totalDays = daysBetween(rangeStart, rangeEnd);
  const usesPx = Boolean(pxPerDay);
  const ticks = [];
  if (usesPx) {
    if (pxPerDay >= 20) {
      let cur = new Date(rangeStart);
      while (cur <= rangeEnd) {
        ticks.push({ key: cur.toISOString(), pos: daysBetween(rangeStart, cur) * pxPerDay, label: formatShortDate(cur), isWeekend: cur.getDay() === 0 || cur.getDay() === 6, unit: "px" });
        cur = addDays(cur, 1);
      }
    } else if (pxPerDay >= 8) {
      let cur = startOfWeek(rangeStart);
      while (cur <= rangeEnd) {
        ticks.push({ key: cur.toISOString(), pos: daysBetween(rangeStart, cur) * pxPerDay, label: formatShortDate(cur), unit: "px" });
        cur = addDays(cur, 7);
      }
    } else {
      let cur = startOfMonth(rangeStart);
      while (cur <= rangeEnd) {
        if (cur >= rangeStart) ticks.push({ key: cur.toISOString(), pos: daysBetween(rangeStart, cur) * pxPerDay, label: cur.toLocaleDateString(undefined, { month: "short", year: "numeric" }), unit: "px" });
        const next = new Date(cur); next.setMonth(next.getMonth() + 1); cur = next;
      }
      if (ticks.length === 0) ticks.push({ key: "s", pos: 0, label: rangeStart.toLocaleDateString(undefined, { month: "short", year: "numeric" }), unit: "px" });
    }
  } else {
    if (totalDays <= 31) {
      let cur = new Date(rangeStart);
      while (cur <= rangeEnd) {
        ticks.push({ key: cur.toISOString(), pos: (daysBetween(rangeStart, cur) / Math.max(totalDays, 1)) * 100, label: formatShortDate(cur), isWeekend: cur.getDay() === 0 || cur.getDay() === 6, unit: "%" });
        cur = addDays(cur, 1);
      }
    } else {
      let cur = startOfWeek(rangeStart);
      while (cur <= rangeEnd) {
        ticks.push({ key: cur.toISOString(), pos: (daysBetween(rangeStart, cur) / Math.max(totalDays, 1)) * 100, label: formatShortDate(cur), unit: "%" });
        cur = addDays(cur, 7);
      }
    }
  }
  return ticks;
}

// ── Baseline bar (read-only, uses baselineStart/baselineEnd) ──────────────────
function BaselineBar({ task, rangeStart, rangeEnd, pxPerDay }) {
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  const usesPx = Boolean(pxPerDay);
  const p = (date) => {
    const ms = Math.min(Math.max(new Date(date).getTime(), rangeStart.getTime()), rangeEnd.getTime());
    return usesPx ? daysBetween(rangeStart, new Date(ms)) * pxPerDay : ((ms - rangeStart.getTime()) / totalMs) * 100;
  };

  const bL = p(task.baselineStart);
  const bR = p(task.baselineEnd);
  const bW = Math.max(bR - bL, 0.5);

  // Vertical positions — same proportions as TaskBar
  const baselineTop = Math.round(ROW_H * 0.15);
  const barTop      = Math.round(ROW_H * 0.42);
  const barH        = Math.round(ROW_H * 0.33);

  return (
    <div className="relative w-full" style={{ height: ROW_H }}>
      {/* Thin baseline indicator at top (same as TaskBar's ghost track) */}
      <div
        className="absolute h-[6px] rounded-sm border border-primary/40 bg-primary/20"
        style={{ left: `${bL}${usesPx ? "px" : "%"}`, width: `${bW}${usesPx ? "px" : "%"}`, top: baselineTop }}
        title={`Planned: ${formatShortDate(task.baselineStart)} – ${formatShortDate(task.baselineEnd)}`}
      />
      {/* Main planned bar */}
      <div
        className="absolute flex items-center overflow-hidden rounded bg-primary shadow-sm"
        style={{ left: `${bL}${usesPx ? "px" : "%"}`, width: `${bW}${usesPx ? "px" : "%"}`, top: barTop, height: barH }}
        title={`${task.name}: ${formatShortDate(task.baselineStart)} – ${formatShortDate(task.baselineEnd)}`}
      >
        <span className="relative truncate px-1.5 text-[10px] font-semibold leading-none text-white">
          {task.name}
        </span>
      </div>
      {/* Milestone diamond */}
      {task.milestone && (
        <Diamond
          className="absolute h-3.5 w-3.5 fill-primary text-primary drop-shadow-sm"
          style={{ left: usesPx ? `${bR - 7}px` : `calc(${bR}% - 7px)`, top: barTop - 2 }}
        />
      )}
    </div>
  );
}

// ── Initial Plan Gantt — exact same shell as GanttChart ───────────────────────
function InitialPlanGantt({ phases, rangeStart, rangeEnd, pxPerDay }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const totalDays = daysBetween(rangeStart, rangeEnd);
  const usesPx = Boolean(pxPerDay);
  const coordWidth = usesPx ? Math.max(totalDays, 1) * pxPerDay : 100;
  const ticks     = useMemo(() => buildTicks(rangeStart, rangeEnd, pxPerDay), [rangeStart, rangeEnd, pxPerDay]);

  const toggle = (id) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Build flat rows — same pattern as GanttChart
  const flatRows = [];
  let taskNum = 1;
  phases.forEach((phase) => {
    flatRows.push({ type: "phase", phase });
    if (!collapsed.has(phase.id)) {
      phase.tasks.forEach((task) => flatRows.push({ type: "task", task, num: taskNum++ }));
    }
  });

  // Dependency lines using baseline positions
  const rowMeta = new Map();
  let y = HEADER_H;
  phases.forEach((phase) => {
    y += PHASE_H;
    if (!collapsed.has(phase.id)) {
      phase.tasks.forEach((task) => {
        const totalMs = rangeEnd.getTime() - rangeStart.getTime();
        const p = (d) => {
          const ms = Math.min(Math.max(new Date(d).getTime(), rangeStart.getTime()), rangeEnd.getTime());
          return usesPx ? daysBetween(rangeStart, new Date(ms)) * pxPerDay : ((ms - rangeStart.getTime()) / totalMs) * 100;
        };
        rowMeta.set(task.id, { y: y + ROW_H / 2, x1: p(task.baselineStart), x2: p(task.baselineEnd) });
        y += ROW_H;
      });
    }
  });
  const timelineHeight = y;

  const dependencyLines = [];
  rowMeta.forEach((toPos, taskId) => {
    const task = phases.flatMap((p) => p.tasks).find((t) => t.id === taskId);
    task?.dependencies?.forEach((depId) => {
      const fromPos = rowMeta.get(depId);
      if (fromPos) dependencyLines.push({ key: `${depId}->${taskId}`, x1: fromPos.x2, y1: fromPos.y, x2: toPos.x1, y2: toPos.y });
    });
  });

  return (
    <div className="flex overflow-hidden rounded-xl border border-border bg-card text-xs shadow-sm">

      {/* ── Left label column — identical to GanttChart ── */}
      <div className="shrink-0 border-r border-border bg-card" style={{ width: LEFT_W }}>

        {/* Column headers */}
        <div className="flex h-10 items-stretch border-b-2 border-border bg-muted/50" style={{ width: LEFT_W }}>
          {COLS.map((col) => (
            <div
              key={col.key}
              className="flex shrink-0 items-center border-r border-border/50 px-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground last:border-r-0"
              style={{ width: col.w, justifyContent: col.align === "center" ? "center" : "flex-start" }}
            >
              {col.label}
            </div>
          ))}
        </div>

        {flatRows.map((row, idx) => {
          if (row.type === "phase") {
            const isCollapsed = collapsed.has(row.phase.id);
            return (
              <button
                key={row.phase.id}
                type="button"
                onClick={() => toggle(row.phase.id)}
                className="flex h-7 w-full items-center gap-1.5 border-t border-border bg-muted/60 px-2 text-left text-[11px] font-bold uppercase tracking-wide text-foreground transition-colors hover:bg-muted/80"
                style={{ width: LEFT_W }}
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <span className="truncate">{row.phase.name}</span>
                <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-muted-foreground">
                  {row.phase.tasks.length}
                </span>
              </button>
            );
          }

          const { task, num } = row;
          const assignee = getTeamMemberById(task.assigneeId);
          const isEven   = idx % 2 === 0;
          const dur      = daysBetween(task.baselineStart, task.baselineEnd) + 1;

          return (
            <div
              key={task.id}
              className={cn("flex h-9 items-stretch border-t border-border/40", isEven ? "bg-card" : "bg-muted/20")}
              style={{ width: LEFT_W }}
            >
              {/* # */}
              <div className="flex shrink-0 items-center justify-center border-r border-border/30 text-muted-foreground/60" style={{ width: COLS[0].w }}>
                {num}
              </div>
              {/* Task Name */}
              <div className="flex shrink-0 items-center gap-1 border-r border-border/30 px-1.5" style={{ width: COLS[1].w }}>
                {task.critical && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title="Critical path" />}
                {task.milestone && <Diamond className="h-3 w-3 shrink-0 fill-primary text-primary" />}
                <span className="truncate font-medium text-foreground" title={task.name}>{task.name}</span>
              </div>
              {/* Duration */}
              <div className="flex shrink-0 items-center justify-center border-r border-border/30 text-muted-foreground" style={{ width: COLS[2].w }}>
                {dur}d
              </div>
              {/* Start — baseline */}
              <div className="flex shrink-0 items-center border-r border-border/30 px-1 text-foreground" style={{ width: COLS[3].w }}>
                {formatShortDate(task.baselineStart)}
              </div>
              {/* Finish — baseline */}
              <div className="flex shrink-0 items-center border-r border-border/30 px-1 text-foreground" style={{ width: COLS[4].w }}>
                {formatShortDate(task.baselineEnd)}
              </div>
              {/* Resource */}
              <div className="flex shrink-0 items-center gap-1.5 px-1.5" style={{ width: COLS[5].w }}>
                <Avatar className="h-5 w-5 shrink-0 text-[8px]">
                  <AvatarFallback>{assignee ? initialsFor(assignee.name) : "?"}</AvatarFallback>
                </Avatar>
                <span className="truncate text-muted-foreground">{assignee?.name ?? "Unassigned"}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Right timeline — identical structure to GanttChart ── */}
      <div className="relative flex-1 overflow-x-auto bg-card scrollbar-thin">
        <div className="relative" style={usesPx ? { width: coordWidth } : undefined}>

          {/* Date header */}
          <div className="relative h-10 border-b-2 border-border bg-muted/50">
            {ticks.map((tick) => (
              <span
                key={tick.key}
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium",
                  tick.isWeekend ? "text-muted-foreground/50" : "text-muted-foreground"
                )}
                style={{ left: `${tick.pos}${usesPx ? "px" : "%"}` }}
              >
                {tick.label}
              </span>
            ))}
          </div>

          {/* Weekend shading */}
          {ticks.filter((t) => t.isWeekend).map((tick) => (
            <div
              key={`we-${tick.key}`}
              className="pointer-events-none absolute bottom-0 top-10 bg-muted/30"
              style={{ left: `${tick.pos}${usesPx ? "px" : "%"}`, width: `${usesPx ? pxPerDay : (1 / Math.max(totalDays, 1)) * 100}${usesPx ? "px" : "%"}` }}
            />
          ))}

          {/* Vertical grid lines */}
          {ticks.map((tick) => (
            <div
              key={`grid-${tick.key}`}
              className="pointer-events-none absolute bottom-0 top-10 w-px bg-border/50"
              style={{ left: `${tick.pos}${usesPx ? "px" : "%"}` }}
            />
          ))}

          {/* Dependency arrows */}
          {dependencyLines.length > 0 && (
            <svg
              className="pointer-events-none absolute left-0 top-0 h-full w-full"
              viewBox={`0 0 ${coordWidth} ${timelineHeight}`}
              preserveAspectRatio="none"
            >
              <defs>
                <marker id="init-dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 Z" className="fill-muted-foreground/70" />
                </marker>
              </defs>
              {dependencyLines.map((line) => (
                <path
                  key={line.key}
                  d={`M${line.x1},${line.y1} C${(line.x1 + line.x2) / 2},${line.y1} ${(line.x1 + line.x2) / 2},${line.y2} ${line.x2},${line.y2}`}
                  fill="none"
                  className="stroke-muted-foreground/60"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  markerEnd="url(#init-dep-arrow)"
                />
              ))}
            </svg>
          )}

          {/* Task rows */}
          {flatRows.map((row, idx) => {
            if (row.type === "phase") {
              return <div key={row.phase.id} className="h-7 border-t border-border bg-muted/60" />;
            }
            const { task } = row;
            const isEven = idx % 2 === 0;
            return (
              <div key={task.id} className={cn("border-t border-border/40", isEven ? "bg-card" : "bg-muted/20")}>
                <BaselineBar task={task} rangeStart={rangeStart} rangeEnd={rangeEnd} pxPerDay={pxPerDay} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Initial Plan Table ────────────────────────────────────────────────────────

function InitialPlanTable({ phases }) {
  let rowNum = 1;
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[600px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="bg-muted/50">
            {["#", "Phase", "Task", "Assignee", "Planned Start", "Planned End", "Duration", "Story Pts"].map((h) => (
              <th key={h} className="border-b border-border px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {phases.map((phase) =>
            phase.tasks.map((task) => {
              const assignee = getTeamMemberById(task.assigneeId);
              const dur      = daysBetween(task.baselineStart, task.baselineEnd) + 1;
              const isEven   = rowNum % 2 === 0;
              const num      = rowNum++;
              return (
                <tr key={task.id} className={isEven ? "bg-card" : "bg-muted/10"}>
                  <td className="border-b border-border/40 px-3 py-2.5 text-center text-muted-foreground/60">{num}</td>
                  <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap text-muted-foreground">{phase.name}</td>
                  <td className="border-b border-border/40 px-3 py-2.5 max-w-[200px]">
                    <div className="flex items-center gap-1.5">
                      {task.critical && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title="Critical" />}
                      {task.milestone && <Diamond className="h-3 w-3 shrink-0 fill-primary text-primary" />}
                      <span className="truncate font-semibold text-foreground" title={task.name}>{task.name}</span>
                    </div>
                  </td>
                  <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Avatar className="h-5 w-5 shrink-0 text-[8px]">
                        <AvatarFallback>{assignee ? initialsFor(assignee.name) : "?"}</AvatarFallback>
                      </Avatar>
                      <span className="text-muted-foreground">{assignee?.name ?? "Unassigned"}</span>
                    </div>
                  </td>
                  <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap font-medium text-foreground">
                    {formatShortDate(task.baselineStart)}
                  </td>
                  <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap font-medium text-foreground">
                    {formatShortDate(task.baselineEnd)}
                  </td>
                  <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap text-muted-foreground">{dur}d</td>
                  <td className="border-b border-border/40 px-3 py-2.5 whitespace-nowrap text-muted-foreground">{task.storyPoints ?? "—"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Summary strip ─────────────────────────────────────────────────────────────

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

export function BaselineCompareModal({ open, onOpenChange, tasks = [], label = "" }) {
  const [activeTab, setActiveTab] = useState("gantt");
  const [pxPerDay, setPxPerDay] = useState(16);

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
          {activeTab === "gantt" && (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
              <button type="button" onClick={() => setPxPerDay((value) => Math.max(4, value - 4))} disabled={pxPerDay <= 4} className="rounded p-1.5 text-muted-foreground hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40" aria-label="Zoom out original schedule" title="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => setPxPerDay((value) => Math.min(64, value + 4))} disabled={pxPerDay >= 64} className="rounded p-1.5 text-muted-foreground hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40" aria-label="Zoom in original schedule" title="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
            {[{ key: "gantt", label: "Timeline", icon: ChartNoAxesGantt }, { key: "table", label: "Table", icon: Table2 }].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <t.icon className="mr-1 inline h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
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
              {activeTab === "gantt" && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">Timeline guide</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-sm bg-primary" /> Planned task window</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-sm border border-primary/40 bg-primary/20" /> Baseline range</span>
                  <span className="flex items-center gap-1.5"><Diamond className="h-3 w-3 fill-primary text-primary" /> Milestone</span>
                  <span className="ml-auto">Select a phase to expand or collapse its tasks.</span>
                </div>
              )}
              {activeTab === "gantt"
                ? <InitialPlanGantt phases={phases} rangeStart={rangeStart} rangeEnd={rangeEnd} pxPerDay={pxPerDay} />
                : <InitialPlanTable phases={phases} />
              }
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
