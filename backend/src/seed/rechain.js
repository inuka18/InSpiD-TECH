'use strict';
// npm run rechain  -  rebuild the hash chain of SEED placeholder ledger entries (one-off migration for data
// seeded before the chain existed). Refuses to run if any entry is on-chain, was created through the API,
// or is not a seed entry; then nothing is written.
const mongoose = require('mongoose');
const config = require('../config/env');
const { connectDb } = require('../config/db');
const { LedgerEntry } = require('../modules/ledger/model');
const { rechainSeedEntries, verifyChain } = require('../modules/ledger/service');

(async () => {
  await connectDb();
  console.log(`Rechaining seed ledger entries in database "${config.mongoDbName}"`);
  const r = await rechainSeedEntries();
  console.log(`  rewrote ${r.entries} entries in ${r.projects} projects`);
  for (const pid of await LedgerEntry.distinct('projectId')) {
    const v = await verifyChain(pid);
    console.log(`  ${pid}: ${v.valid ? 'valid' : 'BROKEN at block ' + v.brokenAt} (${v.entries} entries)`);
  }
})()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
