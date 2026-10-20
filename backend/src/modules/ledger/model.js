'use strict';
const mongoose = require('mongoose');

// Stored codes. Older rows (before the hash chain) hold the display strings below; the API maps both.
const EVENT_TYPES = ['STATUS_CHANGE', 'REQUIREMENT_CREATED', 'MANUAL_LINK', 'NETWORK_UPDATE'];
const LINK_ACTIONS = ['added', 'removed'];
const LEGACY_EVENT_TYPES = {
  'Status Change': { eventType: 'STATUS_CHANGE' },
  'Requirement Created': { eventType: 'REQUIREMENT_CREATED' },
  'Manual Link Added': { eventType: 'MANUAL_LINK', linkAction: 'added' },
  'Manual Link Removed': { eventType: 'MANUAL_LINK', linkAction: 'removed' },
};

// PLACEHOLDER LEDGER: these documents are NOT blockchain transactions (onChain is false).
// txHash = sha256 of a canonical JSON of the entry fields + previousBlockHash (see service.js), so the chain
// can be verified. A later step replaces appendLedgerEntry() with real Hardhat transactions.
const ledgerEntrySchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    historyId: { type: String }, // set for entries built from the seed's status_history (idempotent seeding)
    txHash: { type: String, required: true },
    eventType: { type: String, required: true }, // EVENT_TYPES; older rows may hold the legacy display strings
    linkAction: { type: String, enum: LINK_ACTIONS, default: null }, // MANUAL_LINK only
    reqId: { type: String, index: true },
    requirementTitle: String,
    relatedReqId: String,
    relatedRequirementTitle: String,
    previousStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    triggeringSignal: { type: String, default: null }, // the signal text (or the human reason for a manual link)
    triggeringSignalId: { type: String, default: null }, // e.g. SC-2299
    actor: { type: String, default: null },
    timestamp: { type: Date, required: true },
    blockNumber: { type: Number, required: true },
    previousBlockHash: { type: String, required: true },
    onChain: { type: Boolean, default: false },
    isPlaceholder: { type: Boolean, default: true },
    createdVia: { type: String, enum: ['seed', 'api'], default: 'api' }, // rechain only rewrites 'seed' rows
  },
  { collection: 'ledger_entries' }
);
ledgerEntrySchema.index({ projectId: 1, timestamp: -1 });
ledgerEntrySchema.index({ projectId: 1, blockNumber: 1 }, { unique: true });
ledgerEntrySchema.index({ projectId: 1, historyId: 1 }, { unique: true, partialFilterExpression: { historyId: { $type: 'string' } } });

module.exports = {
  LedgerEntry: mongoose.models.LedgerEntry || mongoose.model('LedgerEntry', ledgerEntrySchema),
  EVENT_TYPES,
  LINK_ACTIONS,
  LEGACY_EVENT_TYPES,
};
