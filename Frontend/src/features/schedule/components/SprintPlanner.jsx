import { useEffect, useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useSchedulePhases } from "../../../hooks/useSchedulePhases";
import { useWorkCalendar } from "../context/WorkCalendarContext";
import { useScheduleHistory } from "../context/ScheduleHistoryContext";
import { applyRequirementSprintPlan, calculateRequirementSprintPlan } from "../lib/requirementPlanner";
import { formatShortDate } from "../lib/scheduleUtils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SprintPlanner({ projectId, projectStart, firstSprintNumber = 1, onClose }) {
  const { data: phases, loading: phasesLoading } = useSchedulePhases(projectId);
  const { settings, setSettings } = useWorkCalendar();
  const { pushHistory } = useScheduleHistory();
  const [draftDays, setDraftDays] = useState(settings.workdays);
  const [draftHours, setDraftHours] = useState(String(settings.hoursPerDay));
  const [sprintDays, setSprintDays] = useState(String(settings.sprintDays ?? 10));

  useEffect(() => {
    setDraftDays(settings.workdays);
    setDraftHours(String(settings.hoursPerDay));
    setSprintDays(String(settings.sprintDays ?? 10));
  }, [settings]);

  const draftSettings = useMemo(() => ({
    ...settings,
    workdays: draftDays,
    hoursPerDay: Number(draftHours) || settings.hoursPerDay,
    sprintDays: Number(sprintDays) || settings.sprintDays,
  }), [settings, draftDays, draftHours, sprintDays]);
  const requirementPlan = useMemo(
    () => calculateRequirementSprintPlan(phases ?? [], draftSettings, projectStart, firstSprintNumber),
    [phases, draftSettings, projectStart, firstSprintNumber]
  );

  const apply = () => {
    const next = { ...settings, workdays: draftDays, hoursPerDay: Number(draftHours), sprintDays: Number(sprintDays) };
    if (draftDays.length === 0 || !Number(draftHours) || Number(draftHours) < 1 || Number(draftHours) > 24 || !Number(sprintDays) || Number(sprintDays) < 1 || Number(sprintDays) > 60) return;
    const settingsChanged = Number(draftHours) !== settings.hoursPerDay || draftDays.length !== settings.workdays.length || !draftDays.every((day) => settings.workdays.includes(day)) || Number(sprintDays) !== settings.sprintDays;
    const { snapshots } = applyRequirementSprintPlan(phases, next, projectStart, firstSprintNumber);
    const tasksChanged = snapshots.some(({ task, start, end, durationMinutes, plannedSprintNumber, remainingDurationMinutes }) =>
      task.start !== start || task.end !== end || task.durationMinutes !== durationMinutes || task.plannedSprintNumber !== plannedSprintNumber || task.remainingDurationMinutes !== remainingDurationMinutes
    );
    if (settingsChanged || tasksChanged) {
      pushHistory("Changed sprint planner settings", () => {
        snapshots.forEach(({ task, start, end, durationMinutes, plannedSprintNumber, remainingDurationMinutes }) => Object.assign(task, { start, end, durationMinutes, plannedSprintNumber, remainingDurationMinutes }));
        setSettings(settings);
      });
    }
    setSettings(next);
    onClose();
  };

  return (
    <div className="absolute right-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-4 text-left shadow-xl">
      <div className="mb-4 flex items-center gap-2">
        <CalendarRange className="h-4 w-4 text-primary" />
        <div><h3 className="text-sm font-semibold">Sprint Planner</h3></div>
      </div>
      <label className="mb-4 flex items-center justify-between gap-3 text-sm">
        Sprint length (working days)
        <input aria-label="Sprint length in working days" type="number" min="1" max="60" value={sprintDays} onChange={(event) => setSprintDays(event.target.value)} className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm" />
      </label>
      <div className="mb-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Working days</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Working days">
          {WEEKDAYS.map((label, index) => {
            const day = (index + 1) % 7;
            const active = draftDays.includes(day);
            return <button key={label} type="button" aria-pressed={active} onClick={() => setDraftDays((current) => active ? current.filter((value) => value !== day) : [...current, day].sort((a, b) => a - b))} className={`rounded-md border px-2 py-1.5 text-xs font-medium ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}>{label}</button>;
          })}
        </div>
      </div>
      <label className="mb-4 flex items-center justify-between gap-3 text-sm">Working hours per day
        <input aria-label="Working hours per day" type="number" min="1" max="24" step="0.5" value={draftHours} onChange={(event) => setDraftHours(event.target.value)} className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm" />
      </label>
      <div className="mb-4 rounded-lg border border-border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold">Requirement plan</p>
          <span className="text-[10px] text-muted-foreground">{requirementPlan.requirements.length} requirements · grouped by task effort</span>
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {phasesLoading ? <p className="py-3 text-center text-xs text-muted-foreground">Loading tasks…</p> : requirementPlan.requirements.length === 0 ? <p className="py-3 text-center text-xs text-muted-foreground">No linked requirements to plan.</p> : requirementPlan.requirements.map((requirement) => (
            <div key={requirement.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md bg-background px-2.5 py-2 text-xs">
              <span className="truncate font-medium" title={`${requirement.id} · ${requirement.title}`}>{requirement.id} · {requirement.title}</span>
              <span className="text-right font-semibold tabular-nums">{(requirement.totalMinutes / 60).toFixed(1)}h total</span>
              <span className="truncate text-[10px] text-muted-foreground">{requirement.taskCount} tasks · Sprint{requirement.sprintNumbers.length > 1 ? "s" : ""} {requirement.sprintNumbers.length ? requirement.sprintNumbers.join(", ") : requirement.sprintNumber}</span>
              <span className="text-right text-[10px] font-medium tabular-nums text-blue-700">{(requirement.remainingMinutes / 60).toFixed(1)}h remaining</span>
              <span className={requirement.overCapacityMinutes > 0 ? "text-[10px] font-medium text-amber-700" : "text-[10px] text-muted-foreground"}>
                {requirement.overCapacityMinutes > 0 ? `${(requirement.overCapacityMinutes / 60).toFixed(1)}h over sprint capacity` : `${formatShortDate(requirement.start)} – ${formatShortDate(requirement.end)}`}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={phasesLoading || !draftDays.length || Number(draftHours) < 1 || Number(draftHours) > 24 || Number(sprintDays) < 1 || Number(sprintDays) > 60}>{phasesLoading ? "Loading schedule…" : "Apply & build schedule"}</Button>
      </div>
    </div>
  );
}
