import { useMemo } from "react";
import ReactFlow, { Background, BackgroundVariant, Controls, Handle, MarkerType, Position } from "reactflow";
import "reactflow/dist/style.css";
import { AlertTriangle, ArrowRight, Flag, GitBranch } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Skeleton } from "../../../components/ui/skeleton";
import { cn } from "../../../lib/utils";
import { flattenTasks, isAtRisk } from "../../schedule/lib/scheduleUtils";

const DAY = 24 * 60 * 60 * 1000;

function durationInDays(start, end) {
  return Math.max(1, Math.ceil((new Date(end) - new Date(start)) / DAY) + 1);
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function PertActivityNode({ data }) {
  if (data.kind === "milestone") {
    return (
      <div className="w-[112px] rounded-full border border-primary/35 bg-primary/[0.06] px-3 py-2 text-center shadow-sm">
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-primary" />
        <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">{data.label}</p>
        <p className="mt-0.5 text-xs font-medium text-foreground">{formatDate(data.date)}</p>
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-primary" />
      </div>
    );
  }

  const { phase, index, plannedDuration, currentDuration, taskCount, completeCount, criticalCount, progress, delayed, riskCount, plannedStart, plannedEnd } = data;
  const isCritical = criticalCount > 0;

  return (
    <div
      className={cn(
        "w-[226px] rounded-xl border bg-card px-3 py-3 shadow-sm",
        delayed ? "border-status-dropped-fg/50" : isCritical ? "border-primary/45" : "border-border"
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-muted-foreground" />
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">A{index + 1}</span>
        {delayed ? <AlertTriangle className="h-3.5 w-3.5 text-status-dropped-fg" /> : isCritical ? <Flag className="h-3.5 w-3.5 text-primary" /> : null}
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-foreground">{phase.name}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] leading-snug text-muted-foreground">
        <div className="rounded-md bg-muted/70 px-2 py-1.5"><p className="font-semibold uppercase tracking-wide">Planned</p><p>{formatDate(plannedStart)} – {formatDate(plannedEnd)} · {plannedDuration}d</p></div>
        <div className={cn("rounded-md px-2 py-1.5", delayed ? "bg-status-dropped-bg" : "bg-primary/[0.06]")}><p className="font-semibold uppercase tracking-wide">Current</p><p>{formatDate(phase.start)} – {formatDate(phase.end)} · {currentDuration}d</p></div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", delayed ? "bg-status-dropped-fg" : "bg-primary")} style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{completeCount}/{taskCount} done</span><span>{progress}% complete</span></div>
      <p className={cn("mt-2 text-[10px] font-medium", delayed ? "text-status-dropped-fg" : "text-muted-foreground")}>
        {criticalCount ? `${criticalCount} critical ${criticalCount === 1 ? "activity" : "activities"}` : "No critical activities"}{riskCount ? ` · ${riskCount} at risk` : ""}
      </p>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { pertActivity: PertActivityNode };

export function PertNetworkDiagram({ phases, loading, className }) {
  const { nodes, edges, criticalCount, delayedCount, overallProgress, scheduleStart, scheduleEnd, totalDuration } = useMemo(() => {
    const tasks = flattenTasks(phases);
    const totalPoints = tasks.reduce((sum, task) => sum + (task.storyPoints || 1), 0);
    const completePoints = tasks.reduce((sum, task) => sum + (task.storyPoints || 1) * (task.progress || 0), 0);
    const overall = totalPoints ? Math.round(completePoints / totalPoints) : 0;

    const diagramNodes = phases.map((phase, index) => {
      const phaseTasks = phase.tasks || [];
      const criticalCountForPhase = phaseTasks.filter((task) => task.critical).length;
      const riskCount = phaseTasks.filter((task) => task.critical && isAtRisk(task)).length;
      const delayed = riskCount > 0;
      const progress = phaseTasks.length
        ? Math.round(phaseTasks.reduce((sum, task) => sum + (task.progress || 0), 0) / phaseTasks.length)
        : 0;
      const plannedStart = phaseTasks.reduce((earliest, task) => !earliest || new Date(task.baselineStart) < new Date(earliest) ? task.baselineStart : earliest, phase.start);
      const plannedEnd = phaseTasks.reduce((latest, task) => !latest || new Date(task.baselineEnd) > new Date(latest) ? task.baselineEnd : latest, phase.end);
      return {
        id: phase.id,
        type: "pertActivity",
        position: { x: 38 + index * 258, y: index % 2 ? 150 : 32 },
        data: { phase, index, plannedStart, plannedEnd, plannedDuration: durationInDays(plannedStart, plannedEnd), currentDuration: durationInDays(phase.start, phase.end), taskCount: phaseTasks.length, completeCount: phaseTasks.filter((task) => task.status === "done").length, criticalCount: criticalCountForPhase, riskCount, progress, delayed },
        draggable: false,
        selectable: false,
      };
    });
    const scheduleStart = phases.length ? phases.reduce((earliest, phase) => new Date(phase.start) < new Date(earliest) ? phase.start : earliest, phases[0].start) : null;
    const scheduleEnd = phases.length ? phases.reduce((latest, phase) => new Date(phase.end) > new Date(latest) ? phase.end : latest, phases[0].end) : null;
    const milestoneNodes = scheduleStart ? [
      { id: "pert-start", type: "pertActivity", position: { x: -128, y: 106 }, data: { kind: "milestone", label: "Project start", date: scheduleStart }, draggable: false, selectable: false },
      { id: "pert-finish", type: "pertActivity", position: { x: 1080, y: 106 }, data: { kind: "milestone", label: "Launch target", date: scheduleEnd }, draggable: false, selectable: false },
    ] : [];
    const diagramEdges = phases.slice(0, -1).map((phase, index) => ({
      id: `pert-${phase.id}-${phases[index + 1].id}`,
      source: phase.id,
      target: phases[index + 1].id,
      type: "smoothstep",
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
      style: { stroke: "#6b7280", strokeWidth: 1.6 },
    }));
    if (phases.length) {
      diagramEdges.unshift({ id: "pert-start-edge", source: "pert-start", target: phases[0].id, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" }, style: { stroke: "#6b7280", strokeWidth: 1.6 } });
      diagramEdges.push({ id: "pert-finish-edge", source: phases.at(-1).id, target: "pert-finish", type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" }, style: { stroke: "#6b7280", strokeWidth: 1.6 } });
    }
    return {
      nodes: [...milestoneNodes, ...diagramNodes],
      edges: diagramEdges,
      criticalCount: tasks.filter((task) => task.critical).length,
      delayedCount: tasks.filter((task) => task.critical && isAtRisk(task)).length,
      overallProgress: overall,
      scheduleStart,
      scheduleEnd,
      totalDuration: scheduleStart && scheduleEnd ? durationInDays(scheduleStart, scheduleEnd) : 0,
    };
  }, [phases]);

  return (
    <Card className={cn("mt-6 overflow-hidden", className)}>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
        <div>
          <div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-primary" /><CardTitle className="text-base">Project PERT Network</CardTitle></div>
          <CardDescription className="mt-1">Phase dependencies, delivery duration, and critical-path exposure.</CardDescription>
        </div>
        {!loading && <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{overallProgress}% complete</span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{totalDuration} calendar days</span>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-primary">{criticalCount} critical activities</span>
          {delayedCount > 0 && <span className="rounded-full bg-status-dropped-bg px-2.5 py-1 text-status-dropped-fg">{delayedCount} at risk</span>}
        </div>}
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-[290px] w-full" /> : phases.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No phased schedule is available for this project.</p> : <>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />Critical-path activity</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-status-dropped-fg" />Delayed critical activity</span>
            <span className="flex items-center gap-1"><ArrowRight className="h-3.5 w-3.5" />Finish-to-start dependency</span>
            <span>{formatDate(scheduleStart)} – {formatDate(scheduleEnd)}</span>
          </div>
          <div className="h-[370px] overflow-hidden rounded-lg border border-border bg-muted/[0.18]">
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.18 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag zoomOnScroll={false} zoomOnPinch={false} attributionPosition="bottom-right">
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="hsl(var(--border))" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
