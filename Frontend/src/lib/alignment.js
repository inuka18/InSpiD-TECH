// Small pure helpers for the alignment views.

// Colours for the three alignment bands (same status tokens the trend chart uses).
export function bandStyle(band) {
  if (band === "Strong Alignment") return { tone: "text-status-confirmed-fg", bg: "bg-status-confirmed-bg" };
  if (band === "Moderate Drift") return { tone: "text-status-atrisk-fg", bg: "bg-status-atrisk-bg" };
  return { tone: "text-status-dropped-fg", bg: "bg-status-dropped-bg" };
}

// Sum of the last 7 history days (the history is daily, so this is "this week").
export function weeklyBreakdown(history) {
  return history.slice(-7).reduce(
    (acc, day) => ({
      changedConnections: acc.changedConnections + day.changedConnections,
      connectionsAdded: acc.connectionsAdded + day.connectionsAdded,
      connectionsRemoved: acc.connectionsRemoved + day.connectionsRemoved,
    }),
    { changedConnections: 0, connectionsAdded: 0, connectionsRemoved: 0 }
  );
}

export const formatBaselineDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
