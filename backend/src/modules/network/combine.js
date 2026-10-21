'use strict';
// Pure: the combined similarity of a requirement pair (text + signal profile + evidence boost).
const K = require('./constants');
const { cosineMatrix } = require('./pathfinder');

const round6 = (x) => Math.round(x * 1e6) / 1e6;
const cosine = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < a.length; k += 1) {
    dot += a[k] * b[k];
    na += a[k] * a[k];
    nb += b[k] * b[k];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

/** Weight of the profile term: 0 when either side has no profile, else grows with the thinner profile's signal count. */
function profileWeight(countA, countB) {
  const m = Math.min(countA || 0, countB || 0);
  return m > 0 ? K.PROFILE_MAX_WEIGHT * Math.min(1, m / K.PROFILE_FULL_COUNT) : 0;
}

/** Boost from the evidence rows of a pair: id mentions + co-references, each capped, summed, capped again. */
function evidenceBoost({ idMention = 0, coref = 0 } = {}) {
  const id = Math.min(K.IDMENTION_BOOST_CAP, K.IDMENTION_BOOST_PER_ROW * idMention);
  const co = Math.min(K.COREF_BOOST_CAP, K.COREF_BOOST_PER_ROW * coref);
  return Math.min(K.BOOST_TOTAL_CAP, id + co);
}

/**
 * @param p.textSim     cosine of the two requirement text embeddings
 * @param p.profileSim  cosine of the two signal profiles (ignored when the weight is 0)
 * @param p.countA/B    number of signals behind each profile (0 or undefined = no profile)
 * @param p.evidence    { idMention, coref } row counts
 * @returns {{ sim, contributions: { text, profile, boost }, w }}  contributions add up to sim (before the cap at 1)
 */
function combineSimilarity({ textSim, profileSim = 0, countA = 0, countB = 0, evidence = {} }) {
  const w = profileWeight(countA, countB);
  const boost = evidenceBoost(evidence);
  const text = (1 - w) * textSim;
  const profile = w * profileSim;
  const raw = text + profile + boost;
  const sim = Math.min(1, raw);
  // when the cap bites, scale the boost so the three parts still add up to the reported similarity
  const boostShown = raw > 1 ? boost - (raw - 1) : boost;
  return { sim: round6(sim), contributions: { text: round6(text), profile: round6(profile), boost: round6(boostShown) }, w };
}

/**
 * Combined n x n matrix.
 * @param reqs      [{ reqId, embedding, signalProfile?: { vector, count } }] in matrix order
 * @param evidence  Map "reqA|reqB" (sorted) -> { idMention, coref }
 * @returns {{ sim: number[][], parts: (pair) => contributions }}
 */
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function combinedMatrix(reqs, evidence = new Map()) {
  const text = cosineMatrix(reqs.map((r) => r.embedding));
  const n = reqs.length;
  const sim = Array.from({ length: n }, () => new Array(n).fill(1));
  const parts = new Map();
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const pi = reqs[i].signalProfile;
      const pj = reqs[j].signalProfile;
      const countA = pi?.vector?.length ? pi.count : 0;
      const countB = pj?.vector?.length ? pj.count : 0;
      const c = combineSimilarity({
        textSim: text[i][j],
        profileSim: countA && countB ? cosine(pi.vector, pj.vector) : 0,
        countA, countB, evidence: evidence.get(pairKey(reqs[i].reqId, reqs[j].reqId)) || {},
      });
      sim[i][j] = c.sim;
      sim[j][i] = c.sim;
      parts.set(pairKey(reqs[i].reqId, reqs[j].reqId), { ...c.contributions, textSim: text[i][j], w: c.w });
    }
  }
  return { sim, text, parts };
}

module.exports = { combineSimilarity, combinedMatrix, profileWeight, evidenceBoost, cosine, pairKey };
