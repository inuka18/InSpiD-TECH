'use strict';
const crypto = require('crypto');
const AppError = require('../../shared/AppError');
const aiClient = require('../../shared/aiClient');
const config = require('../../config/env');
const { Requirement } = require('../requirements/model');
const { Signal, Feedback, CLASSIFICATIONS } = require('./model');
const { proposeStatus } = require('./statusEngine');
const { decideReview, toConfidencePct } = require('./reviewPolicy');
const { createWithSeqId } = require('./ids');
const { finalizeSignal } = require('./finalize');
const { segmentDocument, SegmentLimitError } = require('./segmentation');
const { extractTextFromFile } = require('./documentText');

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
  sourceDocument: s.sourceDocument?.id ? { id: s.sourceDocument.id, name: s.sourceDocument.name ?? null } : null,
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

// ------------------------------------------------------------ classify + map + decide (no writes)
const candidatesOf = (reqs) => reqs.map((r) => ({ id: r.reqId, text: `${r.title}. ${r.description || ''}`.trim() }));

// Ranked matches from the ai-service -> { match, requirement }. A match below MATCH_MIN_SIMILARITY proposes no requirement.
function rankedToMatch(ranked, reqs) {
  const alternatives = ranked.slice(0, 3).map((m) => ({ requirementId: m.id, similarity: m.similarity }));
  const top = alternatives[0];
  const ok = Boolean(top) && top.similarity >= config.matchMinSimilarity;
  return {
    match: { requirementId: ok ? top.requirementId : null, similarity: top ? top.similarity : null, method: 'auto', alternatives },
    requirement: ok ? reqs.find((r) => r.reqId === top.requirementId) ?? null : null,
  };
}

/**
 * THE shared decision step (mapping thresholds -> status engine -> review policy). Preview, create, extract and bulk
 * all call this one function, so the rules live in exactly one place.
 * @param {object} p  text, ai { label, confidence (0-1), model_version }, requirement (lean doc or null), match, degraded, message
 */
function decideAnalysis({ text, ai, requirement = null, match = null, degraded = false, message = null }) {
  const threshold = config.autoAcceptConfidence;
  const a = {
    threshold, label: CLASSIFICATIONS.includes(ai?.label) ? ai.label : null, confidence: ai ? toConfidencePct(ai.confidence) : null,
    modelVersion: ai?.model_version ?? null, requirement, match, engine: null, degraded, message,
  };
  if (a.label && a.label !== 'None' && requirement) {
    a.engine = proposeStatus({ label: a.label, text, currentStatus: requirement.liveStatus });
  }
  a.policy = decideReview({
    label: a.label, confidence: a.confidence, matched: !!requirement, dropProposed: a.engine?.dropProposed ?? false, threshold,
    matchMethod: match?.method, similarity: match?.similarity, autoApplyMinSimilarity: config.autoApplyMinSimilarity,
  });
  return a;
}

