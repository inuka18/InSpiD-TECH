'use strict';
const mongoose = require('mongoose');

const scheduleLeaveSchema = new mongoose.Schema({
  projectId: { type: String, required: true, index: true },
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  leaveDate: { type: Date, required: true },
  leaveHours: { type: Number, min: 0.5, max: 24, required: true },
  leaveType: { type: String, enum: ['full-day', 'half-day', 'custom'], required: true },
  affectedTaskIds: { type: [String], default: [] },
  taskChanges: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, collection: 'schedule_leaves' });

scheduleLeaveSchema.index({ projectId: 1, memberId: 1, leaveDate: 1 });

module.exports = { ScheduleLeave: mongoose.models.ScheduleLeave || mongoose.model('ScheduleLeave', scheduleLeaveSchema) };
