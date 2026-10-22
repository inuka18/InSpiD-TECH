'use strict';
const mongoose = require('mongoose');

const CLASSIFICATIONS = ['Constraint', 'Expectation', 'Completion', 'Conflict', 'None'];
const SOURCE_TYPES = ['Standup', 'Slack', 'Email', 'Teams', 'Jira Comment'];
const REVIEW_STATUSES = ['pending', 'accepted', 'rejected'];
const REVIEW_ACTIONS = ['accept', 'reject', 'correct'];
const FEEDBACK_KINDS = ['signal', 'requirement-candidate'];

const signalSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    signalId: { type: String, required: true }, // SC-0001...
    source: { type: String, enum: SOURCE_TYPES, required: true },
    authorRole: { type: String, required: true }, // no names in the dataset
    timestamp: { type: Date, required: true },
    text: { type: String, required: true },
    // Effective label. null = never classified (the AI service was down); "None" is a real label, not missing.
    label: { type: String, enum: CLASSIFICATIONS, default: null },
    reqId: { type: String, default: null }, // requirement the message refers to (null = unmapped)
    resultingStatus: { type: String, default: null },
    split: { type: String }, // train | val | test, kept from the CSV
    batch: { type: String }, // A | B, kept from the CSV
    confidence: { type: Number, default: null }, // model confidence, integer 0-100 (null for seeded rows)
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: 'accepted' },
    reviewedBy: { type: String, default: null }, // null while auto-accepted
    reviewedAt: { type: Date, default: null },
    // ---- set for signals created through the API
    seeded: { type: Boolean, default: false }, // true = loaded by the seed; its effect is already in the data
    modelLabel: { type: String, default: null }, // what the model said (label can later be corrected by a PM)
    modelVersion: { type: String, default: null },
    autoAcceptThreshold: { type: Number, default: null }, // threshold (0-100) in force when it was ingested
    autoApplyMinSimilarity: { type: Number, default: null }, // similarity floor for auto-applying a similarity match
    matchMethod: { type: String, enum: ['auto', 'manual'], default: null },
    matchSimilarity: { type: Number, default: null },
    matchAlternatives: { type: [{ _id: false, requirementId: String, similarity: Number }], default: [] },
    proposedStatus: { type: String, default: null },
    applied: { type: Boolean, default: false }, // the status rule was run and committed for this signal
    reviewAction: { type: String, enum: REVIEW_ACTIONS, default: null },
    reviewNote: { type: String, default: null },
    statusNotReversed: { type: Boolean, default: false }, // PM rejected/corrected AFTER the status change was applied
    // The uploaded document this signal came from (the file itself is never stored): { id: sha256 of the text, name }.
    sourceDocument: { type: new mongoose.Schema({ id: String, name: String }, { _id: false }), default: null },
    // ---- new-requirement detector (signals/newRequirement.js). candidateId = the requirement candidate it is evidence for.
    candidateId: { type: String, default: null },
    newRequirement: {
      type: new mongoose.Schema({
        isCandidate: Boolean,
        reason: String, // "no close requirement" | "new terms: koko" | "similar to a rejected candidate"
        closestRequirementId: String,
        similarity: Number,
        novelTokens: [String],
      }, { _id: false }),
      default: null,
    },
    // Repeat of a REJECTED candidate: stored and pending, but hidden from the default list and pending count.
    suppressed: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'signals' }
);
signalSchema.index({ projectId: 1, signalId: 1 }, { unique: true });
signalSchema.index({ projectId: 1, timestamp: -1 });
signalSchema.index({ projectId: 1, 'sourceDocument.id': 1 }, { sparse: true });
signalSchema.index({ projectId: 1, candidateId: 1 }, { sparse: true });

// Every PM review action is stored here; the export turns accept/correct rows into retraining data.
const feedbackSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    // kind 'requirement-candidate' = a PM decision on a requirement candidate (signalId / text then describe its first evidence).
    // These rows are never retraining data: the export only takes kind 'signal'.
    kind: { type: String, enum: FEEDBACK_KINDS, default: 'signal' },
    signalId: { type: String, default: null },
    text: { type: String, required: true },
    source: String,
    authorRole: String,
    modelLabel: { type: String, default: null },
    modelVersion: { type: String, default: null },
    modelConfidence: { type: Number, default: null },
    finalLabel: { type: String, default: null }, // null for reject
    action: { type: String, enum: [...REVIEW_ACTIONS, 'approve', 'merge'], required: true },
    reviewerId: { type: String, required: true },
    // ---- requirement-candidate decisions: what the detector saw, so decisions can later improve it
    candidateId: { type: String, default: null },
    candidate: { type: mongoose.Schema.Types.Mixed, default: undefined }, // { title, closestRequirementId, closestSimilarity, novelTokens, evidenceCount, createdRequirementId, mergedInto, note }
    signalSeeded: { type: Boolean, default: false }, // seeded rows are dataset text; the export skips them
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'feedback' }
);
feedbackSchema.index({ projectId: 1, createdAt: 1 });

module.exports = {
  Signal: mongoose.models.Signal || mongoose.model('Signal', signalSchema),
  Feedback: mongoose.models.Feedback || mongoose.model('Feedback', feedbackSchema),
  CLASSIFICATIONS,
  SOURCE_TYPES,
  REVIEW_STATUSES,
  REVIEW_ACTIONS,
  FEEDBACK_KINDS,
};
