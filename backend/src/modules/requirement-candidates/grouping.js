'use strict';
// The database and ai-service side of the new-requirement detector: token statistics, embedding, and attaching a
// candidate signal to a pending candidate / creating a new one / suppressing it (the pure rules are in signals/newRequirement.js).
const AppError = require('../../shared/AppError');
const aiClient = require('../../shared/aiClient');
const { Signal } = require('../signals/model');
const C = require('../signals/newRequirementConstants');
const nr = require('../signals/newRequirement');
const { RequirementCandidate } = require('./model');

const requirementText = (r) => `${r.title}. ${r.description || ''}`.trim();

/** Token document frequencies from the project's requirement texts and ALL its signals (seeded ones count as earlier signals). */
async function loadTokenStats(projectId, reqs) {
  const signals = await Signal.find({ projectId }, { text: 1 }).lean();
  return nr.buildTokenStats(reqs.map(requirementText), signals.map((s) => s.text));
}

// One /embed call for all texts. null = the ai-service could not embed (the caller degrades; this never throws for that).
async function embedTexts(texts) {
  if (!texts.length) return [];
  try {
    const res = await aiClient.embed(texts);
    if (!Array.isArray(res?.vectors) || res.vectors.length !== texts.length) return null;
    return res.vectors;
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return null;
  }
}

// Pending and rejected candidates with their centroids.
async function loadGroupingState(projectId) {
  const rows = await RequirementCandidate.find({ projectId, status: { $in: ['pending', 'rejected'] } }).select('+centroid candidateId status').lean();
  return { pending: rows.filter((r) => r.status === 'pending'), rejected: rows.filter((r) => r.status === 'rejected') };
}

/** Where would this embedding go? (read only) -> { action, candidateId, similarity } */
const chooseFor = (state, vector, opts) => nr.chooseGroup({ embedding: vector, pending: state.pending, rejected: state.rejected, opts });

/**
 * Preview / extract: for each candidate-looking item (texts[i], vectors[i]) which pending candidate it would join.
 * Nothing is written. -> [{ joinsCandidateId, suppressed }]
 */
async function previewJoins(projectId, vectors) {
  if (!vectors?.length) return [];
  const state = await loadGroupingState(projectId);
  return vectors.map((v) => {
    const c = chooseFor(state, v);
    return { joinsCandidateId: c.action === 'attach' ? c.candidateId : null, suppressed: c.action === 'suppress', similarCandidateId: c.action === 'suppress' ? c.candidateId : null };
  });
}

// RC-0001 per project (numeric ordering); a concurrent create takes the next free number.
async function createCandidateDoc(projectId, build) {
  for (let i = 0; i < 5; i += 1) {
    const last = await RequirementCandidate.findOne({ projectId }, { candidateId: 1 }).sort({ candidateId: -1 }).collation({ locale: 'en', numericOrdering: true }).lean();
    const n = last ? Number(String(last.candidateId).replace(/\D/g, '')) + 1 : 1;
    try {
      return await RequirementCandidate.create(build(`RC-${String(n).padStart(4, '0')}`));
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  throw new AppError(409, 'ID_BUSY', 'Could not allocate a candidate id (concurrent writes); try again');
}

const evidenceOf = (signal, similarity) => ({
  signalId: signal.signalId, text: signal.text, source: signal.source, authorRole: signal.authorRole, timestamp: signal.timestamp, similarity,
});

async function newCandidateFrom(projectId, signal, vector, det) {
  return createCandidateDoc(projectId, (candidateId) => ({
    projectId, candidateId, title: nr.suggestTitle(signal.text), description: signal.text, type: nr.guessType(signal.text),
    centroid: vector, evidence: [evidenceOf(signal, 1)], closestRequirementId: det.closestRequirementId, closestSimilarity: det.similarity,
    novelTokens: det.novelTokens ?? [], status: 'pending',
  }));
}

// Attach as more evidence and move the centroid. Optimistic on the evidence count; false = the candidate is no longer pending.
async function attachTo(projectId, candidateId, signal, vector, similarity) {
  for (let i = 0; i < 4; i += 1) {
    const cand = await RequirementCandidate.findOne({ projectId, candidateId, status: 'pending' }).select('+centroid').lean();
    if (!cand) return null;
    const n = cand.evidence.length;
    const updated = await RequirementCandidate.findOneAndUpdate(
      { projectId, candidateId, status: 'pending', evidence: { $size: n } },
      { $push: { evidence: evidenceOf(signal, similarity) }, $set: { centroid: nr.updateCentroid(cand.centroid, n, vector) } },
      { new: true }
    ).lean();
    if (updated) return updated;
  }
  return null;
}

/**
 * Decide the group BEFORE the signal is saved (so the signal can be stored as suppressed).
 * vector null (embedding unavailable) -> { action: 'ungrouped' }.
 */
async function decideGroup(projectId, vector) {
  if (!vector) return { action: 'ungrouped', candidateId: null, similarity: null };
  return chooseFor(await loadGroupingState(projectId), vector);
}

/**
 * After the signal is saved: attach it / create the candidate. Returns the candidate id the signal now belongs to (or null)
 * and writes it onto the signal.
 */
async function applyGroup(projectId, signal, vector, group, det) {
  if (group.action === 'suppress' || group.action === 'ungrouped') return null;
  let candidate = null;
  if (group.action === 'attach') candidate = await attachTo(projectId, group.candidateId, signal, vector, group.similarity);
  if (!candidate) candidate = await newCandidateFrom(projectId, signal, vector, det); // new, or the target was decided meanwhile
  await Signal.updateOne({ projectId, signalId: signal.signalId }, { $set: { candidateId: candidate.candidateId } });
  return candidate.candidateId;
}

/** A signal reviewed individually leaves its PENDING candidate's evidence; a candidate left without evidence is deleted. */
async function detachSignal(projectId, candidateId, signalId) {
  const c = await RequirementCandidate.findOneAndUpdate({ projectId, candidateId, status: 'pending' }, { $pull: { evidence: { signalId } } }, { new: true }).lean();
  if (c && !c.evidence.length) await RequirementCandidate.deleteOne({ projectId, candidateId, status: 'pending', 'evidence.0': { $exists: false } });
}

module.exports = {
  detachSignal,
  loadTokenStats, embedTexts, loadGroupingState, previewJoins, decideGroup, applyGroup, requirementText,
  SIM_HIGH: C.NEW_REQ_SIM_HIGH, MIN_CONFIDENCE: C.NEW_REQ_MIN_CONFIDENCE,
};
