'use strict';
// Every response is { success, data, error }.
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data, error: null });
const fail = (res, status, code, message, details) =>
  res.status(status).json({ success: false, data: null, error: { code, message, ...(details ? { details } : {}) } });
// Wraps async handlers so rejections reach the central error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { ok, fail, wrap };
