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
