'use strict';
const crypto = require('crypto');
const AppError = require('../../shared/AppError');
const aiClient = require('../../shared/aiClient');
const { Requirement } = require('../requirements/model');
const { Signal } = require('../signals/model');
const ledger = require('../ledger/service');
const { RequirementLink, ManualLink, SignalEvidence, NetworkState, Baseline } = require('./model');
const { pathfinder, cosineMatrix, distanceMatrix } = require('./pathfinder');
const { agglomerateToK, targetClusterCount, describeClusters } = require('./clustering');
const { diffLinks, orderPair, linkKey } = require('./diff');
const { combinedMatrix, pairKey } = require('./combine');
const { extractEvidence } = require('./evidence');
const { updateProfile } = require('./profile');
const { EVIDENCE_LIST_LIMIT } = require('./constants');
const baselines = require('./baselines');

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
// over the COMBINED similarity (text + signal profile + evidence boost, see combine.js); with no applied signals that is
// exactly the cosine similarity of the texts. Clusters = average-linkage agglomerative clustering on the same distances, cut to
// k clusters. The CSV group_id is never used. Manual links live in their own collection and are never touched here.
const textOf = (r) => `${r.title}. ${r.description || ''}`.trim();
const hashOf = (t) => crypto.createHash('sha1').update(t).digest('hex');
const round6 = (x) => Math.round(x * 1e6) / 1e6;
const clusterNo = (id) => Number(String(id).replace(/\D/g, ''));
const isSeeded = (s) => s.seeded === true || Boolean(s.split);

// One recompute at a time per project (in this process), so two edits cannot interleave their diffs.
const chains = new Map();
function withLock(projectId, fn) {
  const run = (chains.get(projectId) || Promise.resolve()).catch(() => {}).then(fn);
  chains.set(projectId, run);
  run.then(() => {}, () => {}).then(() => { if (chains.get(projectId) === run) chains.delete(projectId); });
  return run;
}

// Requirements with the vectors the network needs (hidden from normal queries).
const loadForNetwork = (projectId) => Requirement.find({ projectId }).select('+embedding +signalProfile').sort({ reqId: 1 }).lean();

// Embed the requirements whose text changed (or all of them). Mutates reqs. Throws AppError (502) if the ai-service cannot embed.
async function ensureEmbeddings(reqs, forceEmbed = false) {
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
}

// "reqA|reqB" -> { idMention, coref }: how many evidence rows support each pair.
async function evidenceCounts(projectId) {
  const rows = await SignalEvidence.aggregate([
    { $match: { projectId } },
    { $group: { _id: { a: '$reqA', b: '$reqB', k: '$kind' }, n: { $sum: 1 } } },
  ]);
  const m = new Map();
  for (const r of rows) {
    const key = pairKey(r._id.a, r._id.b);
    const c = m.get(key) || { idMention: 0, coref: 0 };
    c[r._id.k === 'idmention' ? 'idMention' : 'coref'] += r.n;
    m.set(key, c);
  }
  return m;
}

// Pathfinder links over a similarity matrix (index pairs -> link objects with the rounded weight).
const linksFrom = (reqs, sim) =>
  pathfinder(distanceMatrix(sim)).map(([i, j]) => {
    const [reqA, reqB] = orderPair(reqs[i].reqId, reqs[j].reqId);
    return { reqA, reqB, weight: round6(sim[i][j]) };
  });

// The TEXT-ONLY links (no evidence, no profiles): what the initial baseline freezes.
const textOnlyLinks = (reqs) => (reqs.length < 2 ? [] : linksFrom(reqs, cosineMatrix(reqs.map((r) => r.embedding))))
  .map((l) => ({ source: l.reqA, target: l.reqB, weight: l.weight }));

