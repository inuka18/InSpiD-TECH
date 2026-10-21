'use strict';
// Mounted at /api/v1/projects/:projectId/ledger.
// The full list (GET /projects/:projectId/ledger) is served by the integration module.
// The ledger is append-only: there are deliberately no update/delete routes.
// TODO (blockchain prompt): verify-entry route that checks a txHash against the Hardhat node.
const router = require('express').Router({ mergeParams: true });
const validate = require('../../middleware/validate');
const { reqParams } = require('./schema');
const c = require('./controller');

router.get('/requirements/:reqId', validate({ params: reqParams }), c.forRequirement);

module.exports = router;
