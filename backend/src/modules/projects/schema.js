'use strict';
const { z } = require('zod');

const projectIdParam = z.object({ projectId: z.string().min(1) });

const createProjectBody = z.object({
  projectId: z.string().regex(/^[A-Z0-9-]{3,20}$/, 'Use 3-20 chars: A-Z, 0-9, "-"'),
  name: z.string().trim().min(1).max(120),
  domain: z.string().trim().max(80).optional(),
  description: z.string().trim().max(1000).optional(),
});

module.exports = { projectIdParam, createProjectBody };
