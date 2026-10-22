'use strict';
// Mounted at /api/v1/projects/:projectId/requirement-candidates (any member reads; review is PM only).
const router = require('express').Router({ mergeParams: true });
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { candidateParams, listQuery, reviewBody } = require('./schema');
const c = require('./controller');

router.get('/', validate({ query: listQuery }), c.list);
router.post('/:candidateId/review', requireRole('PM'), validate({ params: candidateParams, body: reviewBody }), c.review);

module.exports = router;
