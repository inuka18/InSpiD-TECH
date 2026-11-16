'use strict';
// Mounted at /api/v1/projects/:projectId/baselines and /api/v1/projects/:projectId/alignment.
const express = require('express');
const { z } = require('zod');
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { ok, wrap } = require('../../shared/response');
const baselines = require('./baselines');
const network = require('./service');
const { getAlignment } = require('./alignmentService');

const createBody = z.object({ name: z.string().trim().min(1).max(80) });
const idParams = z.object({ projectId: z.string().min(1), baselineId: z.string().min(1) });
const alignmentQuery = z.object({ baselineId: z.string().min(1).optional() });

const baselineRouter = express.Router({ mergeParams: true });
baselineRouter.get('/', wrap(async (req, res) => ok(res, await baselines.list(req.params.projectId))));
baselineRouter.post('/', requireRole('PM'), validate({ body: createBody }),
  wrap(async (req, res) => ok(res, await network.createBaseline(req.params.projectId, req.body.name, req.user), 201)));
baselineRouter.get('/:baselineId', validate({ params: idParams }), wrap(async (req, res) => ok(res, await baselines.getApi(req.params.projectId, req.params.baselineId))));
baselineRouter.get('/:baselineId/diff', validate({ params: idParams }), wrap(async (req, res) => ok(res, await baselines.diff(req.params.projectId, req.params.baselineId))));

const alignmentRouter = express.Router({ mergeParams: true });
alignmentRouter.get('/', validate({ query: alignmentQuery }), wrap(async (req, res) => ok(res, await getAlignment(req.params.projectId, req.query.baselineId))));

module.exports = { baselineRouter, alignmentRouter };
