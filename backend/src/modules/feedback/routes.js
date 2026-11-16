'use strict';
// Mounted at /api/v1/projects/:projectId/feedback (PM only). Feedback documents are written by the signal review.
const router = require('express').Router({ mergeParams: true });
const { requireRole } = require('../../middleware/auth');
const signalsController = require('../signals/controller');

router.get('/export', requireRole('PM'), signalsController.exportFeedback);

module.exports = router;
