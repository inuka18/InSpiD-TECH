'use strict';
const { z } = require('zod');

// Self-registration always creates a TeamMember. PM accounts come from the seed script;
// a PM then adds members to projects via POST /projects/:projectId/team.
const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
  jobTitle: z.string().trim().max(100).optional(),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

module.exports = { registerBody, loginBody };
