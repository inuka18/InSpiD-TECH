'use strict';
const AppError = require('../../shared/AppError');
const aiClient = require('../../shared/aiClient');
const config = require('../../config/env');
const { Requirement, StatusHistory } = require('../requirements/model');
const ledger = require('../ledger/service');
const { Signal, Feedback, CLASSIFICATIONS } = require('./model');
const { proposeStatus } = require('./statusEngine');
const { decideReview, toConfidencePct } = require('./reviewPolicy');

// Seeded = loaded by the seed. Rows seeded before the `seeded` flag existed are recognised by their dataset `split`.
const isSeeded = (s) => s.seeded === true || Boolean(s.split);

// Shape follows the frontend mockSignals rows. The dataset has no names, so "author" is the role.
const toApi = (s) => ({
  id: s.signalId,
  projectId: s.projectId,
  reviewStatus: s.reviewStatus,
  source: s.source,
  channel: s.source,
  author: s.authorRole,
  timestamp: s.timestamp,
  text: s.text,
  classification: s.label ?? null,
  confidence: s.confidence ?? null,
  mappedRequirementId: s.reqId ?? null,
  split: s.split,
  batch: s.batch,
  // fields added by the classification / review flow
  seeded: isSeeded(s),
  modelVersion: s.modelVersion ?? null,
  autoAcceptThreshold: s.autoAcceptThreshold ?? null,
  autoApplyMinSimilarity: s.autoApplyMinSimilarity ?? null,
  matchSimilarity: s.matchSimilarity ?? null,
  proposedStatus: s.proposedStatus ?? null,
  applied: s.applied === true,
  reviewAction: s.reviewAction ?? null,
  statusNotReversed: s.statusNotReversed === true,
});

// Newest first, like a live feed.
async function list(projectId, { reviewStatus, requirementId } = {}) {
  const q = { projectId };
  if (reviewStatus) q.reviewStatus = reviewStatus;
  if (requirementId) q.reqId = requirementId;
  return (await Signal.find(q).sort({ timestamp: -1 }).lean()).map(toApi);
}

async function getOne(projectId, signalId) {
  const s = await Signal.findOne({ projectId, signalId }).lean();
  if (!s) throw new AppError(404, 'NOT_FOUND', `Signal ${signalId} not found`);
  return toApi(s);
}

