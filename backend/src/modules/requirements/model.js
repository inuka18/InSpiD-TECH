'use strict';
const mongoose = require('mongoose');

const STATUSES = ['Confirmed', 'At Risk', 'Modified', 'Dropped'];
const GRANULARITIES = ['Daily Task', 'Weekly Workload', 'Sprint Commitment'];

// Signal profile: moving average of the embeddings of the signals applied to a requirement (see network/profile.js).
const signalProfileSchema = new mongoose.Schema(
  { vector: { type: [Number], default: [] }, count: { type: Number, default: 0 }, updatedAt: { type: Date } },
  { _id: false }
);

const requirementSchema = new mongoose.Schema(
  {
    projectId: { type: String, required: true, index: true },
    reqId: { type: String, required: true }, // e.g. RET-R01; exposed as "id" by the API
    title: { type: String, required: true },
    description: { type: String, default: '' },
    type: { type: String, enum: ['FR', 'NFR'] },
    groupId: { type: String, default: '' }, // CSV group_id: the ground-truth ANSWER KEY. Never used to form or name clusters.
    clusterId: { type: String, default: null }, // computed cluster, e.g. cluster-2 (network service)
    clusterLabel: { type: String, default: null }, // e.g. "Cluster 2 (payments, wallet)"
    embedding: { type: [Number], select: false }, // MiniLM vector of title + description (cache for the network)
    embeddingTextHash: { type: String, default: null }, // sha1 of the text the embedding was computed from
    signalProfile: { type: signalProfileSchema, select: false, default: undefined }, // hidden like the embedding; null until a signal is applied
    granularity: { type: String, enum: GRANULARITIES },
    sourceDocument: { type: new mongoose.Schema({ name: String, sourceId: String }, { _id: false }), default: undefined }, // set when imported from an SRS: { name, sourceId }
    priority: { type: String, enum: ['High', 'Medium', 'Low'] }, // optional; set when a requirement candidate is approved
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
    resourceRole: String, // the author role of the triggering signal
    granularity: String, // the requirement's granularity when the row was written
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
