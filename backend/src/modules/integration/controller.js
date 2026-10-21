'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');

module.exports = {
  liveState: wrap(async (req, res) => ok(res, await service.liveState(req.params.projectId))),
  network: wrap(async (req, res) => ok(res, await service.getNetwork(req.params.projectId))),
  ledger: wrap(async (req, res) => ok(res, await service.getLedger(req.params.projectId))),
  scheduleBaseline: wrap(async (req, res) => ok(res, await service.scheduleBaseline(req.params.projectId))),
};
