import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Maximize2, Minimize2, GanttChartSquare, Diamond, Circle } from "lucide-react";
import { createPortal } from "react-dom";
import { TaskBar } from "./TaskBar";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from "../../../components/ui/dropdown-menu";
import { getTeamMemberById } from "../../../data/mockTeam";
import { getRequirementsForProject } from "../../../data/mockRequirements";
import { TASK_STATUSES } from "../../../data/mockSchedulePhases";
import {
  TODAY, statusBarClass, statusLabel, formatShortDate, addDays,
  startOfWeek, startOfMonth, daysBetween, rescheduleTaskByDays, setTaskStatus,
} from "../lib/scheduleUtils";
import { useScheduleHistory } from "../context/ScheduleHistoryContext";
import { cn } from "../../../lib/utils";
import { useWorkCalendar, workingDaysBetween } from "../context/WorkCalendarContext";

const HEADER_H = 48;
const PHASE_H  = 32;
const ROW_H    = 48;

// Fixed-width columns (short, fixed-format content). Name and Resource are
// flexible — see the flex-basis classes used directly in the header/row markup.
const FIXED_COLS = {
  num:      { label: "#",      w: 38, align: "center" },
  duration: { label: "Span",   w: 52, align: "center" },
  start:    { label: "Start",  w: 78, align: "left" },
  finish:   { label: "Finish", w: 78, align: "left" },
};

const STATUS_DOT = {
  "not-started": "bg-muted-foreground/40",
  "in-progress":  "bg-primary",
  review:         "bg-status-modified-fg",
  done:           "bg-status-confirmed-fg",
};
const STATUS_TEXT = {
  "not-started": "Not Started",
  "in-progress":  "In Progress",
  review:         "Review",
  done:           "Done",
};

function initialsFor(name) {
  return name.split(" ").map((p) => p[0]).join("").toUpperCase();
}

function getTaskDateRange(tasks) {
  return {
    start: new Date(Math.min(...tasks.map((task) => new Date(task.start).getTime()))),
    end: new Date(Math.max(...tasks.map((task) => new Date(task.end).getTime()))),
  };
}

// Smart ticks: day labels when pxPerDay >= 20, week otherwise for percentage mode
function buildTicks(rangeStart, rangeEnd, scale, usesPx, pxPerDay) {
  const totalDays = daysBetween(rangeStart, rangeEnd);
  const ticks = [];

  if (usesPx) {
    if (pxPerDay >= 20) {
      let cur = new Date(rangeStart);
      while (cur <= rangeEnd) {
        ticks.push({ key: cur.toISOString(), pos: scale(cur), label: formatShortDate(cur), isWeekend: cur.getDay() === 0 || cur.getDay() === 6 });
        cur = addDays(cur, 1);
      }
    } else if (pxPerDay >= 8) {
      let cur = startOfWeek(rangeStart);
      while (cur <= rangeEnd) {
        ticks.push({ key: cur.toISOString(), pos: scale(cur), label: formatShortDate(cur) });
        cur = addDays(cur, 7);
      }
    } else {
      let cur = startOfMonth(rangeStart);
      while (cur <= rangeEnd) {
        if (cur >= rangeStart) {
          ticks.push({ key: cur.toISOString(), pos: scale(cur), label: cur.toLocaleDateString(undefined, { month: "short", year: "numeric" }) });
        }
        const next = new Date(cur);
        next.setMonth(next.getMonth() + 1);
        cur = next;
      }
      if (ticks.length === 0) {
        ticks.push({ key: "start", pos: scale(rangeStart), label: rangeStart.toLocaleDateString(undefined, { month: "short", year: "numeric" }) });
      }
    }
  } else {
    if (totalDays <= 31) {
      let cur = new Date(rangeStart);
      while (cur <= rangeEnd) {
        ticks.push({ key: cur.toISOString(), pos: scale(cur), label: formatShortDate(cur), isWeekend: cur.getDay() === 0 || cur.getDay() === 6 });
        cur = addDays(cur, 1);
      }
    } else {
      let cur = startOfWeek(rangeStart);
      while (cur <= rangeEnd) {
        ticks.push({ key: cur.toISOString(), pos: scale(cur), label: formatShortDate(cur) });
        cur = addDays(cur, 7);
      }
    }
  }
  return ticks;
}

