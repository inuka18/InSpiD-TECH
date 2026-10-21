import { useEffect, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useSchedulePhases } from "../../../hooks/useSchedulePhases";
import { useWorkCalendar, recalculateTasksForWorkCalendar } from "../context/WorkCalendarContext";
import { useScheduleHistory } from "../context/ScheduleHistoryContext";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function SprintPlanner({ projectId, onClose }) {
  const { data: phases } = useSchedulePhases(projectId);
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

  const apply = () => {
    const next = { ...settings, workdays: draftDays, hoursPerDay: Number(draftHours), sprintDays: Number(sprintDays) };
    if (draftDays.length === 0 || !Number(draftHours) || Number(draftHours) < 1 || Number(draftHours) > 24 || !Number(sprintDays) || Number(sprintDays) < 1 || Number(sprintDays) > 60) return;
    const changedCalendar = Number(draftHours) !== settings.hoursPerDay || draftDays.length !== settings.workdays.length || !draftDays.every((day) => settings.workdays.includes(day));
    if (changedCalendar) {
      const snapshots = recalculateTasksForWorkCalendar(phases, settings, next);
      pushHistory("Changed sprint planner settings", () => {
        snapshots.forEach(({ task, start, end, durationMinutes }) => Object.assign(task, { start, end, durationMinutes }));
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
        <div><h3 className="text-sm font-semibold">Sprint Planner</h3><p className="text-xs text-muted-foreground">Set sprint length and team working time.</p></div>
      </div>
      <label className="mb-4 flex items-center justify-between gap-3 text-sm">
        Sprint days
        <input aria-label="Sprint days" type="number" min="1" max="60" value={sprintDays} onChange={(event) => setSprintDays(event.target.value)} className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm" />
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={apply} disabled={!draftDays.length || Number(draftHours) < 1 || Number(draftHours) > 24 || Number(sprintDays) < 1 || Number(sprintDays) > 60}>Apply</Button>
      </div>
    </div>
  );
}
