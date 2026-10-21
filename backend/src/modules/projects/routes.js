'use strict';
// Mounted at /api/v1/projects (requireAuth is applied by the parent router).
const router = require('express').Router();
const validate = require('../../middleware/validate');
const { requireRole, requireProjectMember } = require('../../middleware/auth');
const { projectIdParam, createProjectBody } = require('./schema');
const c = require('./controller');

router.get('/', c.list);
router.post('/', requireRole('PM'), validate({ body: createProjectBody }), c.create);
router.get('/:projectId', validate({ params: projectIdParam }), requireProjectMember, c.get);

module.exports = router;
