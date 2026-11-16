'use strict';
// Pure: which requirement pairs does an applied signal give evidence for?
//   coref     the matcher found two requirements about equally similar to the message (the message talks about both)
//   idmention the text names requirement ids of this project (RET-R04 ...)
const K = require('./constants');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const orderPair = (a, b) => (a < b ? [a, b] : [b, a]);

/** Distinct ids of THIS project that the text mentions, in order of first appearance, as stored (e.g. "RET-R04"). */
function mentionedIds(text, projectReqIds) {
  const ids = [...projectReqIds].sort((a, b) => b.length - a.length);
  if (!ids.length || !text) return [];
  // a mention is the id, any case, not glued to other id characters (so RET-R04 does not match inside RET-R040 or XRET-R04)
  const re = new RegExp(`(?<![A-Za-z0-9-])(${ids.map(escapeRe).join('|')})(?![A-Za-z0-9])`, 'gi');
  const byUpper = new Map(ids.map((id) => [id.toUpperCase(), id]));
  const found = [];
  for (const m of text.matchAll(re)) {
    const id = byUpper.get(m[1].toUpperCase());
    if (id && !found.includes(id)) found.push(id);
  }
  return found;
}

/**
 * @param p.text            the signal text
 * @param p.requirementId   the requirement the signal was applied to
 * @param p.alternatives    [{ requirementId, similarity }] the matcher's ranked candidates (model view; may be empty)
 * @param p.projectReqIds   all requirement ids of the project
 * @returns {{ kind, reqA, reqB, similarityA, similarityB }[]}  reqA < reqB, at most one row per pair (an id mention wins)
 */
function extractEvidence({ text, requirementId, alternatives = [], projectReqIds }) {
  const simOf = (id) => alternatives.find((a) => a.requirementId === id)?.similarity ?? null;
  const rows = new Map();
  const add = (kind, x, y) => {
    if (x === y) return;
    const [reqA, reqB] = orderPair(x, y);
    const key = `${reqA}|${reqB}`;
    if (!rows.has(key)) rows.set(key, { kind, reqA, reqB, similarityA: simOf(reqA), similarityB: simOf(reqB) });
  };

  // (b) id mentions first, so they win over an inferred co-reference of the same pair
  const ids = mentionedIds(text, projectReqIds);
  if (ids.length >= 2) {
    for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) add('idmention', ids[i], ids[j]);
  } else if (ids.length === 1 && requirementId && ids[0] !== requirementId) {
    add('idmention', ids[0], requirementId);
  }

  // (a) co-reference: the top two candidates are both similar enough and close to each other. The signal must have been
  // applied to one of them (a PM correction to some other requirement does not turn the model's pair into evidence).
  const [first, second] = alternatives;
  if (first && second && first.similarity >= K.COREF_MIN_SIMILARITY && second.similarity >= K.COREF_MIN_SIMILARITY
    && Math.abs(first.similarity - second.similarity) <= K.COREF_MAX_GAP + 1e-9
    && (requirementId === first.requirementId || requirementId === second.requirementId)) {
    add('coref', first.requirementId, second.requirementId);
  }
  return [...rows.values()].sort((a, b) => (a.reqA + a.reqB < b.reqA + b.reqB ? -1 : 1));
}

module.exports = { extractEvidence, mentionedIds };
