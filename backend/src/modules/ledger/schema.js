'use strict';
const { z } = require('zod');

const reqParams = z.object({ projectId: z.string().min(1), reqId: z.string().min(1) });

module.exports = { reqParams };
