'use strict';
// Mounted at /api/v1/projects/:projectId/signals.
const router = require('express').Router({ mergeParams: true });
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { signalParams, listQuery, createSignalBody, reviewBody } = require('./schema');
const c = require('./controller');

router.get('/', validate({ query: listQuery }), c.list);
router.get('/:signalId', validate({ params: signalParams }), c.get);
router.post('/', validate({ body: createSignalBody }), c.create);
router.post('/:signalId/review', requireRole('PM'), validate({ params: signalParams, body: reviewBody }), c.review);

module.exports = router;
