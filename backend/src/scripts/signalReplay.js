'use strict';
// Offline, in-memory replay of the scenario signals through the SAME decision, evidence and profile code the app uses
// (decideAnalysis, extractEvidence, updateProfile, combinedMatrix). Used by network:evaluate. Writes nothing: no ledger
// entries, no evidence rows, no profiles in the database.
const aiClient = require('../shared/aiClient');
const { decideAnalysis, rankedToMatch, candidatesOf, wouldAutoApply } = require('../modules/signals/service');
const { extractEvidence } = require('../modules/network/evidence');
const { updateProfile } = require('../modules/network/profile');
const { combinedMatrix, pairKey } = require('../modules/network/combine');

const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/**
 * Classify and match every signal ONCE (the expensive ai-service calls), so several replays can reuse the answers.
 * @param reqs     lean requirement docs of one project
 * @param signals  seeded signals, oldest first
 * @returns analysis[i] = { ai, ranked }  (ranked = null for None / unclassified signals)
 */
async function analyseSignals(reqs, signals) {
  const classified = [];
  for (const part of chunks(signals, 100)) classified.push(...(await aiClient.classifyBatch(part.map((s) => s.text))));
  const need = signals.map((_, i) => i).filter((i) => classified[i].label && classified[i].label !== 'None');
  const ranked = new Map();
  for (const part of chunks(need, 100)) {
    const lists = await aiClient.matchBatch(part.map((i) => signals[i].text), candidatesOf(reqs), 3);
    part.forEach((i, k) => ranked.set(i, lists[k] ?? []));
  }
  return signals.map((_, i) => ({ ai: classified[i], ranked: ranked.get(i) ?? null }));
}

/**
 * Replay the signals whose index passes `include`, in order: decide exactly like POST /signals (auto-accept policy, status
 * engine with the evolving statuses), and for every signal that WOULD be applied collect evidence and fold its embedding
 * into the matched requirement's signal profile.
 * @returns { applied, considered, idmention, coref, evidence: Map, profiles: Map reqId -> { vector, count } }
 */
async function replay({ reqs, signals, analysis, include = () => true }) {
  const status = new Map(reqs.map((r) => [r.reqId, r.initialStatus ?? r.liveStatus]));
  const ids = reqs.map((r) => r.reqId);
  const evidence = new Map();
  const appliedTo = []; // { reqId, text }
  let considered = 0;
  let idmention = 0;
  let coref = 0;
  signals.forEach((s, i) => {
    if (!include(s, i)) return;
    considered += 1;
    const { ai, ranked } = analysis[i];
    let match = null;
    let requirement = null;
    if (ranked) ({ match, requirement } = rankedToMatch(ranked, reqs));
    if (requirement) requirement = { ...requirement, liveStatus: status.get(requirement.reqId) };
    const a = decideAnalysis({ text: s.text, ai, requirement, match });
    if (!wouldAutoApply(a)) return;
    status.set(requirement.reqId, a.engine?.proposedStatus ?? status.get(requirement.reqId));
    appliedTo.push({ reqId: requirement.reqId, text: s.text });
    for (const row of extractEvidence({ text: s.text, requirementId: requirement.reqId, alternatives: match.alternatives, projectReqIds: ids })) {
      const key = pairKey(row.reqA, row.reqB);
      const c = evidence.get(key) || { idMention: 0, coref: 0 };
      if (row.kind === 'idmention') { c.idMention += 1; idmention += 1; } else { c.coref += 1; coref += 1; }
      evidence.set(key, c);
    }
  });

  const profiles = new Map();
  for (const part of chunks(appliedTo, 200)) {
    const res = await aiClient.embed(part.map((x) => x.text));
    part.forEach((x, k) => profiles.set(x.reqId, updateProfile(profiles.get(x.reqId), res.vectors[k])));
  }
  return { considered, applied: appliedTo.length, idmention, coref, evidence, profiles };
}

/** The signal-informed similarity matrix for one project after a replay. */
function signalMatrix(reqs, vectors, rep) {
  const withVecs = reqs.map((r, i) => ({ reqId: r.reqId, embedding: vectors[i], signalProfile: rep.profiles.get(r.reqId) }));
  return combinedMatrix(withVecs, rep.evidence).sim;
}

module.exports = { analyseSignals, replay, signalMatrix };
