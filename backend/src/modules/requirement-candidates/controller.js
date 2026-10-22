'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');

module.exports = {
  list: wrap(async (req, res) => ok(res, await service.list(req.params.projectId, req.query))),
  review: wrap(async (req, res) => ok(res, await service.review(req.params.projectId, req.params.candidateId, req.body, req.user))),
};
