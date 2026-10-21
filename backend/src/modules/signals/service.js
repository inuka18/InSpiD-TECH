'use strict';
const AppError = require('../../shared/AppError');
const aiClient = require('../../shared/aiClient');
const { Signal, CLASSIFICATIONS } = require('./model');

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
  classification: s.label,
  confidence: s.confidence,
  mappedRequirementId: s.reqId,
  split: s.split,
  batch: s.batch,
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

async function nextSignalId() {
  const last = await Signal.findOne({}, { signalId: 1 }).sort({ signalId: -1 }).lean();
  const n = last ? Number(last.signalId.replace(/\D/g, '')) + 1 : 1;
  return `SC-${String(n).padStart(4, '0')}`;
}

// Ingest a new message. Classification goes through the AI service (placeholder for now).
// TODO: map the signal to a requirement (aiClient.similarity) and run the status engine on accept.
async function create(projectId, body) {
  const ai = await aiClient.classify(body.text);
  const label = CLASSIFICATIONS.includes(ai.label) ? ai.label : 'None';
  const s = await Signal.create({
    projectId, signalId: await nextSignalId(), source: body.source, authorRole: body.authorRole,
    text: body.text, timestamp: body.timestamp || new Date(), label,
    confidence: ai.confidence ?? null, reviewStatus: 'pending',
  });
  return toApi(s.toObject());
}

// PM accepts or rejects a pending signal.
// TODO (status engine): on accept, apply the status rules for the mapped requirement.
async function review(projectId, signalId, decision, user) {
  const s = await Signal.findOneAndUpdate(
    { projectId, signalId, reviewStatus: 'pending' },
    { $set: { reviewStatus: decision === 'accept' ? 'accepted' : 'rejected', reviewedBy: user.email, reviewedAt: new Date() } },
    { new: true }
  ).lean();
  if (s) return toApi(s);
  const existing = await Signal.exists({ projectId, signalId });
  throw existing ? new AppError(409, 'ALREADY_REVIEWED', 'Signal is not pending') : new AppError(404, 'NOT_FOUND', `Signal ${signalId} not found`);
}

module.exports = { list, getOne, create, review };
