'use strict';
const mongoose = require('mongoose');

const scheduleVersionSchema = new mongoose.Schema({
  projectId: { type: String, required: true, index: true },
  label: { type: String, required: true, maxlength: 120 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  tasks: { type: [mongoose.Schema.Types.Mixed], default: [] },
  taskCount: { type: Number, default: 0 },
}, { timestamps: true, collection: 'schedule_versions' });

scheduleVersionSchema.index({ projectId: 1, createdAt: -1 });

module.exports = { ScheduleVersion: mongoose.models.ScheduleVersion || mongoose.model('ScheduleVersion', scheduleVersionSchema) };