// Store only the DIFFERENCE against the stored links; one NETWORK_UPDATE ledger entry if any link was added or removed.
// trigger: { reqId, signalId } of whatever caused it (both optional).
async function storeLinks(projectId, reqs, computed, { actor, trigger = {} }) {
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
    const t = trigger.reqId ? reqs.find((r) => r.reqId === trigger.reqId) : null;
    ledgerEntry = await ledger.appendLedgerEntry({
      projectId, eventType: 'NETWORK_UPDATE', reqId: t?.reqId ?? null, requirementTitle: t?.title ?? null,
      triggeringSignal: JSON.stringify({ added: d.added.map((l) => l.id), removed: d.removed.map((l) => l.id) }),
      triggeringSignalId: trigger.signalId ?? null, actor,
    });
  }
  return { diff: d, ledgerEntry };
}

const setState = (projectId, $set, $addToSet) =>
  NetworkState.updateOne({ projectId }, { $set: { ...$set, updatedAt: new Date() }, ...($addToSet ? { $addToSet } : {}) }, { upsert: true });

async function foldIntoProfile(projectId, reqId, embedding) {
  const r = await Requirement.findOne({ projectId, reqId }).select('+signalProfile').lean();
  if (!r) return;
  const next = updateProfile(r.signalProfile, embedding);
  await Requirement.updateOne({ projectId, reqId }, { $set: { signalProfile: { vector: next.vector, count: next.count, updatedAt: new Date() } } });
}

// Applied signals whose profile update was skipped (ai-service down): embed them now and fold them into the profiles, oldest first.
async function catchUpProfiles(projectId) {
  const st = await NetworkState.findOne({ projectId }).lean();
  if (!st?.pendingSignalIds?.length) return;
  const sigs = await Signal.find({ projectId, signalId: { $in: st.pendingSignalIds } }).sort({ timestamp: 1 }).lean();
  const usable = sigs.filter((s) => s.reqId);
  if (usable.length) {
    const res = await aiClient.embed(usable.map((s) => s.text));
    if (!Array.isArray(res?.vectors) || res.vectors.length !== usable.length) throw new AppError(502, 'AI_SERVICE_ERROR', 'AI service returned an unexpected /embed answer');
    for (let k = 0; k < usable.length; k += 1) await foldIntoProfile(projectId, usable[k].reqId, res.vectors[k]);
  }
  await NetworkState.updateOne({ projectId }, { $set: { pendingSignalIds: [], updatedAt: new Date() } });
}

/**
 * Recompute links and clusters for a project and store only the DIFFERENCE: links added or removed (plus silent
 * weight refreshes of kept links). If any link was added or removed, ONE NETWORK_UPDATE ledger entry lists them.
 * Throws AppError (502) if the ai-service cannot embed. `forceEmbed` re-embeds every requirement.
 * Also creates the "Initial baseline" (text-only) when the project has none.
 */
