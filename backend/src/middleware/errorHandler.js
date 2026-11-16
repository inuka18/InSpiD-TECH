'use strict';
const { ZodError } = require('zod');
const AppError = require('../shared/AppError');
const { fail } = require('../shared/response');

const notFound = (req, res) => fail(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return fail(res, 400, 'VALIDATION_ERROR', 'Request validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  if (err instanceof AppError) return fail(res, err.status, err.code, err.message, err.details);
  if (err.type === 'entity.too.large') return fail(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large');
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'BAD_JSON', 'Request body is not valid JSON');
  if (err.code === 11000) return fail(res, 409, 'DUPLICATE', 'A record with these values already exists');
  console.error(err);
  return fail(res, 500, 'INTERNAL_ERROR', 'Something went wrong');
}

module.exports = { errorHandler, notFound };
