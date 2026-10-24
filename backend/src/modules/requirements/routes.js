'use strict';
// Mounted at /api/v1/projects/:projectId/requirements.
const router = require('express').Router({ mergeParams: true });
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { reqParams, createRequirementBody, updateRequirementBody, importConfirmBody } = require('./schema');
const upload = require('../signals/upload');
const c = require('./controller');

router.get('/', c.list);
router.get('/clusters', c.clusters); // before /:reqId
// SRS import (PM only): preview saves nothing; confirm creates the requirements and builds the network + Initial baseline.
router.post('/import-srs/preview', requireRole('PM'), upload.documentUpload, c.importPreview);
router.post('/import-srs/confirm', requireRole('PM'), validate({ body: importConfirmBody }), c.importConfirm);
router.get('/:reqId', validate({ params: reqParams }), c.get);
router.post('/', requireRole('PM'), validate({ body: createRequirementBody }), c.create);
router.patch('/:reqId', requireRole('PM'), validate({ params: reqParams, body: updateRequirementBody }), c.update);

module.exports = router;
