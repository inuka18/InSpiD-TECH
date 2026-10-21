'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');

module.exports = {
  recompute: wrap(async (req, res) => ok(res, await service.recompute(req.params.projectId, req.user))),
  linkEvidence: wrap(async (req, res) => ok(res, await service.linkEvidence(req.params.projectId, req.params.linkId))),
  listManual: wrap(async (req, res) => ok(res, await service.listManualLinks(req.params.projectId))),
  addManual: wrap(async (req, res) => ok(res, await service.addManualLink(req.params.projectId, req.body, req.user), 201)),
  removeManual: wrap(async (req, res) => ok(res, await service.removeManualLink(req.params.projectId, req.params.linkId, req.user))),
};
