'use strict';
// Mounted at /api/v1/projects/:projectId/network.
// The graph itself (GET /projects/:projectId/network) is served by the integration module (-> service.getNetwork).
const router = require('express').Router({ mergeParams: true });
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { createManualLinkBody, linkParams } = require('./schema');
const c = require('./controller');

router.post('/recompute', requireRole('PM'), c.recompute); // full recompute, same diff + ledger behaviour
router.get('/links/:linkId/evidence', validate({ params: linkParams }), c.linkEvidence); // contributions + supporting signals
router.get('/manual-links', c.listManual);
router.post('/manual-links', requireRole('PM'), validate({ body: createManualLinkBody }), c.addManual);
router.delete('/manual-links/:linkId', requireRole('PM'), validate({ params: linkParams }), c.removeManual);

module.exports = router;
