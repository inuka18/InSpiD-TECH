'use strict';
const mongoose = require('mongoose');

// Computed links (Pathfinder over MiniLM similarity). reqA < reqB. Never contains the CSV pairs.
const requirementLinkSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    reqA: { type: String, required: true },
    reqB: { type: String, required: true },
    relationType: { type: String, default: 'semantic' }, // legacy CSV rows held same_group / dependency
    kind: { type: String, enum: ['pathfinder'], default: 'pathfinder' }, // legacy CSV rows have no kind
    weight: { type: Number }, // cosine similarity of the two requirement texts
    computedAt: { type: Date },
  },
  { timestamps: true, collection: 'requirement_links' }
);
requirementLinkSchema.index({ projectId: 1, reqA: 1, reqB: 1, relationType: 1 }, { unique: true });

// The ANSWER KEY from scenario_related_pairs.csv (same_group | dependency). Used only by the evaluation
// script (npm run network:evaluate). It is never returned as network links.
const groundTruthSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    reqA: { type: String, required: true },
    reqB: { type: String, required: true },
    relationType: { type: String, enum: ['same_group', 'dependency'], required: true },
  },
  { timestamps: true, collection: 'network_ground_truth' }
);
groundTruthSchema.index({ projectId: 1, reqA: 1, reqB: 1, relationType: 1 }, { unique: true });

// PM-authored links layered on top of the computed ones. Recomputation never touches these.
const manualLinkSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    linkId: { type: String, required: true, unique: true },
    sourceId: { type: String, required: true },
    targetId: { type: String, required: true },
    reason: { type: String, required: true },
    createdBy: { type: String, required: true }, // user email
  },
  { timestamps: true, collection: 'manual_links' }
);

// Evidence that two requirements belong together, written when a signal is APPLIED (never for rejected, pending or seeded signals).
const signalEvidenceSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    signalId: { type: String, required: true },
    kind: { type: String, enum: ['coref', 'idmention'], required: true },
    reqA: { type: String, required: true }, // reqA < reqB
    reqB: { type: String, required: true },
    similarityA: { type: Number, default: null }, // the matcher's similarity of the signal to reqA / reqB (null when it was not a candidate)
    similarityB: { type: Number, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'signal_evidence' }
);
signalEvidenceSchema.index({ projectId: 1, signalId: 1, reqA: 1, reqB: 1 }, { unique: true }); // one row per signal and pair
signalEvidenceSchema.index({ projectId: 1, reqA: 1, reqB: 1 });

// A frozen copy of the computed network and the requirement states, to measure drift against.
const baselineSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    baselineId: { type: String, required: true },
    name: { type: String, required: true },
    initial: { type: Boolean, default: undefined }, // true only for the automatic "Initial baseline"; unset otherwise (see the partial index)
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: String, required: true }, // user email, or "system"
    ledgerBlock: { type: Number, default: null }, // blockNumber of its BASELINE_CREATED entry: network updates after it count as drift
    requirements: [{
      _id: false, id: String, title: String, description: String, type: { type: String }, status: String, granularity: String, resourceRole: String,
    }],
    links: [{ _id: false, source: String, target: String, weight: Number }],
  },
  { collection: 'baselines' }
);
baselineSchema.index({ projectId: 1, baselineId: 1 }, { unique: true });
// At most one initial baseline per project: concurrent first GET /network calls cannot create two.
baselineSchema.index({ projectId: 1, initial: 1 }, { unique: true, partialFilterExpression: { initial: true } });

// Per project: is the signal-informed network behind (ai-service was down), and which applied signals still need their profile update.
const networkStateSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, unique: true },
    stale: { type: Boolean, default: false },
    pendingSignalIds: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'network_state' }
);

module.exports = {
  SignalEvidence: mongoose.models.SignalEvidence || mongoose.model('SignalEvidence', signalEvidenceSchema),
  Baseline: mongoose.models.Baseline || mongoose.model('Baseline', baselineSchema),
  NetworkState: mongoose.models.NetworkState || mongoose.model('NetworkState', networkStateSchema),
  RequirementLink: mongoose.models.RequirementLink || mongoose.model('RequirementLink', requirementLinkSchema),
  NetworkGroundTruth: mongoose.models.NetworkGroundTruth || mongoose.model('NetworkGroundTruth', groundTruthSchema),
  ManualLink: mongoose.models.ManualLink || mongoose.model('ManualLink', manualLinkSchema),
};
