import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ScheduleHistoryContext = createContext(null);

// A single global undo stack for every mutating action across Component
// 3 (drag-to-reschedule, Redistribute Buffers), wraps ScheduleLayout's
// <Outlet> so any descendant page can push an entry. Entries carry a
// `restore()` closure that writes the pre-mutation values straight back
// onto the same shared task objects every read path
// already points at, the same direct-mutation model the rest of this
// prototype uses, just with a memory of what it overwrote.
//
// `refreshToken` advances after a mutation or undo. It's used as the
// Outlet's `key` so undoing while looking at a *different* page than the
// one that made the mutation still forces a fresh read of the
// latest data after a change or undo.
export function ScheduleHistoryProvider({ children }) {
  const [stack, setStack] = useState([]);
  const [versions, setVersions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("schedule-versions-v1") ?? "[]");
    } catch {
      return [];
    }
  });
  const [refreshToken, setRefreshToken] = useState(0);

  const pushHistory = useCallback((label, restore) => {
    setStack((prev) => [...prev, { label, restore }]);
  }, []);

  const undo = useCallback(() => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      last.restore();
      setRefreshToken((t) => t + 1);
      return prev.slice(0, -1);
    });
  }, []);

  const refreshSchedule = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  const saveVersion = useCallback((label, tasks, projectId) => {
    const snapshot = tasks.map((task) => ({
      id: task.id,
      name: task.name,
      start: task.start,
      end: task.end,
      baselineStart: task.baselineStart,
      baselineEnd: task.baselineEnd,
      assigneeId: task.assigneeId,
      assigneeIds: task.assigneeIds,
      status: task.status,
      progress: task.progress,
      durationMinutes: task.durationMinutes,
      plannedSprintNumber: task.plannedSprintNumber,
      critical: task.critical,
    }));
    const inferredProjectId = projectId ?? tasks[0]?.projectId ?? (tasks[0]?.id?.includes("-mp-") ? "proj-meridianpay" : "proj-novacart");
    const version = {
      id: `schedule-${Date.now()}`,
      projectId: inferredProjectId,
      label,
      createdAt: new Date().toISOString(),
      taskCount: snapshot.length,
      snapshot,
    };
    setVersions((prev) => {
      const next = [version, ...prev].slice(0, 50);
      try { localStorage.setItem("schedule-versions-v1", JSON.stringify(next)); } catch { /* storage may be unavailable */ }
      return next;
    });
    return version;
  }, []);

  const value = useMemo(
    () => ({
      pushHistory,
      undo,
      refreshSchedule,
      canUndo: stack.length > 0,
      lastLabel: stack[stack.length - 1]?.label ?? null,
      refreshToken,
      versions,
      saveVersion,
    }),
    [pushHistory, undo, refreshSchedule, stack, refreshToken, versions, saveVersion]
  );

  return <ScheduleHistoryContext.Provider value={value}>{children}</ScheduleHistoryContext.Provider>;
}

export function useScheduleHistory() {
  const ctx = useContext(ScheduleHistoryContext);
  if (!ctx) throw new Error("useScheduleHistory must be used within a ScheduleHistoryProvider");
  return ctx;
}
