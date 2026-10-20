'use strict';
// Pure helpers for storing the computed network incrementally.

/** Canonical link id. reqA < reqB (plain string order), so the same pair always gives the same id. */
const linkKey = (a, b) => (a < b ? `${a}~${b}~semantic` : `${b}~${a}~semantic`);
const orderPair = (a, b) => (a < b ? [a, b] : [b, a]);

/**
 * @param stored   [{ reqA, reqB, weight }] currently stored pathfinder links
 * @param computed [{ reqA, reqB, weight }] newly computed links
 * @returns {{ added: object[], removed: object[], kept: object[], reweighted: object[] }}
 *   added/removed drive the ledger entry; reweighted = kept links whose weight changed (updated silently).
 */
function diffLinks(stored, computed, weightTolerance = 1e-6) {
  const old = new Map(stored.map((l) => [linkKey(l.reqA, l.reqB), l]));
  const next = new Map(computed.map((l) => [linkKey(l.reqA, l.reqB), l]));
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const withId = (m) => [...m.entries()].map(([id, l]) => ({ id, ...l }));
  const added = withId(next).filter((l) => !old.has(l.id)).sort(byId);
  const removed = withId(old).filter((l) => !next.has(l.id)).sort(byId);
  const kept = withId(next).filter((l) => old.has(l.id)).sort(byId);
  const reweighted = kept.filter((l) => Math.abs((old.get(l.id).weight ?? 0) - l.weight) > weightTolerance);
  return { added, removed, kept, reweighted };
}

module.exports = { diffLinks, linkKey, orderPair };
