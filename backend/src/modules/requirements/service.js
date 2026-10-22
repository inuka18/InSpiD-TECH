'use strict';
const AppError = require('../../shared/AppError');
const { Signal } = require('../signals/model');
const { RequirementLink } = require('../network/model');
const ledger = require('../ledger/service');
const network = require('../network/service');
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
    cluster: r.clusterId ?? null, // computed by the network service; null until it has run
    clusterLabel: r.clusterLabel ?? null,
    type: r.type,
    priority: r.priority ?? null,
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

// Computed clusters (never group_id), as { id, label }.
async function clusters(projectId) {
  const rows = await Requirement.find({ projectId, clusterId: { $ne: null } }, { clusterId: 1, clusterLabel: 1 }).lean();
  const seen = new Map(rows.map((r) => [r.clusterId, r.clusterLabel]));
  return [...seen.entries()].sort((a, b) => Number(a[0].replace(/\D/g, '')) - Number(b[0].replace(/\D/g, ''))).map(([id, label]) => ({ id, label }));
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

// opts.skipNetwork: the caller refreshes the network itself afterwards (approving a requirement candidate does one single update).
// opts.triggeringSignal: { signalId, text } recorded on the REQUIREMENT_CREATED ledger entry.
async function create(projectId, body, user, { skipNetwork = false, triggeringSignal = null } = {}) {
  const { cluster, ...rest } = body;
  const doc = await Requirement.create({
    ...rest, projectId, reqId: await nextReqId(projectId), groupId: cluster || '',
    initialStatus: 'Confirmed', finalStatus: 'Confirmed', liveStatus: 'Confirmed', resourceRole: body.resourceRole || 'Unassigned',
  });
  await ledger.appendLedgerEntry({
    projectId, eventType: 'REQUIREMENT_CREATED', reqId: doc.reqId, requirementTitle: doc.title,
    previousStatus: null, newStatus: 'Confirmed', actor: user.email,
    ...(triggeringSignal ? { triggeringSignal: triggeringSignal.text, triggeringSignalId: triggeringSignal.signalId } : {}),
  });
  if (!skipNetwork) await network.onRequirementChanged(projectId, doc.reqId, user);
  return toApi((await Requirement.findOne({ projectId, reqId: doc.reqId }).lean()));
}

async function update(projectId, reqId, body, user) {
  const { cluster, ...rest } = body;
  const set = { ...rest, ...(cluster !== undefined ? { groupId: cluster } : {}) };
  const r = await Requirement.findOneAndUpdate({ projectId, reqId }, { $set: set }, { new: true }).lean();
  if (!r) throw new AppError(404, 'NOT_FOUND', `Requirement ${reqId} not found`);
  if (body.title !== undefined || body.description !== undefined) await network.onRequirementChanged(projectId, reqId, user);
  return (await hydrate(projectId, [r]))[0];
}

// The status engine lives in signals/ (statusEngine.js + service.js): it applies a signal to a requirement.

module.exports = { list, getOne, clusters, create, update };
