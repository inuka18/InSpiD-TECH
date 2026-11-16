'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');

module.exports = {
  verify: wrap(async (req, res) => ok(res, await service.verifyChain(req.params.projectId))),
  forRequirement: wrap(async (req, res) => ok(res, await service.listForRequirement(req.params.projectId, req.params.reqId))),
};