// ---------------------------------------------------------------- ids (SC-0001, SH-0001, ...)
async function nextSeq(Model, field, prefix) {
  const last = await Model.findOne({}, { [field]: 1 }).sort({ [field]: -1 }).collation({ locale: 'en', numericOrdering: true }).lean();
  const n = last ? Number(String(last[field]).replace(/\D/g, '')) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

async function createWithSeqId(Model, field, prefix, build) {
  for (let i = 0; i < 5; i += 1) {
    try {
      return await Model.create(build(await nextSeq(Model, field, prefix)));
    } catch (err) {
      if (err.code !== 11000) throw err; // id taken by a concurrent request: take the next one
    }
  }
  throw new AppError(409, 'ID_BUSY', 'Could not allocate an id (concurrent writes); try again');
}

// ------------------------------------------------------------ classify + map + decide (no writes)
async function analyze(projectId, body) {
  const threshold = config.autoAcceptConfidence;
  const a = { threshold, label: null, confidence: null, modelVersion: null, requirement: null, match: null, engine: null, degraded: false, message: null };

  let ai;
  try {
    ai = await aiClient.classify(body.text);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    a.degraded = true;
    a.aiDown = true;
    a.message = `The classifier is unavailable (${err.message}). The signal was stored as unclassified and pending; nothing was applied. A PM can resolve it with a correction.`;
    a.policy = decideReview({ label: null, threshold });
    return a;
  }
  a.label = CLASSIFICATIONS.includes(ai.label) ? ai.label : null;
  a.confidence = toConfidencePct(ai.confidence);
  a.modelVersion = ai.model_version ?? null;

  if (a.label && a.label !== 'None') {
    if (body.requirementId) {
      a.requirement = await Requirement.findOne({ projectId, reqId: body.requirementId }).lean();
      if (!a.requirement) throw new AppError(404, 'NOT_FOUND', `Requirement ${body.requirementId} not found in this project`);
      a.match = { requirementId: a.requirement.reqId, similarity: null, method: 'manual', alternatives: [] };
    } else {
      const reqs = await Requirement.find({ projectId }).sort({ reqId: 1 }).lean();
      if (reqs.length) {
        try {
          const ranked = await aiClient.match(body.text, reqs.map((r) => ({ id: r.reqId, text: `${r.title}. ${r.description || ''}`.trim() })), 3);
          const alternatives = ranked.slice(0, 3).map((m) => ({ requirementId: m.id, similarity: m.similarity }));
          const top = alternatives[0];
          const ok = top && top.similarity >= config.matchMinSimilarity;
          a.match = { requirementId: ok ? top.requirementId : null, similarity: top ? top.similarity : null, method: 'auto', alternatives };
          if (ok) a.requirement = reqs.find((r) => r.reqId === top.requirementId);
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          a.degraded = true;
          a.message = `Requirement matching is unavailable (${err.message}). The signal was stored unmapped and pending; nothing was applied.`;
        }
      }
    }
    if (a.requirement) a.engine = proposeStatus({ label: a.label, text: body.text, currentStatus: a.requirement.liveStatus });
  }
  a.policy = decideReview({
    label: a.label, confidence: a.confidence, matched: !!a.requirement, dropProposed: a.engine?.dropProposed ?? false, threshold,
    matchMethod: a.match?.method, similarity: a.match?.similarity, autoApplyMinSimilarity: config.autoApplyMinSimilarity,
  });
  return a;
}

function answer(a, { signal = null, applied = false, statusChange = null, ledgerEntry = null, preview = false, wouldApply = undefined } = {}) {
  return {
    signal,
    classification: { label: a.label, confidence: a.confidence, modelVersion: a.modelVersion },
    match: a.match,
    proposedStatus: a.engine?.proposedStatus ?? null,
    applied,
    ...(preview ? { wouldApply } : {}),
    reviewStatus: a.policy.reviewStatus,
    reviewReason: a.policy.reason,
    autoAcceptThreshold: a.threshold,
    matchMinSimilarity: config.matchMinSimilarity,
    autoApplyMinSimilarity: config.autoApplyMinSimilarity,
    statusChange,
    ledgerEntry,
    message: a.message,
    preview,
    degraded: a.degraded,
  };
}

// Same answer as create(), but nothing is saved or applied.
async function preview(projectId, body) {
  const a = await analyze(projectId, body);
  if (a.aiDown) throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', a.message);
  const wouldApply = a.policy.autoAccepted && a.label !== 'None' && !!a.requirement;
  return answer(a, {
    preview: true,
    wouldApply,
    statusChange: wouldApply && a.engine.changed ? { from: a.requirement.liveStatus, to: a.engine.proposedStatus } : null,
  });
}

// ---------------------------------------------------------------- applying a status change
// No multi-document transactions on standalone Mongo, so the order is: conditional requirement update ->
// status_history -> ledger. The conditional update (liveStatus must still be `from`) stops two concurrent
// signals from both applying.
async function applyToRequirement({ projectId, reqId, signal, label, actor }) {
  const current = await Requirement.findOne({ projectId, reqId }).lean();
  if (!current) throw new AppError(404, 'NOT_FOUND', `Requirement ${reqId} not found in this project`);
  const eng = proposeStatus({ label, text: signal.text, currentStatus: current.liveStatus });
  const from = current.liveStatus;
  const to = eng.proposedStatus ?? from;
  if (eng.changed) {
    const updated = await Requirement.findOneAndUpdate({ projectId, reqId, liveStatus: from }, { $set: { liveStatus: to } }, { new: true }).lean();
    if (!updated) throw new AppError(409, 'CONCURRENT_UPDATE', `Requirement ${reqId} changed status while this signal was processed`);
  }
  await createWithSeqId(StatusHistory, 'historyId', 'SH-', (historyId) => ({
    projectId, historyId, reqId, signalId: signal.signalId, timestamp: signal.timestamp, label, fromStatus: from, toStatus: to,
    statusChanged: eng.changed, source: signal.source, authorRole: signal.authorRole,
    resourceRole: signal.authorRole, granularity: current.granularity,
  }));
  let ledgerEntry = null;
  if (eng.changed) {
    ledgerEntry = await ledger.appendLedgerEntry({
      projectId, eventType: 'STATUS_CHANGE', reqId, requirementTitle: current.title, previousStatus: from, newStatus: to,
      triggeringSignal: signal.text, triggeringSignalId: signal.signalId, actor,
    });
  }
  return { statusChange: eng.changed ? { from, to } : null, ledgerEntry, proposedStatus: eng.proposedStatus, resultingStatus: to };
}

// ---------------------------------------------------------------- POST /signals
async function create(projectId, body, user) {
  const a = await analyze(projectId, body);
  const auto = a.policy.autoAccepted;
  const signal = await createWithSeqId(Signal, 'signalId', 'SC-', (signalId) => ({
    projectId, signalId, source: body.source, authorRole: body.authorRole || user.jobTitle || 'Unspecified',
    text: body.text, timestamp: body.timestamp || new Date(), label: a.label, modelLabel: a.label,
    modelVersion: a.modelVersion, confidence: a.confidence, autoAcceptThreshold: a.threshold, autoApplyMinSimilarity: config.autoApplyMinSimilarity,
    reqId: a.requirement?.reqId ?? null, matchMethod: a.match?.method ?? null, matchSimilarity: a.match?.similarity ?? null,
    matchAlternatives: a.match?.alternatives ?? [], proposedStatus: a.engine?.proposedStatus ?? null,
    reviewStatus: auto ? 'accepted' : 'pending', seeded: false,
  }));

  let applied = false;
  let statusChange = null;
  let ledgerEntry = null;
  let finalReview = a.policy;
  if (auto && a.label !== 'None' && a.requirement) {
    try {
      const r = await applyToRequirement({ projectId, reqId: a.requirement.reqId, signal: signal.toObject(), label: a.label, actor: 'auto-accept' });
      ({ statusChange, ledgerEntry } = r);
      applied = true;
      await Signal.updateOne({ _id: signal._id }, { $set: { applied: true, resultingStatus: r.resultingStatus } });
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'CONCURRENT_UPDATE') throw err;
      await Signal.updateOne({ _id: signal._id }, { $set: { reviewStatus: 'pending' } }); // let a PM decide
      finalReview = { reviewStatus: 'pending', autoAccepted: false, reason: 'concurrent-update' };
      a.message = err.message + '. The signal was left pending for a PM.';
    }
  }
  a.policy = finalReview;
  const stored = await Signal.findById(signal._id).lean();
  return answer(a, { signal: toApi(stored), applied, statusChange, ledgerEntry });
}

