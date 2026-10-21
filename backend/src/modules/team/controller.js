'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');

module.exports = {
  list: wrap(async (req, res) => ok(res, await service.list(req.params.projectId))),
  add: wrap(async (req, res) => ok(res, await service.addMember(req.params.projectId, req.body.email), 201)),
  remove: wrap(async (req, res) => ok(res, await service.removeMember(req.params.projectId, req.params.userId, req.user.id))),
};
