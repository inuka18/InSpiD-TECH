'use strict';
const crypto = require('crypto');
const AppError = require('../../shared/AppError');
const { Requirement } = require('../requirements/model');
const ledger = require('../ledger/service');
const { RequirementLink, ManualLink } = require('./model');

const manualToApi = (l) => ({
  id: l.linkId,
  projectId: l.projectId,
  source: l.sourceId,
  target: l.targetId,
  kind: 'manual',
  reason: l.reason,
  createdBy: l.createdBy,
  createdAt: l.createdAt,
});

// Nodes = requirements, links = automatic pairs + manual links.
// TODO (network component): Pathfinder-style pruning, cluster layout and similarity-based
// links via aiClient.similarity(). For now the automatic links are the CSV pairs as loaded.
async function getNetwork(projectId) {
  const [reqs, auto, manual] = await Promise.all([
    Requirement.find({ projectId }).sort({ reqId: 1 }).lean(),
    RequirementLink.find({ projectId }).lean(),
    ManualLink.find({ projectId }).sort({ createdAt: 1 }).lean(),
  ]);
  return {
    projectId,
    nodes: reqs.map((r) => ({
      id: r.reqId, title: r.title, liveStatus: r.liveStatus, cluster: r.groupId, type: r.type, resourceRole: r.resourceRole,
    })),
    links: [
      ...auto.map((l) => ({ id: `${l.reqA}~${l.reqB}~${l.relationType}`, source: l.reqA, target: l.reqB, kind: 'auto', relationType: l.relationType })),
      ...manual.map(manualToApi),
    ],
  };
}

const listManualLinks = async (projectId) => (await ManualLink.find({ projectId }).sort({ createdAt: 1 }).lean()).map(manualToApi);

async function addManualLink(projectId, { sourceId, targetId, reason }, user) {
  if (sourceId === targetId) throw new AppError(400, 'BAD_REQUEST', 'A requirement cannot link to itself');
  const reqs = await Requirement.find({ projectId, reqId: { $in: [sourceId, targetId] } }).lean();
  if (reqs.length !== 2) throw new AppError(404, 'NOT_FOUND', 'Both requirements must exist in this project');
  const dup = await ManualLink.exists({
    projectId,
    $or: [{ sourceId, targetId }, { sourceId: targetId, targetId: sourceId }],
  });
  if (dup) throw new AppError(409, 'DUPLICATE', 'These requirements are already manually linked');

  const link = await ManualLink.create({ projectId, linkId: `manual-link-${crypto.randomUUID()}`, sourceId, targetId, reason, createdBy: user.email });
  const title = (id) => reqs.find((r) => r.reqId === id).title;
  await ledger.appendPlaceholderEntry({
    projectId, eventType: 'Manual Link Added', reqId: sourceId, requirementTitle: title(sourceId),
    relatedReqId: targetId, relatedRequirementTitle: title(targetId), triggeringSignal: reason, actor: user.email,
  });
  return manualToApi(link.toObject());
}

async function removeManualLink(projectId, linkId, user) {
  const link = await ManualLink.findOneAndDelete({ projectId, linkId }).lean();
  if (!link) throw new AppError(404, 'NOT_FOUND', 'Manual link not found');
  const reqs = await Requirement.find({ projectId, reqId: { $in: [link.sourceId, link.targetId] } }).lean();
  const title = (id) => reqs.find((r) => r.reqId === id)?.title ?? null;
  await ledger.appendPlaceholderEntry({
    projectId, eventType: 'Manual Link Removed', reqId: link.sourceId, requirementTitle: title(link.sourceId),
    relatedReqId: link.targetId, relatedRequirementTitle: title(link.targetId), triggeringSignal: link.reason, actor: user.email,
  });
  return { removed: linkId };
}

module.exports = { getNetwork, listManualLinks, addManualLink, removeManualLink };
