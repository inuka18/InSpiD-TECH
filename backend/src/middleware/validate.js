'use strict';
// validate({ params, query, body }) with zod schemas; parsed values replace the originals.
const validate = (schemas) => (req, res, next) => {
  try {
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const parsed = schemas[part].parse(req[part]);
      if (part === 'query') Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      else req[part] = parsed;
    }
    next();
  } catch (err) {
    next(err); // ZodError -> errorHandler
  }
};
module.exports = validate;
