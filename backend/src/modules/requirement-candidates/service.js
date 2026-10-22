'use strict';
// Requirement candidates: possible NEW requirements found by signals/newRequirement.js. Nothing in the requirements changes
// until a PM approves (creates a requirement), merges (maps the evidence to an existing one) or rejects a candidate.
//
// Every action first CLAIMS the candidate with findOneAndUpdate from `pending`, so two clicks or two PMs can never create two
// requirements: the loser gets 409. Approve and merge finalise the evidence signals through finalizeSignal (status effect,
// history row, evidence, profile) with the per-signal network update deferred, then run ONE network update, so the whole
// action writes at most one NETWORK_UPDATE ledger entry.
const AppError = require('../../shared/AppError');
const { Requirement } = require('../requirements/model');
const requirements = require('../requirements/service');
const network = require('../network/service');
const { LedgerEntry } = require('../ledger/model');
const { Signal, Feedback } = require('../signals/model');
const { finalizeSignal } = require('../signals/finalize');
const { RequirementCandidate } = require('./model');

const toApi = (c) => ({
  id: c.candidateId,
  projectId: c.projectId,
  title: c.title,
  description: c.description,
  type: c.type,
  status: c.status,
  closestRequirementId: c.closestRequirementId ?? null,
  closestSimilarity: c.closestSimilarity ?? null,
  novelTokens: c.novelTokens ?? [],
  mentions: c.evidence.length,
  evidence: c.evidence.map((e) => ({ signalId: e.signalId, text: e.text, source: e.source, authorRole: e.authorRole, timestamp: e.timestamp, similarity: e.similarity })),
  createdRequirementId: c.createdRequirementId ?? null,
  mergedInto: c.mergedInto ?? null,
  decidedBy: c.decidedBy ?? null,
  decidedAt: c.decidedAt ?? null,
  decisionNote: c.decisionNote ?? null,
  createdAt: c.createdAt,
});

// Newest first. The centroid is never returned (and not even loaded: it is select:false).
async function list(projectId, { status } = {}) {
  const q = { projectId };
  if (status) q.status = status;
  return (await RequirementCandidate.find(q).sort({ createdAt: -1, candidateId: -1 }).lean()).map(toApi);
}

async function getOne(projectId, candidateId) {
  const c = await RequirementCandidate.findOne({ projectId, candidateId }).lean();
  if (!c) throw new AppError(404, 'NOT_FOUND', `Requirement candidate ${candidateId} not found`);
  return c;
}

const TARGET_STATUS = { approve: 'approved', merge: 'merged', reject: 'rejected' };

// pending -> final status, atomically. null = somebody else decided it first.
const claim = (projectId, candidateId, set) =>
  RequirementCandidate.findOneAndUpdate({ projectId, candidateId, status: 'pending' }, { $set: set }, { new: true }).lean();

// Accept one evidence signal as an Expectation of `requirementId` (claim it from `pending`, then finalise without a network update).
async function acceptSignal(projectId, signalId, requirementId, user, note) {
  const claimed = await Signal.findOneAndUpdate(
    { projectId, signalId, reviewStatus: 'pending' },
    { $set: { reviewStatus: 'accepted', reviewedBy: user.email, reviewedAt: new Date(), reviewAction: 'accept', reviewNote: note ?? null, label: 'Expectation', reqId: requirementId, matchMethod: 'manual' } },
    { new: true }
  ).lean();
  if (!claimed) return null; // reviewed on its own in the meantime
  const fin = await finalizeSignal({ projectId, signal: claimed, label: 'Expectation', requirementId, actor: user.email, deferNetwork: true });
  return { signal: claimed, fin };
}

// The NETWORK_UPDATE entry written since `since`, if any (for the response).
async function latestNetworkEntry(projectId, since) {
  const e = await LedgerEntry.findOne({ projectId, eventType: 'NETWORK_UPDATE', timestamp: { $gte: since } }).sort({ blockNumber: -1 }).lean();
  return e ? { txHash: e.txHash, blockNumber: e.blockNumber } : null;
}

