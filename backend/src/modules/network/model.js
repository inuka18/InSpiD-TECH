'use strict';
const mongoose = require('mongoose');

// Automatic links, loaded from scenario_related_pairs.csv (relation_type: same_group | dependency).
const requirementLinkSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    reqA: { type: String, required: true },
    reqB: { type: String, required: true },
    relationType: { type: String, enum: ['same_group', 'dependency'], required: true },
  },
  { timestamps: true, collection: 'requirement_links' }
);
requirementLinkSchema.index({ projectId: 1, reqA: 1, reqB: 1, relationType: 1 }, { unique: true });

// PM-authored links layered on top of the automatic ones.
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
  ManualLink: mongoose.models.ManualLink || mongoose.model('ManualLink', manualLinkSchema),
};