// One message: classify, match, decide. (If the ai-service is down the signal degrades to unclassified / unmapped.)
async function analyze(projectId, body) {
  let ai;
  try {
    ai = await aiClient.classify(body.text);
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    const a = decideAnalysis({
      text: body.text, ai: null, degraded: true,
      message: `The classifier is unavailable (${err.message}). The signal was stored as unclassified and pending; nothing was applied. A PM can resolve it with a correction.`,
    });
    a.aiDown = true;
    return a;
  }
  const label = CLASSIFICATIONS.includes(ai.label) ? ai.label : null;
  let requirement = null;
  let match = null;
  let degraded = false;
  let message = null;
  if (label && label !== 'None') {
    if (body.requirementId) {
      requirement = await Requirement.findOne({ projectId, reqId: body.requirementId }).lean();
      if (!requirement) throw new AppError(404, 'NOT_FOUND', `Requirement ${body.requirementId} not found in this project`);
      match = { requirementId: requirement.reqId, similarity: null, method: 'manual', alternatives: [] };
    } else {
      const reqs = await Requirement.find({ projectId }).sort({ reqId: 1 }).lean();
      if (reqs.length) {
        try {
          ({ match, requirement } = rankedToMatch(await aiClient.match(body.text, candidatesOf(reqs), 3), reqs));
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          degraded = true;
          message = `Requirement matching is unavailable (${err.message}). The signal was stored unmapped and pending; nothing was applied.`;
        }
      }
    }
  }
  return decideAnalysis({ text: body.text, ai, requirement, match, degraded, message });
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

// Would this analysis be applied without a PM? (the same condition create() uses)
const wouldAutoApply = (a) => a.policy.autoAccepted && a.label !== 'None' && !!a.requirement;

// Same answer as create(), but nothing is saved or applied.
async function preview(projectId, body) {
  const a = await analyze(projectId, body);
  if (a.aiDown) throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', a.message);
  const would = wouldAutoApply(a);
  const projected = would
    ? await finalizeSignal({ projectId, signal: { text: body.text }, label: a.label, requirementId: a.requirement.reqId, dryRun: true })
    : null;
  return answer(a, { preview: true, wouldApply: would, statusChange: projected?.statusChange ?? null });
}

// ---------------------------------------------------------------- saving a signal (POST /signals, bulk)
// Saves the analysed signal and, when the review policy auto-accepts it, finalises it (status, history, ledger).
async function createFromAnalysis(projectId, body, user, a, { sourceDocument = null } = {}) {
  const auto = a.policy.autoAccepted;
  const signal = await createWithSeqId(Signal, 'signalId', 'SC-', (signalId) => ({
    projectId, signalId, source: body.source, authorRole: body.authorRole || user.jobTitle || 'Unspecified',
    text: body.text, timestamp: body.timestamp || new Date(), label: a.label, modelLabel: a.label,
    modelVersion: a.modelVersion, confidence: a.confidence, autoAcceptThreshold: a.threshold, autoApplyMinSimilarity: config.autoApplyMinSimilarity,
    reqId: a.requirement?.reqId ?? null, matchMethod: a.match?.method ?? null, matchSimilarity: a.match?.similarity ?? null,
    matchAlternatives: a.match?.alternatives ?? [], proposedStatus: a.engine?.proposedStatus ?? null,
    reviewStatus: auto ? 'accepted' : 'pending', seeded: false, sourceDocument,
  }));

  let applied = false;
  let statusChange = null;
  let ledgerEntry = null;
  let finalReview = a.policy;
  if (wouldAutoApply(a)) {
    try {
      const r = await finalizeSignal({ projectId, signal: signal.toObject(), label: a.label, requirementId: a.requirement.reqId, actor: 'auto-accept' });
      ({ applied, statusChange, ledgerEntry } = r);
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'CONCURRENT_UPDATE') throw err;
      await Signal.updateOne({ _id: signal._id }, { $set: { reviewStatus: 'pending' } }); // let a PM decide
      finalReview = { reviewStatus: 'pending', autoAccepted: false, reason: 'concurrent-update' };
      a.message = `${err.message}. The signal was left pending for a PM.`;
    }
  }
  a.policy = finalReview;
  const stored = await Signal.findById(signal._id).lean();
  return answer(a, { signal: toApi(stored), applied, statusChange, ledgerEntry });
}

async function create(projectId, body, user) {
  return createFromAnalysis(projectId, body, user, await analyze(projectId, body));
}

