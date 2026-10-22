'use strict';
const mongoose = require('mongoose');

const scheduleTaskSchema = new mongoose.Schema({
  projectId: { type: String, required: true, index: true },
  taskId: { type: String, required: true },
  requirementId: { type: String, default: null, index: true },
  phaseId: { type: String, default: '' },
  phaseName: { type: String, default: '' },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  role: { type: String, default: '' },
  estimateMinutes: { type: Number, required: true, min: 1 },
  status: { type: String, enum: ['not-started', 'in-progress', 'review', 'done'], default: 'not-started' },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  assigneeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  baselineStart: { type: Date, required: true, immutable: true },
  baselineEnd: { type: Date, required: true, immutable: true },
  dependencies: { type: [String], default: [] },
  sprintNumber: { type: Number, min: 1, default: null },
  plannedSprintNumber: { type: Number, min: 1, default: null },
  critical: { type: Boolean, default: false },
  milestone: { type: Boolean, default: false },
  originalAssigneeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true, collection: 'schedule_tasks' });

scheduleTaskSchema.index({ projectId: 1, taskId: 1 }, { unique: true });
scheduleTaskSchema.index({ projectId: 1, requirementId: 1, start: 1 });
scheduleTaskSchema.index({ projectId: 1, plannedSprintNumber: 1 });

module.exports = { ScheduleTask: mongoose.models.ScheduleTask || mongoose.model('ScheduleTask', scheduleTaskSchema) };
