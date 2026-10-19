'use strict';
const mongoose = require('mongoose');

const CLASSIFICATIONS = ['Constraint', 'Expectation', 'Completion', 'Conflict', 'None'];
const SOURCE_TYPES = ['Standup', 'Slack', 'Email', 'Teams', 'Jira Comment'];
const REVIEW_STATUSES = ['pending', 'accepted', 'rejected'];

const signalSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    signalId: { type: String, required: true }, // SC-0001...
    source: { type: String, enum: SOURCE_TYPES, required: true },
    authorRole: { type: String, required: true }, // no names in the dataset
    timestamp: { type: Date, required: true },
    text: { type: String, required: true },
    label: { type: String, enum: CLASSIFICATIONS, required: true }, // "None" is a real label, not missing
    reqId: { type: String, default: null }, // requirement the message refers to
    resultingStatus: { type: String, default: null },
    split: { type: String }, // train | val | test, kept from the CSV
    batch: { type: String }, // A | B, kept from the CSV
    confidence: { type: Number, default: null }, // TODO: filled by the classifier
    reviewStatus: { type: String, enum: REVIEW_STATUSES, default: 'accepted' },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'signals' }
);
signalSchema.index({ projectId: 1, signalId: 1 }, { unique: true });
signalSchema.index({ projectId: 1, timestamp: -1 });

module.exports = {
  Signal: mongoose.models.Signal || mongoose.model('Signal', signalSchema),
  CLASSIFICATIONS,
  SOURCE_TYPES,
  REVIEW_STATUSES,
};