async function review(projectId, candidateId, body, user) {
  const { action, note } = body;
  const cand = await getOne(projectId, candidateId);
  if (cand.status !== 'pending') throw new AppError(409, 'ALREADY_DECIDED', `Candidate ${candidateId} was already ${cand.status}`);
  if (action === 'merge' && !(await Requirement.exists({ projectId, reqId: body.mergeIntoRequirementId }))) {
    throw new AppError(404, 'NOT_FOUND', `Requirement ${body.mergeIntoRequirementId} not found in this project`);
  }

  const claimed = await claim(projectId, candidateId, {
    status: TARGET_STATUS[action], decidedBy: user.email, decidedAt: new Date(), decisionNote: note ?? null,
    ...(action === 'merge' ? { mergedInto: body.mergeIntoRequirementId } : {}),
    ...(action === 'approve' ? { title: body.title ?? cand.title, description: body.description ?? cand.description, type: body.type ?? cand.type } : {}),
  });
  if (!claimed) throw new AppError(409, 'ALREADY_DECIDED', `Candidate ${candidateId} was decided by someone else just now`);

  const result = { candidate: null, requirement: null, signals: [], statusChanges: [], ledgerEntries: [] };
  let requirementId = null;
  try {
    if (action === 'approve') {
      const first = claimed.evidence[0];
      const created = await requirements.create(projectId, {
        title: claimed.title, description: claimed.description, type: claimed.type, granularity: 'Sprint Commitment',
        ...(body.priority ? { priority: body.priority } : {}),
      }, user, { skipNetwork: true, triggeringSignal: first ? { signalId: first.signalId, text: first.text } : null });
      requirementId = created.id;
      await RequirementCandidate.updateOne({ projectId, candidateId }, { $set: { createdRequirementId: requirementId } });
    } else if (action === 'merge') {
      requirementId = body.mergeIntoRequirementId;
    }
  } catch (err) {
    // Nothing was created: the candidate is pending again.
    await RequirementCandidate.updateOne({ projectId, candidateId }, { $set: { status: 'pending', decidedBy: null, decidedAt: null, decisionNote: null, mergedInto: null } });
    throw err;
  }

  if (action === 'reject') {
    await Signal.updateMany(
      { projectId, signalId: { $in: claimed.evidence.map((e) => e.signalId) }, reviewStatus: 'pending' },
      { $set: { reviewStatus: 'rejected', reviewedBy: user.email, reviewedAt: new Date(), reviewAction: 'reject', reviewNote: note ?? null } }
    );
  } else {
    const applied = [];
    for (const e of claimed.evidence) {
      try {
        const r = await acceptSignal(projectId, e.signalId, requirementId, user, note);
        if (!r) { result.signals.push({ signalId: e.signalId, status: 'skipped', reason: 'already reviewed' }); continue; }
        applied.push({ signal: r.signal, requirementId });
        if (r.fin.statusChange) result.statusChanges.push({ signalId: e.signalId, requirementId, ...r.fin.statusChange });
        if (r.fin.ledgerEntry) result.ledgerEntries.push(r.fin.ledgerEntry);
        result.signals.push({ signalId: e.signalId, status: 'accepted', requirementId });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        await Signal.updateOne({ projectId, signalId: e.signalId, reviewStatus: 'accepted', reviewedBy: user.email }, { $set: { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null, reviewAction: null } });
        result.signals.push({ signalId: e.signalId, status: 'failed', error: err.message });
      }
    }
    // ONE network update for the new requirement / the merge: evidence rows, profiles, links, clusters.
    const net = await network.onSignalsApplied({ projectId, items: applied, actor: user.email, triggerReqId: requirementId });
    result.networkUpdated = net.updated === true;
    result.networkLedgerEntry = await latestNetworkEntry(projectId, claimed.decidedAt);
  }

  // Feedback for the detector: what it saw and what the PM decided.
  const first = claimed.evidence[0];
  await Feedback.create({
    kind: 'requirement-candidate', projectId, candidateId, signalId: first?.signalId ?? null, text: first?.text ?? claimed.description,
    source: first?.source, authorRole: first?.authorRole, action, reviewerId: user.email, signalSeeded: false,
    candidate: {
      title: claimed.title, type: claimed.type, closestRequirementId: claimed.closestRequirementId, closestSimilarity: claimed.closestSimilarity,
      novelTokens: claimed.novelTokens, evidenceCount: claimed.evidence.length, createdRequirementId: action === 'approve' ? requirementId : null,
      mergedInto: action === 'merge' ? requirementId : null, priority: body.priority ?? null, note: note ?? null,
      edited: action === 'approve' ? { title: claimed.title !== cand.title, description: claimed.description !== cand.description, type: claimed.type !== cand.type } : undefined,
    },
  });

  result.candidate = toApi(await RequirementCandidate.findOne({ projectId, candidateId }).lean());
  if (action === 'approve') result.requirement = await requirements.getOne(projectId, requirementId); // after the network update (cluster)
  result.message = action === 'approve'
    ? `Requirement ${requirementId} was created. The alignment score will drop until you freeze a new baseline.`
    : action === 'merge' ? `The evidence was mapped to ${requirementId}.` : 'Candidate rejected. Nothing else changed.';
  return result;
}

module.exports = { list, review, toApi };
