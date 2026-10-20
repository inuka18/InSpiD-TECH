'use strict';
// Mounted at /api/v1/projects/:projectId/signals (any project member can post; review is PM only).
const router = require('express').Router({ mergeParams: true });
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { signalParams, listQuery, createSignalBody, reviewBody } = require('./schema');
const c = require('./controller');

router.get('/', validate({ query: listQuery }), c.list);
router.post('/preview', validate({ body: createSignalBody }), c.preview); // same answer as POST /, saves nothing
router.post('/', validate({ body: createSignalBody }), c.create);
router.get('/:signalId', validate({ params: signalParams }), c.get);
router.post('/:signalId/review', requireRole('PM'), validate({ params: signalParams, body: reviewBody }), c.review);

module.exports = router;
