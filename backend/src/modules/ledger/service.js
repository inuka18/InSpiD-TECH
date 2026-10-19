'use strict';
const crypto = require('crypto');
const { LedgerEntry } = require('./model');

const GENESIS_HASH = '0x' + '0'.repeat(64);
const sha = (s) => '0x' + crypto.createHash('sha256').update(s).digest('hex');

// Shape follows the frontend mockLedger rows.
const toApi = (e) => ({
  txHash: e.txHash,
  projectId: e.projectId,
  eventType: e.eventType,
  requirementId: e.reqId ?? null,
  requirementTitle: e.requirementTitle ?? null,
  relatedRequirementId: e.relatedReqId ?? null,
  relatedRequirementTitle: e.relatedRequirementTitle ?? null,
  previousStatus: e.previousStatus,
  newStatus: e.newStatus,
  triggeringSignal: e.triggeringSignal,
  actor: e.actor,
  timestamp: e.timestamp,
  blockNumber: e.blockNumber,
  previousBlockHash: e.previousBlockHash,
  isPlaceholder: e.isPlaceholder, // true until real blockchain writes replace this
});

const listForProject = async (projectId) =>
  (await LedgerEntry.find({ projectId }).sort({ timestamp: -1 }).lean()).map(toApi);

const listForRequirement = async (projectId, reqId) =>
  (await LedgerEntry.find({ projectId, $or: [{ reqId }, { relatedReqId: reqId }] }).sort({ timestamp: -1 }).lean()).map(toApi);

// Append-only. PLACEHOLDER: chains a fake hash onto the project's latest entry.
// TODO (blockchain prompt): send a real transaction to the Hardhat node and store its receipt.
async function appendPlaceholderEntry(entry) {
  const last = await LedgerEntry.findOne({ projectId: entry.projectId }).sort({ blockNumber: -1 }).lean();
  const timestamp = entry.timestamp || new Date();
  const doc = await LedgerEntry.create({
    ...entry,
    timestamp,
    txHash: sha(`placeholder|${entry.projectId}|${entry.eventType}|${entry.reqId}|${timestamp.toISOString()}|${crypto.randomUUID()}`),
    blockNumber: (last?.blockNumber ?? 0) + 1,
    previousBlockHash: last?.txHash ?? GENESIS_HASH,
    isPlaceholder: true,
  });
  return toApi(doc.toObject());
}

module.exports = { listForProject, listForRequirement, appendPlaceholderEntry, GENESIS_HASH, sha };
