'use strict';
const mongoose = require('mongoose');

const EVENT_TYPES = ['Status Change', 'Requirement Created', 'Manual Link Added', 'Manual Link Removed'];

// PLACEHOLDER LEDGER: these documents are NOT blockchain transactions. txHash, blockNumber and
// previousBlockHash are derived locally (sha256) so the UI has something realistic to show.
// Every entry carries isPlaceholder: true. A later step replaces this with real Hardhat
// transactions (BLOCKCHAIN_RPC_URL) and removes the flag.
const ledgerEntrySchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    historyId: { type: String }, // set for entries built from status_history (idempotent seeding)
    txHash: { type: String, required: true },
    eventType: { type: String, enum: EVENT_TYPES, required: true },
    reqId: { type: String, index: true },
    requirementTitle: String,
    relatedReqId: String,
    relatedRequirementTitle: String,
    previousStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    triggeringSignal: { type: String, default: null },
    actor: { type: String, default: null },
    timestamp: { type: Date, required: true },
    blockNumber: { type: Number, required: true },
    previousBlockHash: { type: String, required: true },
    isPlaceholder: { type: Boolean, default: true },
  },
  { collection: 'ledger_entries' }
);
ledgerEntrySchema.index({ projectId: 1, timestamp: -1 });
ledgerEntrySchema.index({ projectId: 1, historyId: 1 }, { unique: true, partialFilterExpression: { historyId: { $type: 'string' } } });

module.exports = {
  LedgerEntry: mongoose.models.LedgerEntry || mongoose.model('LedgerEntry', ledgerEntrySchema),
  EVENT_TYPES,
};
