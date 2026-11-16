'use strict';
const crypto = require('crypto');
const AppError = require('../../shared/AppError');
const { LedgerEntry, EVENT_TYPES, LEGACY_EVENT_TYPES } = require('./model');

const GENESIS_HASH = '0x' + '0'.repeat(64);
const sha = (s) => '0x' + crypto.createHash('sha256').update(s).digest('hex');

// Normalise a stored (or legacy) entry to { eventType: CODE, linkAction }.
const codeOf = (e) => {
  const legacy = LEGACY_EVENT_TYPES[e.eventType];
  return { eventType: legacy ? legacy.eventType : e.eventType, linkAction: legacy?.linkAction ?? e.linkAction ?? null };
};
const DISPLAY = { STATUS_CHANGE: 'Status Change', REQUIREMENT_CREATED: 'Requirement Created', NETWORK_UPDATE: 'Network Updated', BASELINE_CREATED: 'Baseline Created' };
// The frontend branches on these strings, so `eventType` in the API keeps them; `eventCode` carries the code.
const displayType = (e) => {
  const { eventType, linkAction } = codeOf(e);
  if (eventType === 'MANUAL_LINK') return linkAction === 'removed' ? 'Manual Link Removed' : 'Manual Link Added';
  return DISPLAY[eventType] || e.eventType;
};

/**
 * txHash = sha256 of a canonical JSON (fixed key order, missing values as null, ISO timestamp) of the entry
 * fields plus previousBlockHash. Used by append, verify and rechain, so they can never disagree.
 */
function computeTxHash(e, previousBlockHash) {
  const { eventType, linkAction } = codeOf(e);
  const canonical = JSON.stringify({
    projectId: e.projectId,
    eventType,
    linkAction,
    requirementId: e.reqId ?? null,
    relatedRequirementId: e.relatedReqId ?? null,
    previousStatus: e.previousStatus ?? null,
    newStatus: e.newStatus ?? null,
    triggeringSignal: e.triggeringSignal ?? null,
    triggeringSignalId: e.triggeringSignalId ?? null,
    actor: e.actor ?? null,
    timestamp: new Date(e.timestamp).toISOString(),
    blockNumber: e.blockNumber,
    previousBlockHash,
  });
  return sha(canonical);
}

// NETWORK_UPDATE keeps its link ids in triggeringSignal as JSON (so they are covered by the hash); expose them parsed.
function networkDetails(e) {
  if (codeOf(e).eventType !== 'NETWORK_UPDATE') return undefined;
  try {
    const d = JSON.parse(e.triggeringSignal);
    return { added: d.added || [], removed: d.removed || [] };
  } catch {
    return { added: [], removed: [] };
  }
}

// BASELINE_CREATED keeps { baselineId, name } in triggeringSignal as JSON (covered by the hash), like NETWORK_UPDATE.
function baselineDetails(e) {
  if (codeOf(e).eventType !== 'BASELINE_CREATED') return undefined;
  try {
    const d = JSON.parse(e.triggeringSignal);
    return { baselineId: d.baselineId ?? null, name: d.name ?? null };
  } catch {
    return { baselineId: null, name: null };
  }
}

// Shape follows the frontend mockLedger rows.
const toApi = (e) => ({
  txHash: e.txHash,
  projectId: e.projectId,
  eventType: displayType(e),
  eventCode: codeOf(e).eventType,
  requirementId: e.reqId ?? null,
  requirementTitle: e.requirementTitle ?? null,
  relatedRequirementId: e.relatedReqId ?? null,
  relatedRequirementTitle: e.relatedRequirementTitle ?? null,
  previousStatus: e.previousStatus,
  newStatus: e.newStatus,
  triggeringSignal: e.triggeringSignal,
  triggeringSignalId: e.triggeringSignalId ?? null,
  actor: e.actor,
  timestamp: e.timestamp,
  blockNumber: e.blockNumber,
  previousBlockHash: e.previousBlockHash,
  onChain: e.onChain === true,
  isPlaceholder: e.isPlaceholder, // true until real blockchain writes replace this
  ...(codeOf(e).eventType === 'NETWORK_UPDATE' ? { details: networkDetails(e) } : {}),
  ...(codeOf(e).eventType === 'BASELINE_CREATED' ? { details: baselineDetails(e) } : {}),
});

const listForProject = async (projectId) =>
  (await LedgerEntry.find({ projectId }).sort({ timestamp: -1 }).lean()).map(toApi);

const listForRequirement = async (projectId, reqId) =>
  (await LedgerEntry.find({ projectId, $or: [{ reqId }, { relatedReqId: reqId }] }).sort({ timestamp: -1 }).lean()).map(toApi);

