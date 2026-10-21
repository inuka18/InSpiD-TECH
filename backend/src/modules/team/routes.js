'use strict';
// Mounted at /api/v1/projects/:projectId/team (auth + membership checked by the parent).
const router = require('express').Router({ mergeParams: true });
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { addMemberBody, memberParams } = require('./schema');
const c = require('./controller');

router.get('/', c.list);
router.post('/', requireRole('PM'), validate({ body: addMemberBody }), c.add);
router.delete('/:userId', requireRole('PM'), validate({ params: memberParams }), c.remove);

module.exports = router;
