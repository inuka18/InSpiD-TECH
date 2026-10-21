'use strict';
const { z } = require('zod');

const createManualLinkBody = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});
const linkParams = z.object({ projectId: z.string().min(1), linkId: z.string().min(1) });

module.exports = { createManualLinkBody, linkParams };
