'use strict';
const { z } = require('zod');
const { SOURCE_TYPES, REVIEW_STATUSES } = require('./model');

const signalParams = z.object({ projectId: z.string().min(1), signalId: z.string().min(1) });

const listQuery = z.object({
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  requirementId: z.string().min(1).optional(),
});

const createSignalBody = z.object({
  source: z.enum(SOURCE_TYPES),
  authorRole: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(5000),
  timestamp: z.coerce.date().optional(),
});

const reviewBody = z.object({ decision: z.enum(['accept', 'reject']) });

module.exports = { signalParams, listQuery, createSignalBody, reviewBody };
