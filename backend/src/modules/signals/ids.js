'use strict';
const AppError = require('../../shared/AppError');

// Sequential ids like SC-0001 / SH-0001 (numeric ordering, so SC-10000 sorts after SC-9999).
async function nextSeq(Model, field, prefix) {
  const last = await Model.findOne({}, { [field]: 1 }).sort({ [field]: -1 }).collation({ locale: 'en', numericOrdering: true }).lean();
  const n = last ? Number(String(last[field]).replace(/\D/g, '')) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

async function createWithSeqId(Model, field, prefix, build) {
  for (let i = 0; i < 5; i += 1) {
    try {
      return await Model.create(build(await nextSeq(Model, field, prefix)));
    } catch (err) {
      if (err.code !== 11000) throw err; // id taken by a concurrent request: take the next one
    }
  }
  throw new AppError(409, 'ID_BUSY', 'Could not allocate an id (concurrent writes); try again');
}

module.exports = { nextSeq, createWithSeqId };
