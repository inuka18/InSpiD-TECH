'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');
const srsImport = require('./srsImport');

module.exports = {
  list: wrap(async (req, res) => ok(res, await service.list(req.params.projectId))),
  clusters: wrap(async (req, res) => ok(res, await service.clusters(req.params.projectId))),
  get: wrap(async (req, res) => ok(res, await service.getOne(req.params.projectId, req.params.reqId))),
  create: wrap(async (req, res) => ok(res, await service.create(req.params.projectId, req.body, req.user), 201)),
  importPreview: wrap(async (req, res) => ok(res, await srsImport.preview(req.params.projectId, req.file))),
  importConfirm: wrap(async (req, res) => ok(res, await srsImport.confirm(req.params.projectId, req.body, req.user), 201)),
  update: wrap(async (req, res) => ok(res, await service.update(req.params.projectId, req.params.reqId, req.body, req.user))),
};
