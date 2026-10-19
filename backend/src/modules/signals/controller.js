'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');

module.exports = {
  list: wrap(async (req, res) => ok(res, await service.list(req.params.projectId, req.query))),
  get: wrap(async (req, res) => ok(res, await service.getOne(req.params.projectId, req.params.signalId))),
  create: wrap(async (req, res) => ok(res, await service.create(req.params.projectId, req.body), 201)),
  review: wrap(async (req, res) => ok(res, await service.review(req.params.projectId, req.params.signalId, req.body.decision, req.user))),
};
