'use strict';
const { z } = require('zod');

const addMemberBody = z.object({ email: z.string().email() });
const memberParams = z.object({ projectId: z.string().min(1), userId: z.string().regex(/^[a-f0-9]{24}$/, 'Invalid user id') });

module.exports = { addMemberBody, memberParams };
