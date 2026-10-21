'use strict';
// Baselines: a frozen copy of the computed network and of the requirement states. Nothing in here takes the per-project
// lock; the network service calls freeze() from inside it, so a baseline's ledger block is ordered against network updates.
const crypto = require('crypto');
const AppError = require('../../shared/AppError');
const ledger = require('../ledger/service');
const { Requirement } = require('../requirements/model');
const { Baseline, RequirementLink } = require('./model');
const { linkKey } = require('./diff');

const INITIAL_NAME = 'Initial baseline';

const toSummary = (b) => ({ id: b.baselineId, name: b.name, createdAt: b.createdAt, createdBy: b.createdBy, initial: b.initial === true, linkCount: b.links.length, requirementCount: b.requirements.length });
const toApi = (b) => ({ ...toSummary(b), requirements: b.requirements, links: b.links });

const reqSnapshot = (r) => ({
  id: r.reqId, title: r.title, description: r.description ?? '', type: r.type, status: r.liveStatus, granularity: r.granularity, resourceRole: r.resourceRole,
});

/**
 * Freeze `links` ([{ source, target, weight }]) and the CURRENT requirement states, then append the BASELINE_CREATED ledger entry.
 * The caller holds the project lock. An initial baseline is idempotent: a second one is a no-op returning the first.
 */
async function freeze({ projectId, name, actor, links, initial = false }) {
  if (initial) {
    const existing = await Baseline.findOne({ projectId, initial: true }).lean();
    if (existing) return { baseline: existing, created: false };
  }
  const reqs = await Requirement.find({ projectId }).sort({ reqId: 1 }).lean();
  const baselineId = `BL-${crypto.randomUUID().slice(0, 8)}`;
  let doc;
  try {
    doc = await Baseline.create({
      projectId, baselineId, name, ...(initial ? { initial: true } : {}), createdBy: actor, createdAt: new Date(),
      requirements: reqs.map(reqSnapshot), links: links.map((l) => ({ source: l.source, target: l.target, weight: l.weight })),
    });
  } catch (err) {
    if (initial && err.code === 11000) return { baseline: await Baseline.findOne({ projectId, initial: true }).lean(), created: false };
    throw err;
  }
  const entry = await ledger.appendLedgerEntry({
    projectId, eventType: 'BASELINE_CREATED', triggeringSignal: JSON.stringify({ baselineId, name }), actor,
  });
  await Baseline.updateOne({ _id: doc._id }, { $set: { ledgerBlock: entry.blockNumber, createdAt: new Date(entry.timestamp) } });
  return { baseline: await Baseline.findById(doc._id).lean(), created: true, ledgerEntry: entry };
}

const list = async (projectId) => (await Baseline.find({ projectId }).sort({ createdAt: 1, _id: 1 }).lean()).map(toSummary);

async function get(projectId, baselineId) {
  const b = await Baseline.findOne({ projectId, baselineId }).lean();
  if (!b) throw new AppError(404, 'NOT_FOUND', `Baseline ${baselineId} not found`);
  return b;
}

const getApi = async (projectId, baselineId) => toApi(await get(projectId, baselineId));

/** The baseline the alignment uses by default: the most recent one. */
const latest = (projectId) => Baseline.findOne({ projectId }).sort({ createdAt: -1, _id: -1 }).lean();

const currentComputedLinks = async (projectId) =>
  (await RequirementLink.find({ projectId, kind: 'pathfinder' }).lean()).map((l) => ({ source: l.reqA, target: l.reqB, weight: l.weight }));

/** What changed since a baseline: requirements whose status differs, links added and removed against the current computed network. */
async function diff(projectId, baselineId) {
  const b = await get(projectId, baselineId);
  const [reqs, links] = await Promise.all([Requirement.find({ projectId }).lean(), currentComputedLinks(projectId)]);
  const then = new Map(b.requirements.map((r) => [r.id, r]));
  const changedRequirements = reqs
    .filter((r) => then.has(r.reqId) && then.get(r.reqId).status !== r.liveStatus)
    .map((r) => ({ id: r.reqId, title: r.title, from: then.get(r.reqId).status, to: r.liveStatus }))
    .sort((x, y) => (x.id < y.id ? -1 : 1));
  const addedRequirements = reqs.filter((r) => !then.has(r.reqId)).map((r) => ({ id: r.reqId, title: r.title })).sort((x, y) => (x.id < y.id ? -1 : 1));
  const removedRequirements = [...then.values()].filter((r) => !reqs.some((x) => x.reqId === r.id)).map((r) => ({ id: r.id, title: r.title }));
  const before = new Set(b.links.map((l) => linkKey(l.source, l.target)));
  const now = new Set(links.map((l) => linkKey(l.source, l.target)));
  return {
    baseline: { id: b.baselineId, name: b.name, createdAt: b.createdAt },
    requirements: { changed: changedRequirements, added: addedRequirements, removed: removedRequirements },
    links: { added: [...now].filter((k) => !before.has(k)).sort(), removed: [...before].filter((k) => !now.has(k)).sort() },
  };
}

module.exports = { freeze, list, get, getApi, latest, diff, INITIAL_NAME, currentComputedLinks, toSummary };
