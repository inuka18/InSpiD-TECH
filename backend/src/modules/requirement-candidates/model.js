'use strict';
const mongoose = require('mongoose');

const STATUSES = ['pending', 'approved', 'merged', 'rejected'];

// A possible NEW requirement: one or more signals that no existing requirement covers (see signals/newRequirement.js).
// Nothing changes in the requirements until a PM approves or merges it.
const candidateSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true },
    candidateId: { type: String, required: true }, // RC-0001 per project
    title: { type: String, required: true },
    description: { type: String, default: '' },
    type: { type: String, enum: ['FR', 'NFR'], default: 'FR' }, // a keyword guess the PM can change
    centroid: { type: [Number], select: false, default: undefined }, // mean embedding of the evidence (hidden from default queries)
    evidence: {
      type: [new mongoose.Schema({
        signalId: String, text: String, source: String, authorRole: String, timestamp: Date, similarity: Number, // similarity = to the candidate when it was attached
      }, { _id: false })],
      default: [],
    },
    closestRequirementId: { type: String, default: null },
    closestSimilarity: { type: Number, default: null },
    novelTokens: { type: [String], default: [] },
    status: { type: String, enum: STATUSES, default: 'pending' },
    createdRequirementId: { type: String, default: null },
    mergedInto: { type: String, default: null },
    decidedBy: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'requirement_candidates' }
);
candidateSchema.index({ projectId: 1, candidateId: 1 }, { unique: true });
candidateSchema.index({ projectId: 1, status: 1 });

module.exports = {
  RequirementCandidate: mongoose.models.RequirementCandidate || mongoose.model('RequirementCandidate', candidateSchema),
  CANDIDATE_STATUSES: STATUSES,
};
