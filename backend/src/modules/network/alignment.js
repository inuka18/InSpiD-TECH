'use strict';
// Pure: alignment = how far the current network has drifted from a frozen baseline.
const K = require('./constants');

const keyOf = (a, b) => (a < b ? `${a}~${b}` : `${b}~${a}`);
// "A~B~semantic" (link id) or { source, target } / { reqA, reqB } -> "A~B"
const linkSetKey = (l) => (typeof l === 'string' ? l.split('~').slice(0, 2).join('~') : keyOf(l.source ?? l.reqA, l.target ?? l.reqB));
const toSet = (links) => new Set(links.map(linkSetKey));

/** round(100 * |B n C| / |B u C|) over the undirected link sets; two empty sets are identical (100). */
function jaccardScore(baselineLinks, currentLinks) {
  const B = toSet(baselineLinks);
  const C = toSet(currentLinks);
  let both = 0;
  for (const k of B) if (C.has(k)) both += 1;
  const union = B.size + C.size - both;
  return union === 0 ? 100 : Math.round((100 * both) / union);
}

function bandOf(score) {
  if (score >= K.BAND_STRONG_MIN) return 'Strong Alignment';
  if (score >= K.BAND_MODERATE_MIN) return 'Moderate Drift';
  return 'Significant Drift';
}

/** Asia/Colombo calendar day (YYYY-MM-DD) of an instant. */
const dayOf = (date) => new Date(new Date(date).getTime() + K.DAY_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Replay NETWORK_UPDATE ledger entries after the baseline.
 * @param baselineLinks  [{ source|reqA, target|reqB }]
 * @param updates        [{ timestamp, added: ["A~B~semantic"], removed: [...], triggeringSignalId }] oldest first
 * @returns {{ history: object[], links: Set<string> }}  daily rows from the baseline day to the last event day (capped at 90 days)
 *   - connectionsAdded / connectionsRemoved: link changes made on that day; changedConnections = added + removed
 *   - alignmentScore: Jaccard of the baseline and the replayed network at the END of the day; days without a change carry it forward
 *   - driverSignalId: the signal behind the day's largest single change, only when changedConnections >= DRIVER_MIN_CHANGED
 */
function rebuildHistory({ baselineLinks, baselineDate, updates }) {
  const current = toSet(baselineLinks);
  const firstDay = dayOf(baselineDate);
  const byDay = new Map();
  for (const u of updates) {
    const d = dayOf(u.timestamp);
    if (d < firstDay) continue;
    (byDay.get(d) || byDay.set(d, []).get(d)).push(u);
  }
  const lastEvent = [...byDay.keys()].sort().pop();
  const lastDay = lastEvent && lastEvent > firstDay ? lastEvent : firstDay;
  let start = firstDay;
  const span = Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86400000);
  if (span + 1 > K.HISTORY_MAX_DAYS) start = addDays(lastDay, -(K.HISTORY_MAX_DAYS - 1));

  const history = [];
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    let added = 0;
    let removed = 0;
    let best = null;
    for (const u of byDay.get(day) || []) {
      for (const id of u.removed) current.delete(linkSetKey(id));
      for (const id of u.added) current.add(linkSetKey(id));
      added += u.added.length;
      removed += u.removed.length;
      const size = u.added.length + u.removed.length;
      if (u.triggeringSignalId && (!best || size > best.size)) best = { size, id: u.triggeringSignalId };
    }
    if (day < start) continue; // replayed (state still advances) but not reported
    history.push({
      date: day,
      alignmentScore: jaccardScore(baselineLinks, [...current]),
      connectionsAdded: added,
      connectionsRemoved: removed,
      changedConnections: added + removed,
      driverSignalId: added + removed >= K.DRIVER_MIN_CHANGED && best ? best.id : null,
    });
  }
  return { history, links: current };
}

module.exports = { jaccardScore, bandOf, rebuildHistory, dayOf, linkSetKey };