function StatusDot({ task, isPM, onChangeStatus }) {
  const dot = (
    <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[task.status] ?? statusBarClass(task))} title={statusLabel(task)} />
  );
  if (!isPM) return dot;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} className="shrink-0 rounded-full p-0.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary" title="Change status">
          {dot}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Set status</DropdownMenuLabel>
        {TASK_STATUSES.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onChangeStatus(task, s)}>
            <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[s])} />
            {STATUS_TEXT[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Core chart body (shared between inline + fullscreen) ──────────────────────
function GanttBody({
  flatRows, collapsed, toggleCollapsed, groupByRequirement, groupByPhaseRequirement,
  rangeStart, rangeEnd, ticks, todayPos, usesPx, coordWidth, timelineHeight,
  dependencyLines, onSelectTask, onSelectResource, capacity, isPM,
  handleReschedule, handleChangeStatus, handleToggleMilestone, totalDays, pxPerDay,
  workCalendar,
  fullscreen = false,
}) {
  const containerRef = useRef(null);
  const unit = usesPx ? "px" : "%";
  const [hoveredRowId, setHoveredRowId] = useState(null);

  return (
    <div className={cn("w-full min-w-0 overflow-hidden rounded-xl", fullscreen && "h-full")}>
    <div className={cn("flex w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card text-xs shadow-sm", fullscreen && "h-full")}>

      {/* ── Left label column — responsive width so Name/Resource get real room
           but the timeline pane never gets squeezed down to nothing ── */}
      <div className="relative z-20 flex shrink-0 basis-[46%] min-w-[260px] max-w-[700px] flex-col bg-card shadow-[5px_0_12px_-8px_rgba(15,23,42,0.32)] xl:min-w-[560px]">

        {/* Column headers */}
        <div className="flex h-12 items-stretch border-b border-border bg-gradient-to-b from-muted/60 to-muted/25">
          <div className="flex shrink-0 items-center justify-center border-r border-border/50 px-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground" style={{ width: FIXED_COLS.num.w }}>
            {FIXED_COLS.num.label}
          </div>
          <div className="flex min-w-[90px] flex-[2] items-center border-r border-border/50 px-3 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground xl:min-w-[180px]">
            {groupByPhaseRequirement ? "Sprint / Requirement / Task" : groupByRequirement ? "Requirement / Task" : "Task / Requirement"}
          </div>
          <div className="hidden shrink-0 items-center justify-center border-r border-border/50 px-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground xl:flex" style={{ width: FIXED_COLS.duration.w }}>
            {FIXED_COLS.duration.label}
          </div>
          <div className="hidden shrink-0 items-center border-r border-border/50 px-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground xl:flex" style={{ width: FIXED_COLS.start.w }}>
            {FIXED_COLS.start.label}
          </div>
          <div className="hidden shrink-0 items-center border-r border-border/50 px-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground xl:flex" style={{ width: FIXED_COLS.finish.w }}>
            {FIXED_COLS.finish.label}
          </div>
          <div className="flex min-w-[85px] flex-1 items-center px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground xl:min-w-[125px] xl:flex-[1.3] xl:px-3">
            Resource
          </div>
        </div>

        {flatRows.map((row, idx) => {
          if (row.type === "phase") {
            const isCollapsed = collapsed.has(row.phase.id);
            return (
              <button
                key={row.phase.id}
                type="button"
                onClick={() => toggleCollapsed(row.phase.id)}
                className="flex h-8 w-full items-center gap-2 border-t border-border/70 bg-blue-50/80 px-3 text-left text-[10px] font-bold uppercase tracking-[0.1em] text-foreground outline-none transition-colors hover:bg-blue-100/80 focus-visible:bg-blue-100/80 dark:bg-blue-950/20 dark:hover:bg-blue-950/35 dark:focus-visible:bg-blue-950/35"
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />}
                <span className="truncate">{row.phase.name}</span>
                <span className="ml-auto shrink-0 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-muted-foreground">
                  {row.phase.tasks.length}
                </span>
              </button>
            );
          }

          if (row.type === "requirement") {
            const isCollapsed = collapsed.has(row.id);
            return <button key={row.id} type="button" onClick={() => toggleCollapsed(row.id)} className="flex h-8 w-full items-center gap-2 border-t border-border/60 bg-slate-50/80 px-3 pl-8 text-left text-[10px] font-semibold text-foreground outline-none hover:bg-slate-100/80 dark:bg-slate-900/30 dark:hover:bg-slate-900/50">
              {isCollapsed ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />}
              <span className="truncate font-mono text-[9px] text-primary">{row.requirementId}</span><span className="truncate">{row.title}</span>
              <span className="ml-auto shrink-0 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[9px] font-medium text-muted-foreground">{row.tasks.length}</span>
            </button>;
          }

          const { task, num } = row;
          const assignee       = getTeamMemberById(task.assigneeId);
          const assignees      = (task.assigneeIds?.length ? task.assigneeIds : task.assigneeId ? [task.assigneeId] : []).map(getTeamMemberById).filter(Boolean);
          const resourceRecord  = capacity?.find((c) => c.memberId === task.assigneeId);
          const isEven          = idx % 2 === 0;
          const effortMinutes = task.durationMinutes ?? workingDaysBetween(task.start, task.end, workCalendar.workdays) * workCalendar.hoursPerDay * 60;
          const dur             = Math.max(1, Math.ceil(effortMinutes / (workCalendar.hoursPerDay * 60)));
          const isTaskLate      = new Date(task.end) > new Date(task.baselineEnd) && task.status !== "done";
          const isHovered       = hoveredRowId === task.id;

          return (
            <div
              key={task.id}
              onMouseEnter={() => setHoveredRowId(task.id)}
              onMouseLeave={() => setHoveredRowId((cur) => (cur === task.id ? null : cur))}
              className={cn(
                "flex items-stretch border-t border-border/50 transition-colors",
                isHovered ? "bg-blue-50/70 dark:bg-blue-950/25" : isEven ? "bg-card" : "bg-slate-50/80 dark:bg-slate-900/20",
                task.critical && "border-l-2 border-l-red-500"
              )}
              style={{ height: ROW_H }}
            >
              {/* # */}
              <div className="flex shrink-0 items-center justify-center border-r border-border/30 text-[10px] font-medium tabular-nums text-muted-foreground/70" style={{ width: FIXED_COLS.num.w }}>
                {String(num).padStart(2, "0")}
              </div>
              {/* Task Name — flexible, gets whatever room the panel has */}
              <div className="flex min-w-[90px] flex-[2] items-center gap-1.5 border-r border-border/30 px-2 xl:min-w-[180px] xl:gap-2 xl:px-3">
                <StatusDot task={task} isPM={isPM} onChangeStatus={handleChangeStatus} />
                {(isPM || task.milestone) && <button type="button" aria-label={task.milestone ? `Remove milestone from ${task.name}` : `Mark ${task.name} as milestone`} aria-pressed={Boolean(task.milestone)} title={task.milestone ? "Milestone — click to remove" : "Mark as milestone"} onClick={(event) => { event.stopPropagation(); if (isPM) handleToggleMilestone(task); }} className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-primary", isPM && "hover:bg-muted")}>
                  {task.milestone ? <Diamond className="h-3.5 w-3.5 fill-amber-500 text-amber-600" /> : <Circle className="h-2.5 w-2.5 text-muted-foreground/55" />}
                </button>}
                {task.critical && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" title="Critical" />}
                <div className="min-w-0 flex-1">
                <span className={cn("block truncate text-[11px] font-semibold leading-tight", isTaskLate ? "text-red-600 dark:text-red-400" : "text-foreground")} title={task.name}>{task.name}</span>
                  <span className="mt-1 block truncate font-mono text-[9px] leading-tight text-muted-foreground" title={task.id}>{task.id}</span>
                </div>
              </div>
              {/* Duration */}
              <div className="hidden shrink-0 items-center justify-center border-r border-border/30 text-[10px] font-medium tabular-nums text-muted-foreground xl:flex" style={{ width: FIXED_COLS.duration.w }}>
                {dur}d
              </div>
              {/* Start */}
              <div className={cn("hidden shrink-0 items-center border-r border-border/30 px-2 text-[10px] tabular-nums xl:flex", isTaskLate ? "text-red-600 dark:text-red-400" : "text-foreground")} style={{ width: FIXED_COLS.start.w }}>
                {formatShortDate(task.start)}
              </div>
              {/* Finish */}
              <div className={cn("hidden shrink-0 items-center border-r border-border/30 px-2 text-[10px] tabular-nums xl:flex", isTaskLate ? "text-red-600 dark:text-red-400" : "text-foreground")} style={{ width: FIXED_COLS.finish.w }}>
                {formatShortDate(task.end)}
              </div>
              {/* Resource — flexible */}
              <div className="flex min-w-[85px] flex-1 items-center gap-1 px-1.5 xl:min-w-[125px] xl:flex-[1.3] xl:gap-2 xl:px-3">
                {resourceRecord && onSelectResource ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSelectResource(resourceRecord); }}
                    className="flex min-w-0 items-center gap-2 truncate rounded px-0.5 outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
                    title={`View ${assignee?.name ?? "assignee"}`}
                  >
                    <div className="flex shrink-0 items-center -space-x-2">{assignees.slice(0, 2).map((person) => <Avatar key={person.id} title={person.name} className="h-6 w-6 border-2 border-card text-[8px] shadow-sm ring-1 ring-border/50 xl:h-7 xl:w-7"><AvatarFallback className="bg-primary/10 text-primary">{person.initials ?? initialsFor(person.name)}</AvatarFallback></Avatar>)}{assignees.length > 2 && <span className="z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-muted text-[8px] font-semibold text-muted-foreground xl:h-6 xl:w-6" title={assignees.slice(2).map((person) => person.name).join(", ")}>+{assignees.length - 2}</span>}{assignees.length === 0 && <Avatar className="h-6 w-6 border-2 border-card text-[8px] shadow-sm xl:h-7 xl:w-7"><AvatarFallback className="bg-muted text-muted-foreground">?</AvatarFallback></Avatar>}</div>
                    <span className="hidden truncate text-[10px] text-muted-foreground lg:inline">{assignees.map((person) => person.name).join(", ") || "Unassigned"}</span>
                  </button>
                ) : (
                  <>
                    <div className="flex shrink-0 items-center -space-x-2">{assignees.slice(0, 2).map((person) => <Avatar key={person.id} title={person.name} className="h-6 w-6 border-2 border-card text-[8px] shadow-sm ring-1 ring-border/50 xl:h-7 xl:w-7"><AvatarFallback className="bg-primary/10 text-primary">{person.initials ?? initialsFor(person.name)}</AvatarFallback></Avatar>)}{assignees.length > 2 && <span className="z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-muted text-[8px] font-semibold text-muted-foreground xl:h-6 xl:w-6" title={assignees.slice(2).map((person) => person.name).join(", ")}>+{assignees.length - 2}</span>}{assignees.length === 0 && <Avatar className="h-6 w-6 border-2 border-card text-[8px] shadow-sm xl:h-7 xl:w-7"><AvatarFallback className="bg-muted text-muted-foreground">?</AvatarFallback></Avatar>}</div>
                  <span className="hidden truncate text-[10px] text-muted-foreground lg:inline">{assignees.map((person) => person.name).join(", ") || "Unassigned"}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Right timeline ── */}
      <div className={cn("relative min-w-0 flex-1 overflow-x-auto bg-card scrollbar-thin", fullscreen && "overflow-y-auto")}>
        <div className="relative" ref={containerRef} style={{ width: usesPx ? `${coordWidth}px` : "100%" }}>

              <div className="relative h-12 border-b border-border bg-gradient-to-b from-muted/60 to-muted/25">
            {ticks.map((tick) => (
              <span
                key={tick.key}
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium",
                  tick.isWeekend ? "text-muted-foreground/50" : "text-muted-foreground"
                )}
                style={{ left: `${tick.pos}${unit}` }}
              >
                {tick.label}
              </span>
            ))}
          </div>

          {Array.from({ length: totalDays + 1 }, (_, dayOffset) => {
            const date = addDays(rangeStart, dayOffset);
            if (date.getDay() !== 0 && date.getDay() !== 6) return null;
            const dayWidth = 100 / Math.max(totalDays, 1);
            return (
              <div
                key={`weekend-${date.toISOString()}`}
                className="pointer-events-none absolute bottom-0 top-12 bg-slate-500/[0.045]"
                style={{
                  left: usesPx ? `${dayOffset * pxPerDay}px` : `${dayOffset * dayWidth}%`,
                  width: usesPx ? pxPerDay : `${dayWidth}%`,
                }}
              />
            );
          })}

          {ticks.map((tick) => (
            <div
              key={`grid-${tick.key}`}
              className="pointer-events-none absolute bottom-0 top-12 w-px bg-border/60"
              style={{ left: `${tick.pos}${unit}` }}
            />
          ))}

          {todayPos != null && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-20 w-[2px] bg-red-500/90 shadow-[0_0_2px_rgb(239_68_68_/_25%)]"
              style={{ left: `${todayPos}${unit}` }}
            >
              <span className="absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap rounded-b-md bg-red-500 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm">
                Today
              </span>
            </div>
          )}

          {dependencyLines.length > 0 && (
            <svg
              className="pointer-events-none absolute left-0 top-0 h-full w-full"
              viewBox={`0 0 ${coordWidth} ${timelineHeight}`}
              preserveAspectRatio="none"
            >
              <defs>
                <marker id="gantt-dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
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
                  markerEnd="url(#gantt-dep-arrow)"
                />
              ))}
            </svg>
          )}

          {flatRows.map((row, idx) => {
            if (row.type === "phase" || row.type === "requirement") {
              const start = row.type === "phase" ? row.phase.start : row.start;
              const end = row.type === "phase" ? row.phase.end : row.end;
              const total = Math.max(totalDays, 1);
              const leftDays = Math.max(0, Math.min(total, daysBetween(rangeStart, start)));
              const rightDays = Math.max(leftDays, Math.min(total, daysBetween(rangeStart, end)));
              const left = usesPx ? leftDays * pxPerDay : (leftDays / total) * 100;
              const width = usesPx
                ? Math.max((rightDays - leftDays) * pxPerDay, 6)
                : Math.max(((rightDays - leftDays) / total) * 100, 0.5);
              const unit = usesPx ? "px" : "%";
              const isSprintRow = row.type === "phase";
              return <div key={row.id ?? row.phase.id} className={cn("relative h-8 border-t border-border/70", isSprintRow ? "bg-blue-50/80 dark:bg-blue-950/20" : "bg-slate-50/80 dark:bg-slate-900/30")}>
                <div
                  className={cn("absolute top-1.5 h-5 rounded-md border px-2 text-[9px] font-semibold leading-[18px] text-white shadow-sm", isSprintRow ? "border-indigo-700/30 bg-indigo-600 dark:bg-indigo-500" : "border-sky-700/30 bg-sky-600 dark:bg-sky-500")}
                  style={{ left: `${left}${unit}`, width: `${width}${unit}` }}
                  title={`${isSprintRow ? row.phase.name : row.title}: ${formatShortDate(start)} – ${formatShortDate(end)}`}
                  aria-label={`${isSprintRow ? "Sprint" : "Requirement"} timeline bar`}
                >
                  <span className="block truncate">{isSprintRow ? row.phase.name : `${row.requirementId} · ${row.title}`}</span>
                </div>
              </div>;
            }
            const { task } = row;
            const isEven = idx % 2 === 0;
            const isHovered = hoveredRowId === task.id;
            return (
              <div
                key={task.id}
                onMouseEnter={() => setHoveredRowId(task.id)}
                onMouseLeave={() => setHoveredRowId((cur) => (cur === task.id ? null : cur))}
                className={cn(
                  "border-t border-border/40 transition-colors duration-150",
                  isHovered ? "bg-blue-50/70 dark:bg-blue-950/25" : isEven ? "bg-card" : "bg-slate-50/80 dark:bg-slate-900/20"
                )}
              >
                <TaskBar
                  task={task}
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  onClick={onSelectTask}
                  draggable={isPM}
                  onReschedule={handleReschedule}
                  containerRef={containerRef}
                  totalDays={totalDays}
                  pxPerDay={usesPx ? pxPerDay : null}
                  rowHeight={ROW_H}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}

// ── Fullscreen overlay ────────────────────────────────────────────────────────
function FullscreenGantt({ onClose, children }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4 shadow-sm">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <GanttChartSquare className="h-4 w-4 text-muted-foreground" />
          Project schedule — Full Screen
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          Exit Full Screen
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {children}
      </div>
    </div>,
    document.body
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function GanttChart({ phases, rangeStart, rangeEnd, onSelectTask, onSelectResource, capacity, pxPerDay, isPM = true, groupByRequirement = false, groupByPhaseRequirement = false, projectId }) {
  const { settings: workCalendar } = useWorkCalendar();
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [renderTick, bump]        = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const forceRender = () => bump((n) => n + 1);
  const { pushHistory } = useScheduleHistory();
  const requirementTitles = useMemo(() => new Map(getRequirementsForProject(projectId ?? phases[0]?.projectId).map((item) => [item.id, item.title])), [phases, projectId]);
  const requirementTitleFor = (requirementId, tasks) => {
    if (!requirementId || requirementId === "unlinked") return "Tasks not linked to a requirement yet";
    return requirementTitles.get(requirementId)
      ?? tasks.find((task) => task.requirementTitle || task.requirement)?.requirementTitle
      ?? tasks.find((task) => task.requirement)?.requirement
      ?? "Requirement details unavailable";
  };

  const totalDays  = daysBetween(rangeStart, rangeEnd);
  const usesPx     = Boolean(pxPerDay);
  const coordWidth = usesPx ? Math.max(totalDays, 1) * pxPerDay : 100;

  const scale = (date) => {
    const days = daysBetween(rangeStart, date);
    return usesPx ? days * pxPerDay : (days / Math.max(totalDays, 1)) * 100;
  };

  const ticks = useMemo(
    () => buildTicks(rangeStart, rangeEnd, scale, usesPx, pxPerDay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeStart, rangeEnd, usesPx, pxPerDay]
  );

  const todayInRange = TODAY >= rangeStart && TODAY <= rangeEnd;
  const todayPos     = todayInRange ? scale(TODAY) : null;

  const visiblePhases = phases
    .map((phase) => ({
      ...phase,
      tasks: phase.tasks.filter((t) => new Date(t.end) >= rangeStart && new Date(t.start) <= rangeEnd),
    }))
    .filter((phase) => phase.tasks.length > 0);

  const { rowMeta, timelineHeight } = useMemo(() => {
    let y = HEADER_H;
    const meta = new Map();
    if (groupByPhaseRequirement) {
      visiblePhases.forEach((phase) => {
        y += PHASE_H;
        if (!collapsed.has(phase.id)) {
          const groups = new Map();
          phase.tasks.forEach((task) => { const id = task.requirementId || "unlinked"; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(task); });
          groups.forEach((tasks, requirementId) => {
            y += PHASE_H;
            if (!collapsed.has(`requirement:${phase.id}:${requirementId}`)) tasks.forEach((task) => {
              meta.set(task.id, { y: y + ROW_H / 2, x1: scale(task.start), x2: scale(task.end) });
              y += ROW_H;
            });
          });
        }
      });
    } else if (groupByRequirement) {
      const groups = new Map();
      visiblePhases.flatMap((phase) => phase.tasks).forEach((task) => {
        const id = task.requirementId || "unlinked";
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(task);
      });
      groups.forEach((tasks, requirementId) => {
        y += PHASE_H;
        if (!collapsed.has(`requirement:${requirementId}`)) tasks.forEach((task) => {
          meta.set(task.id, { y: y + ROW_H / 2, x1: scale(task.start), x2: scale(task.end) });
          y += ROW_H;
        });
      });
    } else visiblePhases.forEach((phase) => {
      y += PHASE_H;
      if (!collapsed.has(phase.id)) phase.tasks.forEach((task) => {
        meta.set(task.id, { y: y + ROW_H / 2, x1: scale(task.start), x2: scale(task.end) });
        y += ROW_H;
      });
    });
    return { rowMeta: meta, timelineHeight: y };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phases, rangeStart, rangeEnd, collapsed, pxPerDay, renderTick, groupByRequirement, groupByPhaseRequirement]);

  const dependencyLines = [];
  rowMeta.forEach((toPos, taskId) => {
    const task = visiblePhases.flatMap((p) => p.tasks).find((t) => t.id === taskId);
    task?.dependencies?.forEach((depId) => {
      const fromPos = rowMeta.get(depId);
      if (fromPos) dependencyLines.push({ key: `${depId}->${taskId}`, x1: fromPos.x2, y1: fromPos.y, x2: toPos.x1, y2: toPos.y });
    });
  });

  const toggleCollapsed = (phaseId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId); else next.add(phaseId);
      return next;
    });
  };

  const handleReschedule = (task, deltaDays) => {
    const prevStart = task.start, prevEnd = task.end;
    pushHistory(`Rescheduled "${task.name}" by ${deltaDays > 0 ? "+" : ""}${deltaDays}d`, () => {
      task.start = prevStart; task.end = prevEnd;
    });
    rescheduleTaskByDays(task, deltaDays);
    forceRender();
  };

  const handleChangeStatus = (task, status) => { setTaskStatus(task, status); forceRender(); };
  const handleToggleMilestone = (task) => {
    const previous = task.milestone;
    task.milestone = !task.milestone;
    pushHistory(`${task.milestone ? "Marked" : "Removed"} milestone: "${task.name}"`, () => { task.milestone = previous; });
    forceRender();
  };

  if (visiblePhases.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        No tasks fall within this window.
      </div>
    );
  }

  const flatRows = [];
  let taskNum = 1;
  if (groupByPhaseRequirement) {
    visiblePhases.forEach((phase) => {
      flatRows.push({ type: "phase", phase });
      if (!collapsed.has(phase.id)) {
        const groups = new Map();
        phase.tasks.forEach((task) => { const id = task.requirementId || "unlinked"; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(task); });
        groups.forEach((tasks, requirementId) => {
          const id = `requirement:${phase.id}:${requirementId}`;
          flatRows.push({ type: "requirement", id, requirementId: requirementId === "unlinked" ? "No requirement" : requirementId, title: requirementTitleFor(requirementId, tasks), ...getTaskDateRange(tasks), tasks });
          if (!collapsed.has(id)) tasks.forEach((task) => flatRows.push({ type: "task", task, phase, num: taskNum++ }));
        });
      }
    });
  } else if (groupByRequirement) {
    const groups = new Map();
    visiblePhases.flatMap((phase) => phase.tasks).forEach((task) => {
      const id = task.requirementId || "unlinked";
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(task);
    });
    groups.forEach((tasks, requirementId) => {
      const id = `requirement:${requirementId}`;
      flatRows.push({ type: "requirement", id, requirementId: requirementId === "unlinked" ? "No requirement" : requirementId, title: requirementTitleFor(requirementId, tasks), ...getTaskDateRange(tasks), tasks });
      if (!collapsed.has(id)) tasks.forEach((task) => flatRows.push({ type: "task", task, num: taskNum++ }));
    });
  } else visiblePhases.forEach((phase) => {
    flatRows.push({ type: "phase", phase });
    if (!collapsed.has(phase.id)) phase.tasks.forEach((task) => flatRows.push({ type: "task", task, phase, num: taskNum++ }));
  });
  const bodyProps = {
    flatRows, collapsed, toggleCollapsed, groupByRequirement, groupByPhaseRequirement,
    rangeStart, rangeEnd, ticks, todayPos, usesPx, coordWidth, timelineHeight,
    dependencyLines, onSelectTask, onSelectResource, capacity, isPM,
    handleReschedule, handleChangeStatus, handleToggleMilestone, totalDays, pxPerDay,
    workCalendar,
  };

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <GanttChartSquare className="h-3.5 w-3.5" />
          Gantt Chart
        </span>
        <div className="hidden flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground md:flex" aria-label="Gantt legend">
          {groupByPhaseRequirement && <><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-indigo-600" />Sprint</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-sky-600" />Requirement</span></>}
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#7b8798]" />Not started</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#426fba]" />In progress</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#b7791f]" />Review</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#2e8067]" />Done</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#c74848]" />Late</span>
        </div>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm outline-none transition-colors hover:border-primary/40 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Full Screen
        </button>
      </div>

      <GanttBody {...bodyProps} />

      {fullscreen && (
        <FullscreenGantt onClose={() => setFullscreen(false)}>
          <GanttBody {...bodyProps} fullscreen />
        </FullscreenGantt>
      )}
    </>
  );
}



