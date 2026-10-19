'use strict';
const mongoose = require('mongoose');

const STATUSES = ['Confirmed', 'At Risk', 'Modified', 'Dropped'];
const GRANULARITIES = ['Daily Task', 'Weekly Workload', 'Sprint Commitment'];

const requirementSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    reqId: { type: String, required: true }, // e.g. RET-R01; exposed as "id" by the API
    title: { type: String, required: true },
    description: { type: String, default: '' },
    type: { type: String, enum: ['FR', 'NFR'] },
    groupId: { type: String, default: '' }, // theme group; exposed as "cluster"
    granularity: { type: String, enum: GRANULARITIES },
    initialStatus: { type: String, enum: STATUSES, default: 'Confirmed' },
    finalStatus: { type: String, enum: STATUSES }, // from the CSV, kept for evaluating the status engine
    liveStatus: { type: String, enum: STATUSES, default: 'Confirmed' }, // current status
    resourceRole: { type: String, default: 'Unassigned' }, // most frequent author_role among its signals
    split: { type: String, enum: ['train', 'val', 'test'] }, // dataset split, kept from the CSV
  },
  { timestamps: true, collection: 'requirements' }
);
requirementSchema.index({ projectId: 1, reqId: 1 }, { unique: true });

// One row per signal that refers to a requirement (scenario_status_history.csv).
const statusHistorySchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    historyId: { type: String, required: true },
    reqId: { type: String, required: true },
    signalId: { type: String, required: true },
    timestamp: { type: Date, required: true },
    label: String,
    fromStatus: String,
    toStatus: String,
    statusChanged: Boolean,
    source: String,
    authorRole: String,
  },
  { collection: 'status_history' }
);
statusHistorySchema.index({ projectId: 1, historyId: 1 }, { unique: true });
statusHistorySchema.index({ projectId: 1, reqId: 1, timestamp: 1 });

module.exports = {
  Requirement: mongoose.models.Requirement || mongoose.model('Requirement', requirementSchema),
  StatusHistory: mongoose.models.StatusHistory || mongoose.model('StatusHistory', statusHistorySchema),
  STATUSES,
  GRANULARITIES,
};
