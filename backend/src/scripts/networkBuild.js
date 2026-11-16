'use strict';
// npm run network:build  -  compute the requirement network (Pathfinder links + clusters) for EVERY project.
// Needs the ai-service (/embed). Safe to run again: only differences are written, and a project whose links did not
// change gets no ledger entry. Manual links are never touched.
const mongoose = require('mongoose');
const config = require('../config/env');
const { connectDb } = require('../config/db');
const { Project } = require('../modules/projects/model');
const network = require('../modules/network/service');
const { verifyChain } = require('../modules/ledger/service');
const { Baseline } = require('../modules/network/model');

(async () => {
  await connectDb();
  console.log(`Computing the requirement network in database "${config.mongoDbName}" (ai-service: ${config.aiServiceUrl})`);
  const projects = await Project.find({}).sort({ projectId: 1 }).lean();
  let failed = 0;
  for (const p of projects) {
    try {
      const r = await network.computeNetwork(p.projectId, { actor: 'network:build' });
      const v = await verifyChain(p.projectId);
      const base = await Baseline.findOne({ projectId: p.projectId, initial: true }).lean(); // created by computeNetwork when missing (text-only)
      console.log(`  ${p.projectId}: ${r.requirements} requirements, ${r.links} links, ${r.clusters} clusters` +
        ` (+${r.added.length} / -${r.removed.length}${r.ledgerEntry ? `, ledger block ${r.ledgerEntry.blockNumber}` : ', no ledger entry'});` +
        ` initial baseline ${base ? `${base.baselineId} (${base.links.length} links, ledger block ${base.ledgerBlock})` : 'MISSING'};` +
        ` ledger chain ${v.valid ? 'valid' : 'BROKEN at block ' + v.brokenAt}`);
    } catch (err) {
      failed += 1;
      console.error(`  ${p.projectId}: FAILED - ${err.message}`);
    }
  }
  if (failed) process.exitCode = 1;
})()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
