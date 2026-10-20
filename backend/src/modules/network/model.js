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

module.exports = {
  RequirementLink: mongoose.models.RequirementLink || mongoose.model('RequirementLink', requirementLinkSchema),
  NetworkGroundTruth: mongoose.models.NetworkGroundTruth || mongoose.model('NetworkGroundTruth', groundTruthSchema),
  ManualLink: mongoose.models.ManualLink || mongoose.model('ManualLink', manualLinkSchema),
};
