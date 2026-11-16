import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Clock3, Sun } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog";
import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { flattenTasks, statusBadgeVariant, statusLabel, TODAY, taskAssigneeIds } from "../lib/scheduleUtils";
import { getLeaveHours, getLeaveLabel, previewLeaveImpact } from "../lib/leaveAutomation";
import { useWorkCalendar } from "../context/WorkCalendarContext";
import { cn } from "../../../lib/utils";

const CAPACITY_VARIANT = {
  "Over-allocated": "danger",
  "Near Capacity": "warning",
  Balanced: "success",
  "Under-utilized": "info",
};

function dateInputValue(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function ResourceProfileModal({ capacity, phases, capacityRecords = [], open, onOpenChange, onSelectTask, onApplyLeave }) {
  const { settings } = useWorkCalendar();
  const [leaveType, setLeaveType] = useState(capacity?.leaveType ?? "full-day");
  const [customHours, setCustomHours] = useState(String(capacity?.leaveHours ?? 8));
  const [leaveDate, setLeaveDate] = useState(dateInputValue(capacity?.leaveDate ?? TODAY));

  const ratioPct = capacity ? Math.round((capacity.plannedHours / capacity.availableHours) * 100) : 0;
  const myTasks = useMemo(
    () => (capacity ? flattenTasks(phases ?? []).filter((t) => taskAssigneeIds(t).includes(capacity.memberId)) : []),
    [capacity, phases]
  );

  useEffect(() => {
    if (!capacity) return;
    setLeaveType(capacity.leaveType ?? "full-day");
    setCustomHours(String(capacity.leaveHours ?? 8));
    setLeaveDate(dateInputValue(capacity.leaveDate ?? TODAY));
  }, [capacity]);

  const selectedLeaveDate = useMemo(() => new Date(`${leaveDate}T12:00:00`), [leaveDate]);

  const leavePreview = useMemo(
    () => (capacity ? previewLeaveImpact({ capacity, phases, capacityRecords, leaveType, customHours, leaveDate: selectedLeaveDate, settings }) : null),
    [capacity, phases, capacityRecords, leaveType, customHours, selectedLeaveDate, settings]
  );

  const handleApply = () => {
    if (leaveType === "custom" && (!Number.isFinite(Number(customHours)) || Number(customHours) <= 0 || Number(customHours) > 24)) return;
    const result = onApplyLeave?.({ leaveType, customHours: Number(customHours), leaveDate: selectedLeaveDate });
    if (result) onOpenChange(false);
  };

  if (!capacity) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11">
              <AvatarFallback>
                {capacity.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <DialogTitle>{capacity.name}</DialogTitle>
              <DialogDescription>{capacity.role}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <span className="text-muted-foreground">
              {capacity.plannedHours}h planned / {capacity.availableHours}h available
            </span>
            <Badge variant={CAPACITY_VARIANT[capacity.status] ?? "outline"}>{capacity.status}</Badge>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", ratioPct > 100 ? "bg-status-dropped-fg" : ratioPct >= 85 ? "bg-status-atrisk-fg" : "bg-status-confirmed-fg")}
              style={{ width: `${Math.min(ratioPct, 100)}%` }}
            />
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-sm font-semibold text-foreground">Plan time off</p>
            <p className="mt-3 text-xs font-medium text-muted-foreground">Leave duration</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { value: "full-day", label: "Full day", hours: `${settings.hoursPerDay} hours`, icon: Sun },
                { value: "half-day", label: "Half day", hours: `${settings.hoursPerDay / 2} hours`, icon: Clock3 },
                { value: "custom", label: "Custom", hours: "Set hours", icon: Check },
              ].map(({ value, label, hours, icon: Icon }) => {
                const active = leaveType === value;
                return <button key={value} type="button" aria-pressed={active} onClick={() => setLeaveType(value)} className={cn("rounded-lg border px-2 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border bg-background hover:border-primary/40 hover:bg-muted/40")}>
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}><Icon className="h-3.5 w-3.5" /></span>
                  <span className="mt-2 block text-xs font-semibold text-foreground">{label}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{hours}</span>
                </button>;
              })}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="leave-date" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />Leave date</label>
                <Input id="leave-date" type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} />
              </div>
              <div>
                {leaveType === "custom" ? <>
                  <label htmlFor="custom-leave-hours" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" />Leave hours</label>
                  <Input id="custom-leave-hours" type="number" min="0.5" max="24" step="0.5" value={customHours} onChange={(e) => setCustomHours(e.target.value)} placeholder="Enter hours" />
                </> : <>
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground"><Clock3 className="h-3.5 w-3.5 text-muted-foreground" />Leave hours</span>
                  <div className="flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm text-foreground">{getLeaveHours(leaveType, customHours, settings)} hours</div>
                </>}
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="rounded-md border border-border bg-background px-2.5 py-2">
                <p className="font-semibold text-foreground">Leave impact</p>
                <p>{leavePreview?.leaveHours ?? 0}h tracked, {leavePreview?.estimatedDelayDays ?? 0}d slip if no backup is available.</p>
              </div>
              <div className="rounded-md border border-border bg-background px-2.5 py-2">
                <p className="font-semibold text-foreground">Backup resource</p>
                <p>{leavePreview?.replacement ? leavePreview.replacement.name : "No same-role backup found"}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" onClick={handleApply} disabled={!onApplyLeave || !leaveDate || (leaveType === "custom" && (!Number.isFinite(Number(customHours)) || Number(customHours) <= 0 || Number(customHours) > 24))} className="shrink-0">
                Save leave and update schedule
              </Button>
              {capacity.offToday && (
                <Badge variant="outline" className="self-center">
                  {getLeaveLabel(capacity.leaveType ?? "full-day", capacity.leaveHours)} leave active
                </Badge>
              )}
            </div>
            {leavePreview?.affectedTasks?.length > 0 && (
              <div className="mt-3 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Affected tasks</p>
                <ul className="space-y-1 text-xs text-foreground">
                  {leavePreview.affectedTasks.slice(0, 4).map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5">
                      <span className="truncate">{task.name}</span>
                      <span className="shrink-0 text-muted-foreground">{leavePreview.taskPlans.find((plan) => plan.task.id === task.id)?.replacement ? `Assign to ${leavePreview.taskPlans.find((plan) => plan.task.id === task.id).replacement.name}` : "Move to next working day"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Scheduled Tasks ({myTasks.length})
            </p>
            {myTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scheduled tasks for this person.</p>
            ) : (
              <ul className="space-y-1.5">
                {myTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      onClick={() => onSelectTask?.(task)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
                    >
                      <span className="truncate text-foreground">{task.name}</span>
                      <Badge variant={statusBadgeVariant(task)} className="shrink-0 text-[10px]">
                        {statusLabel(task)}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