// ---------------------------------------------------------------- documents: extract (saves nothing) and bulk
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// input: { file: { buffer, originalname } } or { text, name }; also source / authorRole / documentDate (echoed, not used here)
async function extract(projectId, input) {
  const name = input.file?.originalname || input.name || 'Pasted text';
  const text = input.file ? await extractTextFromFile(input.file) : String(input.text ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new AppError(422, 'EMPTY_DOCUMENT', 'No text was found');

  let segments;
  try {
    segments = segmentDocument(text);
  } catch (err) {
    if (err instanceof SegmentLimitError) throw new AppError(413, 'TOO_MANY_SEGMENTS', err.message, { segments: err.count, limit: err.max });
    throw err;
  }
  const documentId = sha256(text.trim());
  const alreadySubmitted = Boolean(await Signal.exists({ projectId, 'sourceDocument.id': documentId }));
  const base = {
    documentId, name, source: input.source || 'Standup', alreadySubmitted,
    autoAcceptThreshold: config.autoAcceptConfidence, matchMinSimilarity: config.matchMinSimilarity, autoApplyMinSimilarity: config.autoApplyMinSimilarity,
  };
  if (!segments.length) {
    return { ...base, modelVersion: null, segments: [], counts: { total: 0, signals: 0, none: 0 } };
  }

  // One classification call for all segments, one matching call for the non-None ones (both 502 if the ai-service is down).
  const classified = await aiClient.classifyBatch(segments.map((s) => s.text));
  const reqs = await Requirement.find({ projectId }).sort({ reqId: 1 }).lean();
  const signalIdx = segments.map((_, i) => i).filter((i) => CLASSIFICATIONS.includes(classified[i].label) && classified[i].label !== 'None');
  const ranked = new Map();
  if (signalIdx.length && reqs.length) {
    const lists = await aiClient.matchBatch(signalIdx.map((i) => segments[i].text), candidatesOf(reqs), 3);
    signalIdx.forEach((i, k) => ranked.set(i, lists[k] ?? []));
  }

  const out = segments.map((seg, i) => {
    const ai = classified[i];
    const isSignal = signalIdx.includes(i);
    const { match, requirement } = isSignal && ranked.has(i) ? rankedToMatch(ranked.get(i), reqs) : { match: null, requirement: null };
    const a = decideAnalysis({ text: seg.text, ai, requirement, match });
    return {
      index: seg.index, line: seg.line, text: seg.text, speakerLabel: seg.speakerLabel,
      label: a.label, confidence: a.confidence,
      match: match && { requirementId: match.requirementId, similarity: match.similarity, alternatives: match.alternatives },
      proposedStatus: a.engine?.proposedStatus ?? null,
      wouldAutoApply: wouldAutoApply(a),
      reviewReason: a.policy.reason,
    };
  });
  return {
    ...base,
    modelVersion: classified[0]?.model_version ?? null,
    segments: out,
    counts: { total: out.length, signals: signalIdx.length, none: out.length - signalIdx.length },
  };
}

const classOf = (r) => (r.reviewStatus === 'pending' ? 'pending' : r.applied && r.statusChange ? 'applied' : 'noChange');

// items: [{ text, requirementId? }] saved in order through the normal create flow. Classification and matching are done for the
// whole batch first (nothing is saved if the ai-service is down); every item is then decided and finalised one after the other,
// so an earlier item's status change is seen by the later ones.
async function bulk(projectId, body, user) {
  const { documentId, name, source, authorRole, timestamp, items, force } = body;
  if (!force && (await Signal.exists({ projectId, 'sourceDocument.id': documentId }))) {
    throw new AppError(409, 'DOCUMENT_ALREADY_SUBMITTED', 'This document was already submitted to this project. Send force: true to submit it again.');
  }

  const classified = await aiClient.classifyBatch(items.map((it) => it.text)); // throws 502 before anything is saved
  const reqs = await Requirement.find({ projectId }).sort({ reqId: 1 }).lean();
  const needMatch = items.map((it, i) => i).filter((i) => !items[i].requirementId && classified[i].label !== 'None' && CLASSIFICATIONS.includes(classified[i].label));
  const ranked = new Map();
  if (needMatch.length && reqs.length) {
    const lists = await aiClient.matchBatch(needMatch.map((i) => items[i].text), candidatesOf(reqs), 3);
    needMatch.forEach((i, k) => ranked.set(i, lists[k] ?? []));
  }

  const sourceDocument = { id: documentId, name };
  const results = [];
  const summary = { applied: 0, pending: 0, noChange: 0, failed: 0 };
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    try {
      const ai = classified[i];
      const label = CLASSIFICATIONS.includes(ai.label) ? ai.label : null;
      let requirement = null;
      let match = null;
      if (label && label !== 'None') {
        if (it.requirementId) {
          requirement = await Requirement.findOne({ projectId, reqId: it.requirementId }).lean();
          if (!requirement) throw new AppError(404, 'NOT_FOUND', `Requirement ${it.requirementId} not found in this project`);
          match = { requirementId: requirement.reqId, similarity: null, method: 'manual', alternatives: [] };
        } else if (ranked.has(i)) {
          ({ match, requirement } = rankedToMatch(ranked.get(i), reqs));
          // the status may have changed because of an earlier item of this document: read it fresh
          if (requirement) requirement = await Requirement.findOne({ projectId, reqId: requirement.reqId }).lean();
        }
      }
      const a = decideAnalysis({ text: it.text, ai, requirement, match });
      const res = await createFromAnalysis(projectId, { text: it.text, source, authorRole, timestamp }, user, a, { sourceDocument });
      const status = classOf(res);
      summary[status] += 1;
      results.push({
        index: i, text: it.text, status, signalId: res.signal.id, label: res.classification.label, confidence: res.classification.confidence,
        requirementId: res.match?.requirementId ?? null, reviewStatus: res.reviewStatus, reviewReason: res.reviewReason,
        statusChange: res.statusChange, message: res.message,
      });
    } catch (err) {
      summary.failed += 1;
      results.push({ index: i, text: it.text, status: 'failed', error: err instanceof AppError ? err.message : 'Could not save this item' });
    }
  }
  return { documentId, name, results, summary };
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

  // The status effect applies only to pending, API-created signals that end up with a label other than None; the feedback
  // document is written by the same finalize call, after the effect.
  const effect = pending && !seeded && action !== 'reject' && finalLabel !== 'None';
  let fin = { statusChange: null, ledgerEntry: null };
  try {
    fin = await finalizeSignal({
      projectId, signal: claimed, label: effect ? finalLabel : null, requirementId: effect ? finalReq : null, actor: user.email,
      feedback: {
        projectId, signalId, text: s.text, source: s.source, authorRole: s.authorRole, modelLabel: s.modelLabel ?? s.label ?? null,
        modelVersion: s.modelVersion ?? null, modelConfidence: s.confidence ?? null, finalLabel: action === 'reject' ? null : finalLabel,
        action, reviewerId: user.email, signalSeeded: seeded,
      },
    });
  } catch (err) {
    await Signal.updateOne({ _id: claimed._id }, { $set: { reviewStatus: 'pending', reviewedBy: null, reviewedAt: null, reviewAction: null, label: s.label, reqId: s.reqId ?? null } });
    throw err; // the signal is pending again
  }
  const latest = await Signal.findById(claimed._id).lean();

  const notReversed = feedbackOnly && s.applied === true;
  return {
    signal: toApi(latest),
    action,
    statusChange: fin.statusChange,
    ledgerEntry: fin.ledgerEntry,
    statusNotReversed: notReversed,
    message: notReversed
      ? 'Feedback recorded. This signal had already been auto-accepted and applied: its status change and ledger entry were NOT reversed (statusNotReversed: true). A compensating correction is a manual step for now.'
      : feedbackOnly ? 'Feedback recorded (the signal was auto-accepted; nothing had been applied, so nothing needs reversing).'
        : seeded ? 'Review recorded. Seeded signals are already reflected in the data, so no status change was made.'
          : fin.statusChange ? 'Review recorded and the status change was applied.' : 'Review recorded.',
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
  return `${lines.join('\n')}\n`;
}

module.exports = { list, getOne, create, preview, extract, bulk, review, exportFeedbackCsv, toApi };
