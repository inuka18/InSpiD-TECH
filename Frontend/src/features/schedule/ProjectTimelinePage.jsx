import { useMemo, useState } from "react";
import { Route, ZoomIn, ZoomOut, GitCompare } from "lucide-react";
import { RootCausePanel } from "./components/RootCausePanel";
import { BaselineCompareModal } from "./components/BaselineCompareModal";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
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
import { flattenTasks, formatShortDate, causeStyle } from "./lib/scheduleUtils";

const MIN_PX_PER_DAY = 2;
const MAX_PX_PER_DAY = 60;
const ZOOM_STEP = 2;

export function ProjectTimelinePage() {
  const { activeProjectId } = useActiveProject();
  const { data: phases, loading } = useSchedulePhases(activeProjectId);
  const { data: capacity } = useResourceCapacity(activeProjectId);
  const { role } = useRole();
  const isPM = role === ROLES.PM;
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedCapacity, setSelectedCapacity] = useState(null);
  const [pxPerDay, setPxPerDay] = useState(10);
  const [compareOpen, setCompareOpen] = useState(false);
  const allTasks = useMemo(() => flattenTasks(phases), [phases]);

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (phases.length === 0) return { rangeStart: null, rangeEnd: null };
    const starts = phases.map((p) => new Date(p.start));
    const ends = phases.map((p) => new Date(p.end));
    return {
      rangeStart: new Date(Math.min(...starts)),
      rangeEnd: new Date(Math.max(...ends)),
    };
  }, [phases]);

  if (!loading && phases.length === 0) {
    return <EmptyState icon={Route} title="No project timeline yet" description="No phases have been scheduled for this project." />;
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/[0.03] shadow-sm">
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Full Project Timeline</CardTitle>
            <CardDescription>
              {rangeStart && rangeEnd
                ? `${formatShortDate(rangeStart)} – ${formatShortDate(rangeEnd)} across all four phases.`
                : "Every phase and task from kickoff to launch."}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPxPerDay((v) => Math.max(MIN_PX_PER_DAY, v - ZOOM_STEP))}
              disabled={pxPerDay <= MIN_PX_PER_DAY}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPxPerDay((v) => Math.min(MAX_PX_PER_DAY, v + ZOOM_STEP))}
              disabled={pxPerDay >= MAX_PX_PER_DAY}
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
              phases={phases}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              onSelectTask={setSelectedTask}
              onSelectResource={setSelectedCapacity}
              capacity={capacity}
              pxPerDay={pxPerDay}
              isPM={isPM}
            />
          )}
        </CardContent>
      </Card>

      {!loading && rangeStart && rangeEnd && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Project Burndown</CardTitle>
              <CardDescription>Planned versus actual effort across the full project timeline.</CardDescription>
            </CardHeader>
            <CardContent><BurndownChart tasks={allTasks} rangeStart={rangeStart} rangeEnd={rangeEnd} height={240} /></CardContent>
        </Card>
        <RootCausePanel
          tasks={allTasks}
          label="Project"
          onSelectCause={(type) => {
            const style = causeStyle(type);
            const affected = allTasks.filter((task) => task.cause?.type === type);
            setSelectedTask({ _causeList: true, tasks: affected, title: style.label, subtitle: `${affected.length} task${affected.length !== 1 ? "s" : ""} affected in this project` });
          }}
        />
        </div>
      )}

      {allTasks.length > 0 && <TaskAssignmentList tasks={allTasks} onSelectTask={setSelectedTask} />}

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
