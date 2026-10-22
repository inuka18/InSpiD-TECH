'use strict';
const { z } = require('zod');
const { CANDIDATE_STATUSES } = require('./model');

const candidateParams = z.object({ projectId: z.string().min(1), candidateId: z.string().regex(/^RC-\d{4,}$/, 'candidateId looks like RC-0001') });

const listQuery = z.object({ status: z.enum(CANDIDATE_STATUSES).optional() });

// approve: title / description / type / priority are the PM's edits (the suggestion is used for what is left out).
// merge: mergeIntoRequirementId is required. reject: only the note.
const reviewBody = z.object({
  action: z.enum(['approve', 'merge', 'reject']),
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  type: z.enum(['FR', 'NFR']).optional(),
  priority: z.enum(['High', 'Medium', 'Low']).optional(),
  mergeIntoRequirementId: z.string().trim().min(1).optional(),
  note: z.string().trim().max(1000).optional(),
}).refine((b) => b.action !== 'merge' || b.mergeIntoRequirementId, { message: 'merge needs mergeIntoRequirementId', path: ['mergeIntoRequirementId'] });

module.exports = { candidateParams, listQuery, reviewBody };