// ---------------------------------------------------------------- PM review (+ feedback)
async function review(projectId, signalId, body, user) {
  const { action, correctedLabel, correctedRequirementId, note } = body;
  const s = await Signal.findOne({ projectId, signalId }).lean();
  if (!s) throw new AppError(404, 'NOT_FOUND', `Signal ${signalId} not found`);

  // pending -> normal review. An API-created signal that was AUTO-accepted can still be rejected/corrected,
  // but only as feedback: the status change and ledger entry it caused are NOT reversed.
  const seeded = isSeeded(s);
  const pending = s.reviewStatus === 'pending';
  const feedbackOnly = !pending && !seeded && s.reviewStatus === 'accepted' && !s.reviewedBy && action !== 'accept';
  if (!pending && !feedbackOnly) {
    throw new AppError(409, 'ALREADY_REVIEWED', s.reviewStatus === 'accepted' && !s.reviewedBy && !seeded
      ? 'Signal was already auto-accepted (reject or correct it to give feedback)' : 'Signal is not pending');
  }

  // Work out the final label / requirement before writing anything.
  let finalLabel = null;
  let finalReq = s.reqId ?? null;
  if (action === 'accept') {
    finalLabel = s.label;
    if (!finalLabel) throw new AppError(422, 'NEEDS_CORRECTION', 'This signal was never classified; use action "correct" with correctedLabel');
  } else if (action === 'correct') {
    finalLabel = correctedLabel ?? s.label;
    if (!finalLabel) throw new AppError(422, 'NEEDS_CORRECTION', 'This signal has no label; correctedLabel is required');
    finalReq = correctedRequirementId ?? s.reqId ?? null;
  }
  if (finalLabel === 'None') finalReq = null;
  const mustMap = finalLabel && finalLabel !== 'None' && !seeded;
  if (mustMap && !finalReq && !feedbackOnly) {
    throw new AppError(422, 'NEEDS_REQUIREMENT', 'This signal is not mapped to a requirement; use action "correct" with correctedRequirementId');
  }
  if (correctedRequirementId && !(await Requirement.exists({ projectId, reqId: correctedRequirementId }))) {
    throw new AppError(404, 'NOT_FOUND', `Requirement ${correctedRequirementId} not found in this project`);
  }

  // Claim the signal atomically (so two PMs cannot apply it twice).
  const claim = pending
    ? { projectId, signalId, reviewStatus: 'pending' }
    : { projectId, signalId, reviewStatus: 'accepted', reviewedBy: null, seeded: { $ne: true }, split: { $exists: false } };
  const set = {
    reviewStatus: action === 'reject' ? 'rejected' : 'accepted', reviewedBy: user.email, reviewedAt: new Date(),
    reviewAction: action, reviewNote: note ?? null,
  };
  if (action === 'correct') Object.assign(set, { label: finalLabel, reqId: finalReq });
  if (feedbackOnly) set.statusNotReversed = s.applied === true;
  const claimed = await Signal.findOneAndUpdate(claim, { $set: set }, { new: true }).lean();
  if (!claimed) throw new AppError(409, 'ALREADY_REVIEWED', 'Signal was reviewed by someone else just now');

  // Apply the status rule: only for pending, API-created signals that end up with a label other than None.
  let statusChange = null;
  let ledgerEntry = null;
  let latest = claimed;
  if (pending && !seeded && action !== 'reject' && finalLabel !== 'None') {
    try {
      const r = await applyToRequirement({ projectId, reqId: finalReq, signal: claimed, label: finalLabel, actor: user.email });
      ({ statusChange, ledgerEntry } = r);
      latest = await Signal.findOneAndUpdate({ _id: claimed._id }, { $set: { applied: true, resultingStatus: r.resultingStatus, proposedStatus: r.proposedStatus } }, { new: true }).lean();
    } catch (err) {
      await Signal.updateOne({ _id: claimed._id }, { $set: { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null, reviewAction: null, label: s.label, reqId: s.reqId ?? null } });
      throw err; // the signal is pending again
    }
  }

  await Feedback.create({
    projectId, signalId, text: s.text, source: s.source, authorRole: s.authorRole, modelLabel: s.modelLabel ?? s.label ?? null,
    modelVersion: s.modelVersion ?? null, modelConfidence: s.confidence ?? null, finalLabel: action === 'reject' ? null : finalLabel,
    action, reviewerId: user.email, signalSeeded: seeded,
  });

  const notReversed = feedbackOnly && s.applied === true;
  return {
    signal: toApi(latest),
    action,
    statusChange,
    ledgerEntry,
    statusNotReversed: notReversed,
    message: notReversed
      ? 'Feedback recorded. This signal had already been auto-accepted and applied: its status change and ledger entry were NOT reversed (statusNotReversed: true). A compensating correction is a manual step for now.'
      : feedbackOnly ? 'Feedback recorded (the signal was auto-accepted; nothing had been applied, so nothing needs reversing).'
        : seeded ? 'Review recorded. Seeded signals are already reflected in the data, so no status change was made.'
          : statusChange ? 'Review recorded and the status change was applied.' : 'Review recorded.',
  };
}

// ---------------------------------------------------------------- feedback export (retraining data)
const csvCell = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const normText = (t) => String(t).toLowerCase().split(/\s+/).filter(Boolean).join(' ');

// Columns text,label,source,role: the format `training.train --extra-data` expects. Accept/correct rows only,
// de-duplicated by text (the latest decision wins). Seeded signals are dataset text and are left out.
async function exportFeedbackCsv(projectId) {
  const rows = await Feedback.find({ projectId, action: { $in: ['accept', 'correct'] }, finalLabel: { $ne: null }, signalSeeded: { $ne: true } })
    .sort({ createdAt: 1, _id: 1 }).lean();
  const latest = new Map();
  for (const r of rows) latest.set(normText(r.text), r);
  const lines = ['text,label,source,role', ...[...latest.values()].map((r) => [r.text, r.finalLabel, r.source ?? '', r.authorRole ?? ''].map(csvCell).join(','))];
  return lines.join('\n') + '\n';
}

module.exports = { list, getOne, create, preview, review, exportFeedbackCsv, toApi };
