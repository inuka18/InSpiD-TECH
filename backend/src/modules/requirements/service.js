'use strict';
const AppError = require('../../shared/AppError');
const { Signal } = require('../signals/model');
const { RequirementLink } = require('../network/model');
const ledger = require('../ledger/service');
const { Requirement, StatusHistory } = require('./model');

// Shape follows the frontend mockRequirements rows.
function toApi(r, relatedIds = [], statusHistory = []) {
  return {
    id: r.reqId,
    projectId: r.projectId,
    title: r.title,
    description: r.description,
    liveStatus: r.liveStatus,
    resourceRole: r.resourceRole,
    granularity: r.granularity,
    cluster: r.groupId,
    type: r.type,
    relatedIds,
    statusHistory,
  };
}

// Loads related ids + status history for the given requirements in 3 queries.
async function hydrate(projectId, reqs) {
  const ids = reqs.map((r) => r.reqId);
  const [links, history] = await Promise.all([
    RequirementLink.find({ projectId, $or: [{ reqA: { $in: ids } }, { reqB: { $in: ids } }] }).lean(),
    StatusHistory.find({ projectId, reqId: { $in: ids }, statusChanged: true }).sort({ timestamp: 1 }).lean(),
  ]);
  const signals = await Signal.find({ projectId, signalId: { $in: history.map((h) => h.signalId) } }, { signalId: 1, text: 1 }).lean();
  const textOf = new Map(signals.map((s) => [s.signalId, s.text]));

  const related = new Map(ids.map((id) => [id, new Set()]));
  for (const l of links) {
    related.get(l.reqA)?.add(l.reqB);
    related.get(l.reqB)?.add(l.reqA);
  }
  const hist = new Map(ids.map((id) => [id, []]));
  for (const h of history) {
    hist.get(h.reqId).push({ status: h.toStatus, timestamp: h.timestamp, signal: textOf.get(h.signalId) ?? null, signalId: h.signalId });
  }
  return reqs.map((r) => toApi(r, [...related.get(r.reqId)].sort(), hist.get(r.reqId)));
}

async function list(projectId) {
  return hydrate(projectId, await Requirement.find({ projectId }).sort({ reqId: 1 }).lean());
}

async function getOne(projectId, reqId) {
  const r = await Requirement.findOne({ projectId, reqId }).lean();
  if (!r) throw new AppError(404, 'NOT_FOUND', `Requirement ${reqId} not found`);
  return (await hydrate(projectId, [r]))[0];
}

async function clusters(projectId) {
  const groups = await Requirement.distinct('groupId', { projectId });
  return groups.filter(Boolean).sort().map((g) => ({ id: g, label: g }));
}

async function nextReqId(projectId) {
  const all = await Requirement.find({ projectId }, { reqId: 1 }).lean();
  let prefix = `${projectId.replace(/^SYS-/, '')}-R`;
  let max = 0;
  for (const { reqId } of all) {
    const m = /^(.*-R)(\d+)$/.exec(reqId);
    if (m) { prefix = m[1]; max = Math.max(max, Number(m[2])); }
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

async function create(projectId, body, user) {
  const { cluster, ...rest } = body;
  const doc = await Requirement.create({
    ...rest, projectId, reqId: await nextReqId(projectId), groupId: cluster || '',
    initialStatus: 'Confirmed', finalStatus: 'Confirmed', liveStatus: 'Confirmed', resourceRole: body.resourceRole || 'Unassigned',
  });
  await ledger.appendPlaceholderEntry({
    projectId, eventType: 'Requirement Created', reqId: doc.reqId, requirementTitle: doc.title,
    previousStatus: null, newStatus: 'Confirmed', actor: user.email,
  });
  return toApi(doc.toObject());
}

async function update(projectId, reqId, body) {
  const { cluster, ...rest } = body;
  const set = { ...rest, ...(cluster !== undefined ? { groupId: cluster } : {}) };
  const r = await Requirement.findOneAndUpdate({ projectId, reqId }, { $set: set }, { new: true }).lean();
  if (!r) throw new AppError(404, 'NOT_FOUND', `Requirement ${reqId} not found`);
  return (await hydrate(projectId, [r]))[0];
}

// TODO (status engine): applyStatusFromSignal(projectId, reqId, signal) implements the rules in
// DATA_README.md (Expectation/Completion -> Confirmed, Constraint -> Modified,
// Conflict -> At Risk / Dropped), writes status_history and a ledger entry.

module.exports = { list, getOne, clusters, create, update };
