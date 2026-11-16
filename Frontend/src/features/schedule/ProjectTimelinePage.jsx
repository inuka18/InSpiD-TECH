import { useMemo, useState } from "react";
import { Route, ZoomIn, ZoomOut, GitCompare } from "lucide-react";
import { RootCausePanel } from "./components/RootCausePanel";
import { BaselineCompareModal } from "./components/BaselineCompareModal";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/common/EmptyState";
import { GanttChart } from "./components/GanttChart";
import { VarianceDrillDownModal } from "./components/VarianceDrillDownModal";
import { BurndownChart } from "./components/BurndownChart";
import { TaskAssignmentList } from "./components/TaskAssignmentList";
import { ResourceProfileModal } from "./components/ResourceProfileModal";
import { useSchedulePhases } from "../../hooks/useSchedulePhases";
import { useResourceCapacity } from "../../hooks/useResourceCapacity";
import { useActiveProject } from "../../hooks/useActiveProject";
import { useRole, ROLES } from "../../context/RoleContext";
import { addWorkingDays, endOfWorkingDays, useWorkCalendar } from "./context/WorkCalendarContext";
import { flattenTasks, formatShortDate } from "./lib/scheduleUtils";

const MIN_PX_PER_DAY = 2;
const MAX_PX_PER_DAY = 60;
const ZOOM_STEP = 2;

export function ProjectTimelinePage() {
  const { activeProject, activeProjectId } = useActiveProject();
  const { data: phases, loading } = useSchedulePhases(activeProjectId);
  const { data: capacity } = useResourceCapacity(activeProjectId);
  const { role } = useRole();
  const { settings } = useWorkCalendar();
  const isPM = role === ROLES.PM;
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedCapacity, setSelectedCapacity] = useState(null);
  const [pxPerDay, setPxPerDay] = useState(MAX_PX_PER_DAY);
  const [compareOpen, setCompareOpen] = useState(false);
  const allTasks = useMemo(() => flattenTasks(phases), [phases]);
  const sprintPhases = useMemo(() => {
    if (!allTasks.length) return [];
    const activeStart = activeProject?.activeSprint?.startDate ? new Date(activeProject.activeSprint.startDate) : null;
    const projectStart = activeStart ?? new Date(Math.min(...allTasks.map((task) => new Date(task.start).getTime())));
    const projectEnd = new Date(Math.max(...allTasks.map((task) => new Date(task.end).getTime())));
    projectStart.setHours(9, 0, 0, 0);
    if (activeStart) activeStart.setHours(9, 0, 0, 0);
    const sprintWorkdays = Number(settings.sprintDays ?? 10);
    const firstSprintNumber = activeProject?.activeSprint?.number ?? 1;
    const sprints = [];
    let start = addWorkingDays(projectStart, 0, settings.workdays);
    let number = 1;
    while (start <= projectEnd) {
      const end = endOfWorkingDays(start, sprintWorkdays, settings.workdays);
      const nextStart = addWorkingDays(start, sprintWorkdays, settings.workdays);
      nextStart.setHours(9, 0, 0, 0);
      const isActive = activeStart && activeStart >= start && activeStart < nextStart;
      const sprintNumber = firstSprintNumber + number - 1;
      const sprintTasks = allTasks.filter((task) => {
        const assignedSprint = Number.isInteger(task.plannedSprintNumber)
          ? task.plannedSprintNumber
          : task.status === "done" && Number.isInteger(task.sprintNumber) ? task.sprintNumber : null;
        if (assignedSprint !== null) return assignedSprint === Math.max(1, sprintNumber);
        const taskStart = new Date(task.start);
        return taskStart >= start && taskStart < nextStart;
      });
      if (sprintTasks.length) sprints.push({
        id: `project-sprint-${number}`,
        name: `${isActive ? activeProject.activeSprint.name : `Sprint ${Math.max(1, sprintNumber)}`} · ${sprintWorkdays} working days`,
        start: start.toISOString(),
        end: end.toISOString(),
        tasks: sprintTasks,
      });
      start = nextStart;
      number += 1;
    }
    return sprints;
  }, [allTasks, activeProject, phases, settings]);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (phases.length === 0) return { rangeStart: null, rangeEnd: null };
    const phaseTasks = phases.flatMap((phase) => phase.tasks ?? []);
    const starts = [...phases.map((p) => new Date(p.start)), ...phaseTasks.map((task) => new Date(task.start))];
    const ends = [...phases.map((p) => new Date(p.end)), ...phaseTasks.map((task) => new Date(task.end))];
    return {
      rangeStart: new Date(Math.min(...starts)),
      rangeEnd: new Date(Math.max(...ends)),
    };
  }, [phases, settings]);

  if (!loading && phases.length === 0) {
    return <EmptyState icon={Route} title="No project timeline yet" />;
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/[0.03] shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Full Project Timeline</CardTitle>
            
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPxPerDay((v) => Math.max(MIN_PX_PER_DAY, v - ZOOM_STEP))}
              disabled={pxPerDay <= MIN_PX_PER_DAY}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPxPerDay((v) => Math.min(MAX_PX_PER_DAY, v + ZOOM_STEP))}
              disabled={pxPerDay >= MAX_PX_PER_DAY}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}>
              <GitCompare className="h-4 w-4" />
              Original Schedule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading || !rangeStart ? (
            <Skeleton className="h-[28rem] w-full" />
          ) : (
            <GanttChart
              phases={sprintPhases}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              onSelectTask={setSelectedTask}
              onSelectResource={setSelectedCapacity}
              capacity={capacity}
              pxPerDay={pxPerDay}
              isPM={isPM}
              groupByPhaseRequirement
              projectId={activeProjectId}
            />
          )}
        </CardContent>
      </Card>

      {!loading && rangeStart && rangeEnd && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Project Burndown</CardTitle>
            </CardHeader>
            <CardContent><BurndownChart tasks={allTasks} rangeStart={rangeStart} rangeEnd={rangeEnd} height={240} /></CardContent>
        </Card>
        <RootCausePanel
          tasks={allTasks}
          label="Project"
          onSelectCause={(category, affected) => {
            setSelectedTask({ _causeList: true, tasks: affected, title: category, subtitle: `${affected.length} task${affected.length !== 1 ? "s" : ""} affected in this project` });
          }}
        />
        </div>
      )}

      {allTasks.length > 0 && <TaskAssignmentList tasks={allTasks} onSelectTask={setSelectedTask} projectId={activeProjectId} />}

      <VarianceDrillDownModal
        task={selectedTask?._causeList ? null : selectedTask}
        tasks={selectedTask?._causeList ? selectedTask.tasks : undefined}
        title={selectedTask?._causeList ? selectedTask.title : undefined}
        subtitle={selectedTask?._causeList ? selectedTask.subtitle : undefined}
        projectId={activeProjectId}
        open={Boolean(selectedTask)}
        onOpenChange={(o) => !o && setSelectedTask(null)}
      />
      <ResourceProfileModal
        capacity={selectedCapacity}
        phases={phases}
        open={Boolean(selectedCapacity)}
        onOpenChange={(o) => !o && setSelectedCapacity(null)}
        onSelectTask={(task) => {
          setSelectedCapacity(null);
          setSelectedTask(task);
        }}
      />
      <BaselineCompareModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        tasks={allTasks}
        label="Project"
      />
    </div>
  );
}
