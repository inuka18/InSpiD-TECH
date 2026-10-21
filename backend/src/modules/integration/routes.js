'use strict';
// Mounted at /api/v1/projects/:projectId (auth + membership checked by the parent). READ-ONLY.
const router = require('express').Router({ mergeParams: true });
const c = require('./controller');

router.get('/live-state', c.liveState);
router.get('/network', c.network);
router.get('/ledger', c.ledger);
router.get('/schedule-baseline', c.scheduleBaseline);

module.exports = router;
