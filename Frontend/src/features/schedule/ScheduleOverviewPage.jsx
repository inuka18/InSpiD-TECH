import { useEffect, useMemo, useState } from "react";
import { ListChecks, RotateCcw, CheckCircle2, Save, Database, CalendarDays, Users, Target, Clock3 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/common/EmptyState";
import { VarianceChart } from "./components/VarianceChart";
import { BufferRedistributionPanel } from "./components/BufferRedistributionPanel";
import { VarianceDrillDownModal } from "./components/VarianceDrillDownModal";
import { RestrictedButton } from "./components/RestrictedButton";
import { SprintTimelineTable } from "./components/SprintTimelineTable";
import { MilestoneCompareTable } from "./components/MilestoneCompareTable";
import { DurationEstimateChart } from "./components/DurationEstimateChart";
import { RootCausePanel } from "./components/RootCausePanel";
import { ImpactReschedulePanel } from "./components/ImpactReschedulePanel";
import { PertNetworkDiagram } from "../dashboard/components/PertNetworkDiagram";
import { useSchedulePhases } from "../../hooks/useSchedulePhases";
import { useActiveProject } from "../../hooks/useActiveProject";
import { useRole, ROLES } from "../../context/RoleContext";
import { useScheduleHistory } from "./context/ScheduleHistoryContext";
import { useGaps } from "../../hooks/useGaps";
import { usePropagationRuns } from "../../hooks/usePropagationRuns";
import { useWorkCalendar } from "./context/WorkCalendarContext";
import {
  flattenTasks,
  varianceDays,
  isAtRisk,
  overlapsRange,
  isTaskActiveOn,
  startOfWeek,
  addDays,
  endOfDay,
  pullTaskInByDays,
  formatShortDate,
  taskAssigneeIds,
  TODAY,
} from "./lib/scheduleUtils";

function buildLevel(key, label, pool, dateLabel) {
  const delayed = pool.filter(isAtRisk);
  const onTrack = pool.filter((t) => !isAtRisk(t));
  return {
    key,
    label,
    tasks: pool,
    dateLabel,
    total: pool.length,
    peopleCount: new Set(pool.flatMap(taskAssigneeIds)).size,
    onTrackCount: onTrack.length,
    delayedCount: delayed.length,
    totalSlip: delayed.reduce((sum, t) => sum + Math.max(0, varianceDays(t)), 0),
  };
}

export function ScheduleOverviewPage() {
  const { activeProject, activeProjectId } = useActiveProject();
  // Match the default date used by the Day and Week pages so the overview
  // cards describe the selected project's active planning window.
  const overviewDate = activeProject?.activeSprint?.startDate
    ? new Date(activeProject.activeSprint.startDate)
    : TODAY;
  const weekStart = startOfWeek(overviewDate);
  const weekEnd = endOfDay(addDays(weekStart, 6));
  const { role } = useRole();
  const isPM = role === ROLES.PM;
  const { data: phases, loading } = useSchedulePhases(activeProjectId);
  const { settings: workCalendar } = useWorkCalendar();
  const { pushHistory, saveVersion, versions } = useScheduleHistory();
  const { data: gaps } = useGaps(activeProjectId);
  const { data: impactRuns } = usePropagationRuns(activeProjectId);

  const [listDrill, setListDrill] = useState(null);
  const [toast, setToast]         = useState(null);
  const [, bump]                  = useState(0);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const projectVersions = versions.filter((version) => version.projectId === activeProjectId);
  const selectedVersion = projectVersions.find((version) => version.id === selectedVersionId);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const tasks = useMemo(() => flattenTasks(phases), [phases, workCalendar]);

  // ── KPI row ──────────────────────────────────────────────────────────────
  const totalTasks = tasks.length;
  const criticalAtRisk = tasks.filter((t) => t.critical && isAtRisk(t));
  // ── Buffer redistribution ─────────────────────────────────────────────────
  const totalSlipDays    = criticalAtRisk.reduce((sum, t) => sum + Math.max(0, varianceDays(t)), 0);
  const donorTasksRaw    = tasks.filter((t) => !t.critical && !isAtRisk(t) && t.status !== "done");
  const criticalWithDonors = criticalAtRisk.map((t) => ({
    task: t,
    behindDays: Math.max(0, varianceDays(t)),
    donor: t.bufferDonor ? { name: t.bufferDonor } : null,
  }));
  const donorTasksForPanel = donorTasksRaw.map((t) => ({ task: t }));

  const handleRedistribute = () => {
    const behindNow = tasks.filter((t) => t.critical && isAtRisk(t) && varianceDays(t) > 0);
    const donorsNow = tasks.filter((t) => !t.critical && !isAtRisk(t) && t.status !== "done");
    if (behindNow.length === 0 || donorsNow.length === 0) {
      setToast("No redistributable slack found.");
      return;
    }
    saveVersion("Before buffer re-optimization", tasks, activeProjectId);
    const snapshots  = [];
    const donorNames = new Set();
    behindNow.forEach((t, i) => {
      const donor = donorsNow[i % donorsNow.length];
      snapshots.push({ task: t, prevEnd: t.end, prevBufferDonor: t.bufferDonor });
      pullTaskInByDays(t, 1);
      t.bufferDonor = donor.name;
      donorNames.add(donor.name);
    });
    pushHistory(`Redistributed buffers for ${snapshots.length} task(s)`, () => {
      snapshots.forEach(({ task: t, prevEnd, prevBufferDonor }) => {
        t.end = prevEnd;
        t.bufferDonor = prevBufferDonor;
      });
    });
    bump((n) => n + 1);
    setToast(
      `Re-optimized: ${snapshots.length} critical task(s) pulled in by 1 day (${snapshots.length}d recovered), buffer sourced from ${[...donorNames].join(", ")}.`
    );
  };

  // ── Multi-level variance ──────────────────────────────────────────────────
  const dayPool    = tasks.filter((t) => isTaskActiveOn(t, overviewDate));
  const weekPool   = tasks.filter((t) => overlapsRange(t, weekStart, weekEnd));
  const sprint     = activeProject?.activeSprint;
  const sprintStart = sprint ? new Date(sprint.startDate) : null;
  const sprintEnd   = sprint ? endOfDay(addDays(sprintStart, Number(workCalendar.sprintDays ?? 10) - 1)) : null;
  const sprintPool  = sprint
    ? tasks.filter((task) => {
      const assignedSprint = Number.isInteger(task.plannedSprintNumber)
        ? task.plannedSprintNumber
        : task.status === "done" && Number.isInteger(task.sprintNumber) ? task.sprintNumber : null;
      return assignedSprint === null ? overlapsRange(task, sprintStart, sprintEnd) : assignedSprint === sprint.number;
    })
    : [];
  const levels = [
    buildLevel("day",     "Day",     dayPool, formatShortDate(overviewDate)),
    buildLevel("week",    "Week",    weekPool, `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`),
    buildLevel("sprint",  "Sprint",  sprintPool, sprint ? `${formatShortDate(sprintStart)} – ${formatShortDate(sprintEnd)}` : "No active sprint"),
    buildLevel("project", "Project", tasks, "Entire project"),
  ];
  const openGaps = gaps.filter((gap) => gap.status !== "Propagated");

  const handleSelectLevel = (level) => {
    setListDrill({
      title:    `${level.label} Level: Task Breakdown`,
      subtitle: `${level.total} task${level.total === 1 ? "" : "s"} · ${level.delayedCount} delayed · ${level.totalSlip}d total slip`,
      tasks:    level.tasks,
    });
  };

  // ── Sprint burndown ───────────────────────────────────────────────────────
  if (!loading && totalTasks === 0) {
    return <EmptyState icon={ListChecks} title="No schedule data yet" description="No phases or tasks scheduled yet." />;
  }

  return (
    <div className="space-y-6">

      {/* TIMEFRAME SUMMARY */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {levels.map((level) => {
            const Icon = { day: CalendarDays, week: Users, sprint: Target, project: Clock3 }[level.key];
            return (
              <button key={level.key} type="button" onClick={() => handleSelectLevel(level)} className="group rounded-xl border border-border/80 bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary"><Icon className="h-4 w-4" /></span>
                    <div className="min-w-0"><p className="text-sm font-semibold text-foreground">{level.label}</p><p className="truncate text-[10px] text-muted-foreground">{level.dateLabel}</p></div>
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">Details</span>
                </div>
                <div className="mt-4 grid grid-cols-4 divide-x divide-border/70">
                  <div className="px-2 first:pl-0"><p className="text-base font-bold tabular-nums text-foreground">{level.total}</p><p className="mt-0.5 text-[9px] text-muted-foreground">Tasks</p></div>
                  <div className="px-2"><p className="text-base font-bold tabular-nums text-status-confirmed-fg">{level.onTrackCount}</p><p className="mt-0.5 text-[9px] text-muted-foreground">On track</p></div>
                  <div className="px-2"><p className="text-base font-bold tabular-nums text-status-dropped-fg">{level.delayedCount}</p><p className="mt-0.5 text-[9px] text-muted-foreground">At risk</p></div>
                  <div className="px-2 pr-0"><p className="text-base font-bold tabular-nums text-foreground">{level.peopleCount}</p><p className="mt-0.5 text-[9px] text-muted-foreground">People</p></div>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 text-[10px] text-muted-foreground"><span>{level.totalSlip}d schedule slip</span><span>View task details</span></div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="border-primary/20">
            <CardHeader>
              <div className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /><CardTitle className="text-base">Schedule inputs</CardTitle></div>
              <CardDescription>Detected requirement, execution, and resource gaps that may affect the schedule.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {openGaps.slice(0, 3).map((gap) => <div key={gap.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{gap.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{gap.type} gap · {gap.taskIds.length} linked task{gap.taskIds.length === 1 ? "" : "s"} · {gap.confidence}% confidence</p></div><Badge variant={gap.severity === "High" ? "danger" : gap.severity === "Medium" ? "warning" : "outline"}>{gap.severity}</Badge></div>)}
              {openGaps.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No unresolved schedule inputs.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0"><div><CardTitle className="text-base">Schedule versions</CardTitle><CardDescription>Original plan dates stay fixed. Save and inspect snapshots of the current schedule.</CardDescription></div><Button size="sm" disabled={!isPM || tasks.length === 0} onClick={() => { const version = saveVersion("Manual schedule snapshot", tasks, activeProjectId); setSelectedVersionId(version.id); setToast(`Saved ${version.label} with ${version.taskCount} tasks.`); }}><Save className="h-4 w-4" />Save version</Button></CardHeader>
            <CardContent className="space-y-2">
              {projectVersions.length ? <div className="max-h-64 space-y-2 overflow-y-auto pr-1">{projectVersions.map((version) => <div key={version.id} className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${selectedVersionId === version.id ? "border-primary/40 bg-primary/[0.04]" : "border-border"}`}><div className="min-w-0"><p className="truncate text-sm font-medium">{version.label}</p><p className="text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString()} · {version.taskCount} tasks</p></div><Button variant={selectedVersionId === version.id ? "secondary" : "outline"} size="sm" onClick={() => setSelectedVersionId(selectedVersionId === version.id ? null : version.id)}>{selectedVersionId === version.id ? "Hide" : "View"}</Button></div>)}</div> : <p className="py-4 text-center text-sm text-muted-foreground">No saved versions for this project. Save the current schedule to keep a snapshot.</p>}
              {selectedVersion && <div className="mt-3 overflow-hidden rounded-lg border border-border">
                <div className="border-b border-border bg-muted/30 px-3 py-2"><p className="text-xs font-semibold">{selectedVersion.label}</p><p className="text-[10px] text-muted-foreground">Saved {new Date(selectedVersion.createdAt).toLocaleString()}</p></div>
                <div className="max-h-72 overflow-auto"><table className="w-full min-w-[570px] text-left text-[10px]"><thead className="sticky top-0 bg-card text-muted-foreground"><tr>{["Task", "Start", "Finish", "Status", "Progress"].map((heading) => <th key={heading} className="border-b border-border px-2.5 py-2 font-semibold">{heading}</th>)}</tr></thead><tbody>{selectedVersion.snapshot.map((task) => <tr key={task.id} className="border-b border-border/60 last:border-0"><td className="max-w-40 px-2.5 py-2"><p className="truncate font-medium text-foreground" title={task.name}>{task.name ?? task.id}</p><p className="font-mono text-[9px] text-muted-foreground">{task.id}</p></td><td className="whitespace-nowrap px-2.5 py-2">{formatShortDate(task.start)}</td><td className="whitespace-nowrap px-2.5 py-2">{formatShortDate(task.end)}</td><td className="whitespace-nowrap px-2.5 py-2">{task.status}</td><td className="px-2.5 py-2 tabular-nums">{task.progress ?? 0}%</td></tr>)}</tbody></table></div>
              </div>}
            </CardContent>
          </Card>
          <RootCausePanel
            tasks={tasks}
            label="Project overview"
            onSelectCause={(category, affected) => setListDrill({
              title: `${category} causes`,
              subtitle: `${affected.length} task${affected.length === 1 ? "" : "s"} in this category`,
              tasks: affected,
            })}
          />
        </div>
      )}

      {!loading && (
        <ImpactReschedulePanel
          runs={impactRuns}
          tasks={tasks}
          isPM={isPM}
          saveVersion={saveVersion}
          pushHistory={pushHistory}
          onApplied={({ gap, days, count }) => {
            bump((value) => value + 1);
            setToast(`Saved the previous version and shifted ${count} task${count === 1 ? "" : "s"} by ${days} day${days === 1 ? "" : "s"} for ${gap.id}. Gantt charts are updated.`);
          }}
        />
      )}

      {/* RE-OPTIMIZATION BANNER */}
      {!loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/[0.05] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <RotateCcw className="h-4.5 w-4.5" />
            </div>
            <p className="text-sm leading-relaxed text-foreground">
              <span className="font-semibold">Redistribute slack:</span> pull buffer from non-critical tasks to
              protect impacted critical-path work: {criticalAtRisk.length} delayed, {totalSlipDays}d total slip.
            </p>
          </div>
          {isPM ? (
            <Button onClick={handleRedistribute} className="shrink-0">
              <RotateCcw className="h-4 w-4" />
              Redistribute Buffers
            </Button>
          ) : (
            <RestrictedButton label="Only Project Managers can trigger buffer redistribution" variant="default" size="default">
              <RotateCcw className="h-4 w-4" />
              Redistribute Buffers
            </RestrictedButton>
          )}
        </div>
      )}

      {/* BUFFER REDISTRIBUTION PANEL */}
      {!loading && (
        <BufferRedistributionPanel isPM={isPM} criticalTasks={criticalWithDonors} donorTasks={donorTasksForPanel} />
      )}

      {/* PERT NETWORK + PLANNED VS ACTUAL */}
      <div className="space-y-6">
        <PertNetworkDiagram phases={phases} loading={loading} className="mt-0" />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Planned vs. Actual: Multi-Level Variance</CardTitle>
            <CardDescription>On-track vs. delayed mix at every planning granularity.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-56 w-full" /> : <VarianceChart levels={levels} onSelectLevel={handleSelectLevel} />}
          </CardContent>
        </Card>
      </div>

      {!loading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Task Duration Estimation &amp; Forecast</CardTitle>
            <CardDescription>Compare each baseline estimate with the current duration forecast after schedule re-optimization.</CardDescription>
          </CardHeader>
          <CardContent>
            <DurationEstimateChart tasks={tasks} onSelectTask={(task) => setListDrill({ title: task.name, subtitle: "Task duration estimate and current forecast", tasks: [task] })} />
          </CardContent>
        </Card>
      )}

      {/* SPRINT TIMELINE — ALL SPRINTS ORIGINAL VS ACTUAL */}
      {!loading && (
        <SprintTimelineTable tasks={tasks} activeSprint={sprint} />
      )}

      {/* MILESTONE TRACKER — ORIGINAL VS ACTUAL */}
      {!loading && (
        <MilestoneCompareTable tasks={tasks} />
      )}

      <VarianceDrillDownModal
        tasks={listDrill?.tasks}
        title={listDrill?.title}
        subtitle={listDrill?.subtitle}
        projectId={activeProjectId}
        open={Boolean(listDrill)}
        onOpenChange={(o) => !o && setListDrill(null)}
      />

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-2xl animate-slide-up">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-confirmed-fg" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
