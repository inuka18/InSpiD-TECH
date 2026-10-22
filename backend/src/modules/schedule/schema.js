'use strict';
const { z } = require('zod');

const projectParams = z.object({ projectId: z.string().min(1).max(80) });
const taskParams = projectParams.extend({ taskId: z.string().min(1).max(80) });
const versionParams = projectParams.extend({ versionId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid version id') });
const isoDate = z.string().datetime({ offset: true });
const memberIds = z.array(z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid user id')).default([]);

const createTaskBody = z.object({
  taskId: z.string().trim().min(1).max(80),
  requirementId: z.string().trim().min(1).max(80).nullable().optional(),
  phaseId: z.string().trim().max(80).optional(),
  phaseName: z.string().trim().max(120).optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  role: z.string().trim().max(100).optional(),
  estimateMinutes: z.number().int().min(1).max(1000000),
  status: z.enum(['not-started', 'in-progress', 'review', 'done']).optional(),
  progress: z.number().min(0).max(100).optional(),
  assigneeIds: memberIds,
  start: isoDate,
  end: isoDate,
  baselineStart: isoDate.optional(),
  baselineEnd: isoDate.optional(),
  dependencies: z.array(z.string().trim().min(1).max(80)).default([]),
  sprintNumber: z.number().int().min(1).nullable().optional(),
  critical: z.boolean().optional(),
  milestone: z.boolean().optional(),
});
const importTasksBody = z.object({ tasks: z.array(createTaskBody).min(1).max(500) }).refine(
  ({ tasks }) => new Set(tasks.map((task) => task.taskId)).size === tasks.length,
  'Imported task ids must be unique'
);

const updateTaskBody = z.object({
  requirementId: z.string().trim().min(1).max(80).nullable(),
  phaseId: z.string().trim().max(80),
  phaseName: z.string().trim().max(120),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  role: z.string().trim().max(100),
  estimateMinutes: z.number().int().min(1).max(1000000),
  status: z.enum(['not-started', 'in-progress', 'review', 'done']),
  progress: z.number().min(0).max(100),
  assigneeIds: memberIds,
  start: isoDate,
  end: isoDate,
  dependencies: z.array(z.string().trim().min(1).max(80)),
  sprintNumber: z.number().int().min(1).nullable(),
  critical: z.boolean(),
  milestone: z.boolean(),
}).partial().refine((body) => Object.keys(body).length > 0, 'Send at least one field');

const settingsBody = z.object({
  workdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine((days) => new Set(days).size === days.length, 'Working days must be unique'),
  hoursPerDay: z.number().min(1).max(24),
  startHour: z.number().int().min(0).max(23).optional(),
  sprintDays: z.number().int().min(1).max(60),
  projectStart: isoDate.optional(),
  firstSprintNumber: z.number().int().min(1).optional(),
});

const saveVersionBody = z.object({ label: z.string().trim().min(1).max(120) }).default({ label: 'Manual schedule snapshot' });
const leaveBody = z.object({
  memberId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid user id'),
  leaveDate: isoDate,
  leaveType: z.enum(['full-day', 'half-day', 'custom']),
  customHours: z.number().min(0.5).max(24).optional(),
});

module.exports = { projectParams, taskParams, versionParams, createTaskBody, importTasksBody, updateTaskBody, settingsBody, saveVersionBody, leaveBody };
