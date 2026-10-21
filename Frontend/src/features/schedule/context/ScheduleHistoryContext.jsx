import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ScheduleHistoryContext = createContext(null);

// A single global undo stack for every mutating action across Component
// 3 (drag-to-reschedule, Redistribute Buffers), wraps ScheduleLayout's
// <Outlet> so any descendant page can push an entry. Entries carry a
// `restore()` closure that writes the pre-mutation values straight back
// onto the same (shared, unshared-clone) task objects every read path
// already points at, the same direct-mutation model the rest of this
// prototype uses, just with a memory of what it overwrote.
//
// `refreshToken` only advances on undo (never on push: the action that
// pushed an entry already re-rendered its own view). It's used as the
// Outlet's `key` so undoing while looking at a *different* page than the
// one that made the mutation still forces a fresh read of the
// now-reverted data, without every drag remounting the whole route.
export function ScheduleHistoryProvider({ children }) {
  const [stack, setStack] = useState([]);
  const [versions, setVersions] = useState([]);
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

  const saveVersion = useCallback((label, tasks) => {
    const snapshot = tasks.map((task) => ({ id: task.id, start: task.start, end: task.end, assigneeId: task.assigneeId, assigneeIds: task.assigneeIds, status: task.status }));
    setVersions((prev) => [{ id: `schedule-v${prev.length + 1}`, label, createdAt: new Date().toISOString(), taskCount: snapshot.length, snapshot }, ...prev].slice(0, 10));
  }, []);

  const value = useMemo(
    () => ({
      pushHistory,
      undo,
      canUndo: stack.length > 0,
      lastLabel: stack[stack.length - 1]?.label ?? null,
      refreshToken,
      versions,
      saveVersion,
    }),
    [pushHistory, undo, stack, refreshToken, versions, saveVersion]
  );

  return <ScheduleHistoryContext.Provider value={value}>{children}</ScheduleHistoryContext.Provider>;
}

export function useScheduleHistory() {
  const ctx = useContext(ScheduleHistoryContext);
  if (!ctx) throw new Error("useScheduleHistory must be used within a ScheduleHistoryProvider");
  return ctx;
}
