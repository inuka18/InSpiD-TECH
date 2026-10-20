'use strict';
const crypto = require('crypto');
const AppError = require('../../shared/AppError');
const aiClient = require('../../shared/aiClient');
const { Requirement } = require('../requirements/model');
const ledger = require('../ledger/service');
const { RequirementLink, ManualLink } = require('./model');
const { pathfinder, cosineMatrix, distanceMatrix } = require('./pathfinder');
const { agglomerateToK, targetClusterCount, describeClusters } = require('./clustering');
const { diffLinks, orderPair, linkKey } = require('./diff');

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

// ------------------------------------------------------------------ computing the network
// Nodes = requirements (title + description embedded with the ai-service). Links = Pathfinder (PFNET r=inf, q=n-1)
// over cosine distance. Clusters = average-linkage agglomerative clustering on the same distances, cut to k clusters. The CSV group_id
// is never used. Manual links live in their own collection and are never touched here.
const textOf = (r) => `${r.title}. ${r.description || ''}`.trim();
const hashOf = (t) => crypto.createHash('sha1').update(t).digest('hex');
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const clusterNo = (id) => Number(String(id).replace(/\D/g, ''));

// One recompute at a time per project (in this process), so two edits cannot interleave their diffs.
const chains = new Map();
function withLock(projectId, fn) {
  const run = (chains.get(projectId) || Promise.resolve()).catch(() => {}).then(fn);
  chains.set(projectId, run);
  run.then(() => {}, () => {}).then(() => { if (chains.get(projectId) === run) chains.delete(projectId); });
  return run;
}

/**
 * Recompute links and clusters for a project and store only the DIFFERENCE: links added or removed (plus silent
 * weight refreshes of kept links). If any link was added or removed, ONE NETWORK_UPDATE ledger entry lists them.
 * Throws AppError (502) if the ai-service cannot embed. `forceEmbed` re-embeds every requirement.
 */
function computeNetwork(projectId, { actor = 'system', triggerReqId = null, forceEmbed = false } = {}) {
  return withLock(projectId, async () => {
    const reqs = await Requirement.find({ projectId }).select('+embedding').sort({ reqId: 1 }).lean();
    const n = reqs.length;
    let computed = [];
    let assign = reqs.map(() => 0);
    if (n >= 2) {
      const stale = reqs.filter((r) => forceEmbed || !r.embedding?.length || r.embeddingTextHash !== hashOf(textOf(r)));
      for (let from = 0; from < stale.length; from += 256) { // the ai-service accepts up to 512 texts per call
        const batch = stale.slice(from, from + 256);
        const res = await aiClient.embed(batch.map(textOf));
        if (!Array.isArray(res?.vectors) || res.vectors.length !== batch.length) {
          throw new AppError(502, 'AI_SERVICE_ERROR', 'AI service returned an unexpected /embed answer');
        }
        await Requirement.bulkWrite(batch.map((r, k) => ({
          updateOne: { filter: { _id: r._id }, update: { $set: { embedding: res.vectors[k], embeddingTextHash: hashOf(textOf(r)) } } },
        })));
        batch.forEach((r, k) => { r.embedding = res.vectors[k]; });
      }
      const sim = cosineMatrix(reqs.map((r) => r.embedding));
      const dist = distanceMatrix(sim);
      computed = pathfinder(dist).map(([i, j]) => {
        const [reqA, reqB] = orderPair(reqs[i].reqId, reqs[j].reqId);
        return { reqA, reqB, weight: round6(sim[i][j]) };
      });
      assign = agglomerateToK(dist, targetClusterCount(n)); // k = clamp(round(sqrt(n)), 3, 8): chosen for usability, not tuned
    }

    // clusters -> requirement documents (only the ones that changed)
    const described = describeClusters(assign, reqs.map((r) => r.title));
    const clusterOf = new Map();
    described.forEach((c) => c.members.forEach((i) => clusterOf.set(reqs[i].reqId, c)));
    const clusterOps = reqs
      .filter((r) => r.clusterId !== clusterOf.get(r.reqId).id || r.clusterLabel !== clusterOf.get(r.reqId).label)
      .map((r) => ({
        updateOne: { filter: { _id: r._id }, update: { $set: { clusterId: clusterOf.get(r.reqId).id, clusterLabel: clusterOf.get(r.reqId).label } } },
      }));
    if (clusterOps.length) await Requirement.bulkWrite(clusterOps);

    // links -> diff against what is stored
    const stored = await RequirementLink.find({ projectId, kind: 'pathfinder' }).lean();
    const d = diffLinks(stored, computed);
    const now = new Date();
    if (d.removed.length) {
      await RequirementLink.deleteMany({ projectId, kind: 'pathfinder', $or: d.removed.map((l) => ({ reqA: l.reqA, reqB: l.reqB })) });
    }
    if (d.added.length) {
      await RequirementLink.insertMany(d.added.map((l) => ({
        projectId, reqA: l.reqA, reqB: l.reqB, relationType: 'semantic', kind: 'pathfinder', weight: l.weight, computedAt: now,
      })));
    }
    if (d.reweighted.length) {
      await RequirementLink.bulkWrite(d.reweighted.map((l) => ({
        updateOne: { filter: { projectId, kind: 'pathfinder', reqA: l.reqA, reqB: l.reqB }, update: { $set: { weight: l.weight, computedAt: now } } },
      })));
    }

    let ledgerEntry = null;
    if (d.added.length || d.removed.length) {
      const trigger = triggerReqId ? reqs.find((r) => r.reqId === triggerReqId) : null;
      ledgerEntry = await ledger.appendLedgerEntry({
        projectId, eventType: 'NETWORK_UPDATE', reqId: trigger?.reqId ?? null, requirementTitle: trigger?.title ?? null,
        triggeringSignal: JSON.stringify({ added: d.added.map((l) => l.id), removed: d.removed.map((l) => l.id) }), actor,
      });
    }
    return {
      projectId, requirements: n, links: computed.length, clusters: described.length,
      added: d.added.map((l) => l.id), removed: d.removed.map((l) => l.id), reweighted: d.reweighted.length, ledgerEntry,
    };
  });
}

