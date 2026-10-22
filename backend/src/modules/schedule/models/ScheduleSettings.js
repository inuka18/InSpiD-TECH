'use strict';
const mongoose = require('mongoose');

const scheduleSettingsSchema = new mongoose.Schema({
  projectId: { type: String, required: true, unique: true },
  workdays: { type: [Number], default: [1, 2, 3, 4, 5] },
  hoursPerDay: { type: Number, min: 1, max: 24, default: 8 },
  startHour: { type: Number, min: 0, max: 23, default: 9 },
  sprintDays: { type: Number, min: 1, max: 60, default: 10 },
  projectStart: { type: Date, default: null },
  firstSprintNumber: { type: Number, min: 1, default: 1 },
}, { timestamps: true, collection: 'schedule_settings' });

module.exports = { ScheduleSettings: mongoose.models.ScheduleSettings || mongoose.model('ScheduleSettings', scheduleSettingsSchema) };
