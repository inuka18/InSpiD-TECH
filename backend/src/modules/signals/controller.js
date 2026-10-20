'use strict';
const { ok, wrap } = require('../../shared/response');
const AppError = require('../../shared/AppError');
const service = require('./service');

// 202 = accepted but degraded (the AI service was unavailable); the body says what was and was not done.
module.exports = {
  list: wrap(async (req, res) => ok(res, await service.list(req.params.projectId, req.query))),
  get: wrap(async (req, res) => ok(res, await service.getOne(req.params.projectId, req.params.signalId))),
  create: wrap(async (req, res) => {
    const data = await service.create(req.params.projectId, req.body, req.user);
    return ok(res, data, data.degraded ? 202 : 201);
  }),
  preview: wrap(async (req, res) => ok(res, await service.preview(req.params.projectId, req.body))),
  // multipart (field "file") or JSON { text, name }. Nothing is stored: the file is processed in memory.
  extract: wrap(async (req, res) => {
    if (!req.file && !req.body.text) throw new AppError(400, 'NO_INPUT', 'Send a file (multipart field "file") or JSON { "text": "..." }');
    ok(res, await service.extract(req.params.projectId, { file: req.file, ...req.body }));
  }),
  bulk: wrap(async (req, res) => ok(res, await service.bulk(req.params.projectId, req.body, req.user), 201)),
  review: wrap(async (req, res) => ok(res, await service.review(req.params.projectId, req.params.signalId, req.body, req.user))),
  exportFeedback: wrap(async (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="feedback_${req.params.projectId}.csv"`);
    res.send(await service.exportFeedbackCsv(req.params.projectId));
  }),
};
