'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');

module.exports = {
  register: wrap(async (req, res) => ok(res, await service.register(req.body), 201)),
  login: wrap(async (req, res) => ok(res, await service.login(req.body))),
  me: wrap(async (req, res) => ok(res, await service.me(req.user.id))),
};