// Called when a requirement is created or its title/description changes. The edit must not fail because the
// ai-service is down: the network is then refreshed by the next GET /network or POST /network/recompute.
async function onRequirementChanged(projectId, reqId, user) {
  try {
    await computeNetwork(projectId, { actor: user?.email ?? 'system', triggerReqId: reqId });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    console.warn(`network: not refreshed after a change to ${reqId} (${err.message})`);
  }
}

// Full recompute (PM). Re-embeds every requirement, then diffs and writes the ledger entry as usual.
const recompute = (projectId, user) => computeNetwork(projectId, { actor: user.email, forceEmbed: true });

const pfToApi = (l) => ({
  id: linkKey(l.reqA, l.reqB), source: l.reqA, target: l.reqB, kind: 'pathfinder', relationType: 'semantic', weight: l.weight,
});

// Nodes + stored links + manual links. Computes first if nothing (or something stale) is stored.
async function getNetwork(projectId) {
  let reqs = await Requirement.find({ projectId }).sort({ reqId: 1 }).lean();
  const needsCompute = reqs.length > 0 && (
    reqs.some((r) => !r.clusterId) ||
    (reqs.length >= 2 && reqs.some((r) => r.embeddingTextHash !== hashOf(textOf(r)))));
  let warning;
  if (needsCompute) {
    try {
      await computeNetwork(projectId, { actor: 'system' });
      reqs = await Requirement.find({ projectId }).sort({ reqId: 1 }).lean();
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      warning = `The network could not be computed or refreshed (${err.message}). Showing the last stored links, which may be empty or out of date.`;
    }
  }
  const [auto, manual] = await Promise.all([
    RequirementLink.find({ projectId, kind: 'pathfinder' }).lean(),
    ManualLink.find({ projectId }).sort({ createdAt: 1 }).lean(),
  ]);
  const clusters = new Map();
  reqs.forEach((r) => {
    if (r.clusterId) clusters.set(r.clusterId, { id: r.clusterId, label: r.clusterLabel, size: (clusters.get(r.clusterId)?.size ?? 0) + 1 });
  });
  return {
    projectId,
    nodes: reqs.map((r) => ({
      id: r.reqId, title: r.title, liveStatus: r.liveStatus, cluster: r.clusterId ?? null, clusterLabel: r.clusterLabel ?? null,
      type: r.type, resourceRole: r.resourceRole,
    })),
    links: [...auto.map(pfToApi).sort((a, b) => (a.id < b.id ? -1 : 1)), ...manual.map(manualToApi)],
    clusters: [...clusters.values()].sort((a, b) => clusterNo(a.id) - clusterNo(b.id)),
    ...(warning ? { warning } : {}),
  };
}

// ------------------------------------------------------------------ manual links
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
  await ledger.appendLedgerEntry({
    projectId, eventType: 'MANUAL_LINK', linkAction: 'added', reqId: sourceId, requirementTitle: title(sourceId),
    relatedReqId: targetId, relatedRequirementTitle: title(targetId), triggeringSignal: reason, actor: user.email,
  });
  return manualToApi(link.toObject());
}

async function removeManualLink(projectId, linkId, user) {
  const link = await ManualLink.findOneAndDelete({ projectId, linkId }).lean();
  if (!link) throw new AppError(404, 'NOT_FOUND', 'Manual link not found');
  const reqs = await Requirement.find({ projectId, reqId: { $in: [link.sourceId, link.targetId] } }).lean();
  const title = (id) => reqs.find((r) => r.reqId === id)?.title ?? null;
  await ledger.appendLedgerEntry({
    projectId, eventType: 'MANUAL_LINK', linkAction: 'removed', reqId: link.sourceId, requirementTitle: title(link.sourceId),
    relatedReqId: link.targetId, relatedRequirementTitle: title(link.targetId), triggeringSignal: link.reason, actor: user.email,
  });
  return { removed: linkId };
}

module.exports = { getNetwork, computeNetwork, recompute, onRequirementChanged, listManualLinks, addManualLink, removeManualLink };
