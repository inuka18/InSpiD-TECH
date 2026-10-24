'use strict';
const { z } = require('zod');
const { GRANULARITIES } = require('./model');

const reqParams = z.object({ projectId: z.string().min(1), reqId: z.string().min(1) });

const createRequirementBody = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(['FR', 'NFR']).optional(),
  cluster: z.string().trim().max(80).optional(),
  granularity: z.enum(GRANULARITIES).default('Sprint Commitment'),
  resourceRole: z.string().trim().max(80).optional(),
  priority: z.enum(['High', 'Medium', 'Low']).optional(),
});

// Status is NOT editable here: only the status engine changes it (TODO).
const updateRequirementBody = z
  .object({
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000),
    cluster: z.string().trim().max(80),
    granularity: z.enum(GRANULARITIES),
    resourceRole: z.string().trim().max(80),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one field');

module.exports = { reqParams, createRequirementBody, updateRequirementBody };

// ---- SRS import (confirm). documentId = the sha256 returned by the preview; it makes a double click harmless.
const importItem = z.object({
  sourceId: z.string().trim().max(80).optional().default(''),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional().default(''),
  type: z.enum(['FR', 'NFR']),
  featureArea: z.string().trim().max(120).optional().default(''),
  priority: z.string().trim().max(20).optional().default(''), // MoSCoW (Must / Should / Could / Won't) or High / Medium / Low
});
const importConfirmBody = z.object({
  documentId: z.string().regex(/^[a-f0-9]{64}$/, 'documentId must be the sha256 returned by the preview'),
  documentName: z.string().trim().min(1).max(200),
  force: z.boolean().optional(),
  items: z.array(importItem).min(1).max(300),
});
module.exports.importConfirmBody = importConfirmBody;