/**
 * THE ONLY function that appends to the ledger. Append-only. A real blockchain provider replaces the body
 * of this function later (same input, same return shape).
 * entry: { projectId, eventType (STATUS_CHANGE | REQUIREMENT_CREATED | MANUAL_LINK | NETWORK_UPDATE | BASELINE_CREATED), linkAction?, reqId, requirementTitle,
 *          relatedReqId?, relatedRequirementTitle?, previousStatus, newStatus, triggeringSignal, triggeringSignalId, actor, timestamp? }
 */
async function appendLedgerEntry(entry, { createdVia = 'api' } = {}) {
  if (!EVENT_TYPES.includes(entry.eventType)) throw new Error(`Unknown ledger eventType ${entry.eventType}`);
  const timestamp = entry.timestamp || new Date();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const last = await LedgerEntry.findOne({ projectId: entry.projectId }).sort({ blockNumber: -1 }).lean();
    const blockNumber = (last?.blockNumber ?? 0) + 1;
    const previousBlockHash = last?.txHash ?? GENESIS_HASH;
    const doc = { ...entry, timestamp, blockNumber, previousBlockHash, onChain: false, isPlaceholder: true, createdVia };
    doc.txHash = computeTxHash(doc, previousBlockHash);
    try {
      return toApi((await LedgerEntry.create(doc)).toObject());
    } catch (err) {
      if (err.code !== 11000) throw err; // two appends took the same blockNumber: take the next one
    }
  }
  throw new AppError(409, 'LEDGER_BUSY', 'Could not append to the ledger (concurrent writes); try again');
}

// Recompute the whole chain for a project. brokenAt = blockNumber of the first bad entry.
async function verifyChain(projectId) {
  const entries = await LedgerEntry.find({ projectId }).sort({ blockNumber: 1, _id: 1 }).lean();
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const fail = (reason) => ({ valid: false, entries: entries.length, brokenAt: e.blockNumber, reason });
    if (e.blockNumber !== i + 1) return fail(`blockNumber should be ${i + 1}`);
    if (e.previousBlockHash !== prev) return fail('previousBlockHash does not match the previous entry');
    if (computeTxHash(e, e.previousBlockHash) !== e.txHash) return fail('txHash does not match the entry contents');
    prev = e.txHash;
  }
  return { valid: true, entries: entries.length, brokenAt: null, reason: null };
}

/**
 * One-off migration for SEED placeholder entries (their old hashes did not include previousBlockHash).
 * Refuses to touch anything that is on-chain, was created through the API, or is not a seed entry; checks
 * everything first and writes nothing if any entry is not rewritable.
 */
async function rechainSeedEntries({ projectId } = {}) {
  const filter = projectId ? { projectId } : {};
  const entries = await LedgerEntry.find(filter).sort({ projectId: 1, blockNumber: 1, timestamp: 1, _id: 1 }).lean();
  const bad = entries.filter((e) => e.onChain === true || e.createdVia === 'api' || !e.historyId);
  if (bad.length) {
    const why = bad.slice(0, 3).map((e) => `${e.projectId} block ${e.blockNumber} (${e.onChain ? 'onChain' : e.createdVia === 'api' ? 'created through the API' : 'not a seed entry'})`);
    throw new AppError(409, 'RECHAIN_REFUSED',
      `Refusing to rechain: ${bad.length} entr${bad.length === 1 ? 'y is' : 'ies are'} not seed placeholders, e.g. ${why.join('; ')}. ` +
      'Rechain only rewrites seed placeholder entries. Re-seed an empty database instead.');
  }
  const byProject = new Map();
  for (const e of entries) byProject.set(e.projectId, [...(byProject.get(e.projectId) || []), e]);
  const ops = [];
  for (const [pid, list] of byProject) {
    let prev = GENESIS_HASH;
    list.forEach((e, i) => {
      const next = { ...e, ...codeOf(e), blockNumber: i + 1 };
      const txHash = computeTxHash(next, prev);
      ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { eventType: next.eventType, linkAction: next.linkAction, blockNumber: i + 1, previousBlockHash: prev, txHash, onChain: false, createdVia: 'seed' } } } });
      prev = txHash;
    });
  }
  // Two passes so the unique (projectId, blockNumber) index is never violated mid-way.
  if (ops.length) {
    await LedgerEntry.bulkWrite(ops.map((o) => ({ updateOne: { filter: o.updateOne.filter, update: { $set: { blockNumber: -Math.abs(o.updateOne.update.$set.blockNumber) } } } })));
    await LedgerEntry.bulkWrite(ops);
  }
  return { projects: byProject.size, entries: ops.length };
}

module.exports = { listForProject, listForRequirement, appendLedgerEntry, verifyChain, rechainSeedEntries, computeTxHash, GENESIS_HASH, sha };
