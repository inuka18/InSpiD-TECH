import { createContext, useContext, useMemo, useState } from "react";

const DEFAULT_WORK_CALENDAR = { workdays: [1, 2, 3, 4, 5], hoursPerDay: 8, startHour: 9, sprintDays: 10 };
const WorkCalendarContext = createContext(null);

export function WorkCalendarProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_WORK_CALENDAR);
  const value = useMemo(() => ({ settings, setSettings }), [settings]);
  return <WorkCalendarContext.Provider value={value}>{children}</WorkCalendarContext.Provider>;
}

export function useWorkCalendar() {
  const context = useContext(WorkCalendarContext);
  if (!context) throw new Error("useWorkCalendar must be used inside WorkCalendarProvider");
  return context;
}

function nextWorkingStart(date, settings) {
  const cursor = new Date(date);
  cursor.setSeconds(0, 0);
  for (let i = 0; i < 14; i += 1) {
    if (settings.workdays.includes(cursor.getDay())) {
      const open = new Date(cursor);
      open.setHours(settings.startHour, 0, 0, 0);
      const close = new Date(open.getTime() + settings.hoursPerDay * 60 * 60 * 1000);
      if (cursor < open) return open;
      if (cursor < close) return cursor;
    }
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(settings.startHour, 0, 0, 0);
  }
  return cursor;
}

export function normalizeWorkingStart(start, settings) {
  return nextWorkingStart(start, settings);
}

export function addWorkingMinutes(start, minutes, settings) {
  let cursor = nextWorkingStart(start, settings);
  let remaining = Math.max(0, Number(minutes) || 0);
  if (remaining === 0) return cursor;

  while (remaining > 0) {
    const endOfWorkday = new Date(cursor);
    endOfWorkday.setHours(settings.startHour + settings.hoursPerDay, 0, 0, 0);
    const available = Math.max(0, Math.floor((endOfWorkday - cursor) / 60000));
    if (remaining <= available) {
      cursor = new Date(cursor.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      remaining -= available;
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(settings.startHour, 0, 0, 0);
      cursor = nextWorkingStart(cursor, settings);
    }
  }
  return cursor;
}

export function workingDaysBetween(start, end, workdays) {
  const cursor = new Date(start);
  const finish = new Date(end);
  cursor.setHours(0, 0, 0, 0);
  finish.setHours(0, 0, 0, 0);
  let count = 0;
  while (cursor <= finish) {
    if (workdays.includes(cursor.getDay())) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(1, count);
}

export function recalculateTasksForWorkCalendar(phases, previousSettings, nextSettings) {
  const snapshots = [];
  phases.flatMap((phase) => phase.tasks).forEach((task) => {
    snapshots.push({ task, start: task.start, end: task.end, durationMinutes: task.durationMinutes });
    const effort = task.durationMinutes ?? workingDaysBetween(task.start, task.end, previousSettings.workdays) * previousSettings.hoursPerDay * 60;
    const nextStart = nextWorkingStart(task.start, nextSettings);
    task.durationMinutes = effort;
    task.start = nextStart.toISOString();
    task.end = addWorkingMinutes(nextStart, effort, nextSettings).toISOString();
  });
  return snapshots;
}

export { DEFAULT_WORK_CALENDAR };