function computeNetwork(projectId, { actor = 'system', triggerReqId = null, forceEmbed = false } = {}) {
  return withLock(projectId, async () => {
    await catchUpProfiles(projectId);
    const reqs = await loadForNetwork(projectId);
    const n = reqs.length;
    let computed = [];
    let assign = reqs.map(() => 0);
    if (n >= 2) {
      await ensureEmbeddings(reqs, forceEmbed);
      const { sim } = combinedMatrix(reqs, await evidenceCounts(projectId));
      computed = linksFrom(reqs, sim);
      assign = agglomerateToK(distanceMatrix(sim), targetClusterCount(n)); // k = clamp(round(sqrt(n)), 3, 8): chosen for usability, not tuned
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

    const { diff: d, ledgerEntry } = await storeLinks(projectId, reqs, computed, { actor, trigger: { reqId: triggerReqId } });
    await setState(projectId, { stale: false, pendingSignalIds: [] });
    if (n > 0) await ensureInitialBaselineLocked(projectId, reqs);
    return {
      projectId, requirements: n, links: computed.length, clusters: described.length,
      added: d.added.map((l) => l.id), removed: d.removed.map((l) => l.id), reweighted: d.reweighted.length, ledgerEntry,
    };
  });
}

// ------------------------------------------------------------------ baselines (the network side: they need the lock)
// The caller holds the lock. Text-only, whatever evidence or profiles exist.
async function ensureInitialBaselineLocked(projectId, reqs) {
  if (await Baseline.exists({ projectId, initial: true })) return null;
  await ensureEmbeddings(reqs);
  return baselines.freeze({ projectId, name: baselines.INITIAL_NAME, actor: 'system', initial: true, links: textOnlyLinks(reqs) });
}

// Idempotent, also under concurrent first GET /network calls: the per-project lock serialises them and a unique index on
// (projectId, initial) is the second line of defence.
const ensureInitialBaseline = (projectId) =>
  withLock(projectId, async () => ensureInitialBaselineLocked(projectId, await loadForNetwork(projectId)));

async function createBaseline(projectId, name, user) {
  const warning = await refreshIfNeeded(projectId);
  if (warning) throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', `The network is not up to date, so it cannot be frozen now. ${warning}`);
  return withLock(projectId, async () => {
    const links = await baselines.currentComputedLinks(projectId);
    const { baseline, ledgerEntry } = await baselines.freeze({ projectId, name: name.trim(), actor: user.email, links });
    return { ...baselines.toSummary(baseline), ledgerEntry };
  });
}

// ------------------------------------------------------------------ signals feed the network
/**
 * Called by finalizeSignal() once for every APPLIED, non-seeded signal whose label is not None. Never throws: the signal itself
 * must not fail because the network could not be updated. Steps: evidence rows -> signal profile of the matched requirement ->
 * combined similarity -> Pathfinder -> diff -> write only the changes -> ONE NETWORK_UPDATE ledger entry (or none).
 * If the ai-service is down the network update is skipped and the network is marked stale (see catchUpProfiles).
 */
async function onSignalApplied({ projectId, signal, requirementId, actor }) {
  if (!signal || !requirementId || isSeeded(signal)) return { skipped: true };
  try {
    const ids = (await Requirement.find({ projectId }).select('reqId').lean()).map((r) => r.reqId);
    const rows = extractEvidence({ text: signal.text, requirementId, alternatives: signal.matchAlternatives || [], projectReqIds: ids });
    if (rows.length) {
      try {
        await SignalEvidence.insertMany(rows.map((r) => ({ ...r, projectId, signalId: signal.signalId, createdAt: new Date() })), { ordered: false });
      } catch (err) {
        const dupOnly = err.code === 11000 || (err.writeErrors?.length && err.writeErrors.every((w) => (w.err?.code ?? w.code) === 11000));
        if (!dupOnly) throw err;
      }
    }
    let vector;
    try {
      const res = await aiClient.embed([signal.text]);
      vector = res?.vectors?.[0];
      if (!Array.isArray(vector)) throw new AppError(502, 'AI_SERVICE_ERROR', 'AI service returned an unexpected /embed answer');
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      await setState(projectId, { stale: true }, { pendingSignalIds: signal.signalId });
      console.warn(`network: signal ${signal.signalId} not folded into the network (${err.message}); marked stale`);
      return { stale: true };
    }
    return await withLock(projectId, async () => {
      await foldIntoProfile(projectId, requirementId, vector);
      try {
        const reqs = await loadForNetwork(projectId);
        await ensureEmbeddings(reqs);
        const { sim } = combinedMatrix(reqs, await evidenceCounts(projectId));
        const { diff: d, ledgerEntry } = await storeLinks(projectId, reqs, linksFrom(reqs, sim), { actor, trigger: { reqId: requirementId, signalId: signal.signalId } });
        return { updated: true, added: d.added.map((l) => l.id), removed: d.removed.map((l) => l.id), ledgerEntry };
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        await setState(projectId, { stale: true }); // the profile is saved; only the link refresh is outstanding
        return { stale: true };
      }
    });
  } catch (err) {
    console.error(`network: update after signal ${signal?.signalId} failed (${err.message})`);
    try { await setState(projectId, { stale: true }); } catch { /* ignore */ }
    return { failed: true };
  }
}

/**
 * Several signals applied at once (approving / merging a requirement candidate): evidence rows and signal profiles for all of
 * them (ONE /embed call), then ONE network recompute, so there is at most ONE NETWORK_UPDATE ledger entry in total.
 * items: [{ signal, requirementId }]. Never throws (same contract as onSignalApplied).
 */
async function onSignalsApplied({ projectId, items, actor, triggerReqId = null }) {
  const usable = (items || []).filter((it) => it.signal && it.requirementId && !isSeeded(it.signal));
  try {
    if (usable.length) {
      const ids = (await Requirement.find({ projectId }).select('reqId').lean()).map((r) => r.reqId);
      const rows = usable.flatMap((it) => extractEvidence({
        text: it.signal.text, requirementId: it.requirementId, alternatives: it.signal.matchAlternatives || [], projectReqIds: ids,
      }).map((r) => ({ ...r, projectId, signalId: it.signal.signalId, createdAt: new Date() })));
      if (rows.length) {
        try {
          await SignalEvidence.insertMany(rows, { ordered: false });
        } catch (err) {
          const dupOnly = err.code === 11000 || (err.writeErrors?.length && err.writeErrors.every((w) => (w.err?.code ?? w.code) === 11000));
          if (!dupOnly) throw err;
        }
      }
      let vectors = null;
      try {
        const res = await aiClient.embed(usable.map((it) => it.signal.text));
        if (Array.isArray(res?.vectors) && res.vectors.length === usable.length) vectors = res.vectors;
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
      }
      if (vectors) {
        await withLock(projectId, async () => {
          for (let k = 0; k < usable.length; k += 1) await foldIntoProfile(projectId, usable[k].requirementId, vectors[k]);
        });
      } else {
        await setState(projectId, { stale: true }, { pendingSignalIds: { $each: usable.map((it) => it.signal.signalId) } });
        console.warn('network: candidate signals not folded into the profiles (ai-service down); marked stale');
      }
    }
    if (triggerReqId || usable.length) await onRequirementChanged(projectId, triggerReqId || usable[0].requirementId, { email: actor });
    return { updated: true };
  } catch (err) {
    console.error(`network: batch update failed (${err.message})`);
    try { await setState(projectId, { stale: true }); } catch { /* ignore */ }
    return { failed: true };
  }
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

const pfToApi = (l, parts) => ({
  id: linkKey(l.reqA, l.reqB), source: l.reqA, target: l.reqB, kind: 'pathfinder', relationType: 'semantic',
  weight: parts?.sim ?? l.weight, evidenceCount: parts?.evidenceCount ?? 0,
  contributions: parts?.contributions ?? { text: l.weight, profile: 0, boost: 0 },
});

// Combined similarity parts for pairs: Map "reqA|reqB" -> { sim, contributions, evidenceCount }. Empty if embeddings are missing.
async function pairParts(projectId, reqs) {
  if (reqs.length < 2 || reqs.some((r) => !r.embedding?.length)) return new Map();
  const counts = await evidenceCounts(projectId);
  const { parts } = combinedMatrix(reqs, counts);
  const out = new Map();
  for (const [key, p] of parts) {
    const c = counts.get(key) || { idMention: 0, coref: 0 };
    out.set(key, {
      sim: round6(Math.min(1, p.text + p.profile + p.boost)), contributions: { text: p.text, profile: p.profile, boost: p.boost },
      evidenceCount: c.idMention + c.coref,
    });
  }
  return out;
}

// Compute first when nothing (or something stale) is stored. Returns a warning text if that was not possible.
async function refreshIfNeeded(projectId) {
  const [reqs, state] = await Promise.all([Requirement.find({ projectId }).sort({ reqId: 1 }).lean(), NetworkState.findOne({ projectId }).lean()]);
  const needsCompute = reqs.length > 0 && (
    reqs.some((r) => !r.clusterId) || state?.stale === true ||
    (reqs.length >= 2 && reqs.some((r) => r.embeddingTextHash !== hashOf(textOf(r)))));
  if (!needsCompute) return undefined;
  try {
    await computeNetwork(projectId, { actor: 'system' });
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return `The network could not be computed or refreshed (${err.message}). Showing the last stored links, which may be empty or out of date.`;
  }
  return undefined;
}

// Nodes + stored links + manual links. Computes first if nothing (or something stale) is stored; makes sure the initial baseline exists.
async function getNetwork(projectId) {
  let warning = await refreshIfNeeded(projectId);
  if (!warning && !(await Baseline.exists({ projectId, initial: true })) && (await Requirement.exists({ projectId }))) {
    try {
      await ensureInitialBaseline(projectId);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      warning = `The initial baseline could not be created (${err.message}).`;
    }
  }
  const reqs = await loadForNetwork(projectId);
  const [auto, manual, parts] = await Promise.all([
    RequirementLink.find({ projectId, kind: 'pathfinder' }).lean(),
    ManualLink.find({ projectId }).sort({ createdAt: 1 }).lean(),
    pairParts(projectId, reqs),
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
    links: [...auto.map((l) => pfToApi(l, parts.get(pairKey(l.reqA, l.reqB)))).sort((a, b) => (a.id < b.id ? -1 : 1)), ...manual.map(manualToApi)],
    clusters: [...clusters.values()].sort((a, b) => clusterNo(a.id) - clusterNo(b.id)),
    ...(warning ? { warning } : {}),
  };
}

// The evidence behind one computed link: where its weight comes from, and up to EVIDENCE_LIST_LIMIT supporting signals (newest first).
async function linkEvidence(projectId, linkId) {
  const [a, b, kind] = String(linkId).split('~');
  const link = a && b && kind === 'semantic'
    ? await RequirementLink.findOne({ projectId, kind: 'pathfinder', reqA: a < b ? a : b, reqB: a < b ? b : a }).lean()
    : null;
  if (!link) throw new AppError(404, 'NOT_FOUND', `Link ${linkId} not found in this project`);
  const reqs = await loadForNetwork(projectId);
  const p = (await pairParts(projectId, reqs)).get(pairKey(link.reqA, link.reqB));
  const rows = await SignalEvidence.find({ projectId, reqA: link.reqA, reqB: link.reqB }).lean();
  const signals = await Signal.find({ projectId, signalId: { $in: rows.map((r) => r.signalId) } }).sort({ timestamp: -1 }).limit(EVIDENCE_LIST_LIMIT).lean();
  const rowOf = new Map(rows.map((r) => [r.signalId, r]));
  return {
    linkId: linkKey(link.reqA, link.reqB), source: link.reqA, target: link.reqB,
    weight: p?.sim ?? link.weight,
    contributions: p?.contributions ?? { text: link.weight, profile: 0, boost: 0 },
    evidenceCount: rows.length,
    evidenceByKind: { idmention: rows.filter((r) => r.kind === 'idmention').length, coref: rows.filter((r) => r.kind === 'coref').length },
    signals: signals.map((s) => {
      const r = rowOf.get(s.signalId);
      return {
        signalId: s.signalId, text: s.text, source: s.source, authorRole: s.authorRole, timestamp: s.timestamp, label: s.label,
        kind: r.kind, similarityA: r.similarityA, similarityB: r.similarityB,
      };
    }),
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

module.exports = {
  getNetwork, computeNetwork, recompute, onRequirementChanged, onSignalApplied, onSignalsApplied, linkEvidence, createBaseline, ensureInitialBaseline,
  listManualLinks, addManualLink, removeManualLink, withLock, textOnlyLinks,
};
