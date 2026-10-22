'use strict';
const { z } = require('zod');
const { SOURCE_TYPES, REVIEW_STATUSES, CLASSIFICATIONS } = require('./model');

const signalParams = z.object({ projectId: z.string().min(1), signalId: z.string().min(1) });

const listQuery = z.object({
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  requirementId: z.string().min(1).optional(),
  includeSuppressed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), // repeats of a rejected candidate
});

// authorRole defaults to the user's job title, timestamp to now (done in the service).
const createSignalBody = z.object({
  source: z.enum(SOURCE_TYPES),
  text: z.string().trim().min(1).max(5000),
  authorRole: z.string().trim().min(1).max(80).optional(),
  timestamp: z.coerce.date().optional(),
  requirementId: z.string().trim().min(1).optional(),
});

// `decision` (accept|reject) is the old body shape and still works as an alias of `action`.
const reviewBody = z.preprocess(
  (b) => (b && typeof b === 'object' && b.action === undefined && b.decision !== undefined ? { ...b, action: b.decision } : b),
  z.object({
    action: z.enum(['accept', 'reject', 'correct']),
    correctedLabel: z.enum(CLASSIFICATIONS).optional(),
    correctedRequirementId: z.string().trim().min(1).optional(),
    note: z.string().trim().max(1000).optional(),
  }).refine((b) => b.action !== 'correct' || b.correctedLabel || b.correctedRequirementId, {
    message: 'correct needs correctedLabel and/or correctedRequirementId',
  })
);

// ---- documents. `extract` takes multipart form fields (strings) or JSON, so every field is optional text.
const SOURCE_DEFAULT = 'Standup';
const extractBody = z.object({
  text: z.string().max(2_000_000).optional(),
  name: z.string().trim().max(200).optional(),
  source: z.enum(SOURCE_TYPES).default(SOURCE_DEFAULT),
  authorRole: z.string().trim().max(80).optional(),
  documentDate: z.coerce.date().optional(),
});

const bulkBody = z.object({
  documentId: z.string().regex(/^[a-f0-9]{64}$/, 'documentId must be the sha256 returned by extract'),
  name: z.string().trim().min(1).max(200),
  source: z.enum(SOURCE_TYPES).default(SOURCE_DEFAULT),
  authorRole: z.string().trim().max(80).optional(),
  timestamp: z.coerce.date().optional(),
  force: z.boolean().optional(),
  items: z.array(z.object({
    text: z.string().trim().min(1).max(5000),
    requirementId: z.string().trim().min(1).optional(),
  })).min(1).max(100),
});

module.exports = { signalParams, listQuery, createSignalBody, reviewBody, extractBody, bulkBody };
