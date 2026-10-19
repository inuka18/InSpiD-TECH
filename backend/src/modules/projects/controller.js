'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');

module.exports = {
  list: wrap(async (req, res) => ok(res, await service.listForUser(req.user))),
  get: wrap(async (req, res) => ok(res, await service.getById(req.params.projectId))),
  create: wrap(async (req, res) => ok(res, await service.create(req.user, req.body), 201)),
};
