'use strict';
const { ok, wrap } = require('../../shared/response');
const service = require('./service');

module.exports = {
  getSchedule: wrap(async (req, res) => ok(res, await service.getSchedule(req.params.projectId))),
  listTasks: wrap(async (req, res) => ok(res, await service.listTasks(req.params.projectId))),
  importTasks: wrap(async (req, res) => ok(res, await service.importTasks(req.params.projectId, req.body.tasks), 201)),
  createTask: wrap(async (req, res) => ok(res, await service.createTask(req.params.projectId, req.body), 201)),
  updateTask: wrap(async (req, res) => ok(res, await service.updateTask(req.params.projectId, req.params.taskId, req.body, req.user))),
  deleteTask: wrap(async (req, res) => ok(res, await service.deleteTask(req.params.projectId, req.params.taskId))),
  getSettings: wrap(async (req, res) => ok(res, await service.getSettings(req.params.projectId))),
  updateSettings: wrap(async (req, res) => ok(res, await service.updateSettings(req.params.projectId, req.body))),
  previewPlan: wrap(async (req, res) => ok(res, await service.previewPlan(req.params.projectId))),
  applyPlan: wrap(async (req, res) => ok(res, await service.applyPlan(req.params.projectId, req.user))),
  previewLeave: wrap(async (req, res) => ok(res, await service.previewLeave(req.params.projectId, req.body))),
  applyLeave: wrap(async (req, res) => ok(res, await service.applyLeave(req.params.projectId, req.body, req.user), 201)),
  listLeaves: wrap(async (req, res) => ok(res, await service.listLeaves(req.params.projectId))),
  listVersions: wrap(async (req, res) => ok(res, await service.listVersions(req.params.projectId))),
  saveVersion: wrap(async (req, res) => ok(res, await service.saveVersion(req.params.projectId, req.body.label, req.user), 201)),
  getVersion: wrap(async (req, res) => ok(res, await service.getVersion(req.params.projectId, req.params.versionId))),
};
