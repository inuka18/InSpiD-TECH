'use strict';
// GET /projects/:projectId/alignment: how far the current computed network has drifted from a frozen baseline.
const AppError = require('../../shared/AppError');
const ledger = require('../ledger/service');
const baselines = require('./baselines');
const network = require('./service');
const { jaccardScore, bandOf, rebuildHistory, linkSetKey } = require('./alignment');
const { Requirement } = require('../requirements/model');

async function getAlignment(projectId, baselineId) {
  let baseline = baselineId ? await baselines.get(projectId, baselineId) : await baselines.latest(projectId);
  if (!baseline && !baselineId && (await Requirement.exists({ projectId }))) {
    try {
      await network.ensureInitialBaseline(projectId); // the first look at a project creates its initial baseline
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
    }
    baseline = await baselines.latest(projectId);
  }
  if (!baseline) {
    throw new AppError(404, 'NO_BASELINE', 'This project has no baseline yet. Open the Network Map (or run npm run network:build) to create the initial baseline, or freeze one as a PM.');
  }

  const current = await baselines.currentComputedLinks(projectId);
  const before = new Set(baseline.links.map(linkSetKey));
  const now = new Set(current.map(linkSetKey));
  const added = [...now].filter((k) => !before.has(k)).length;
  const removed = [...before].filter((k) => !now.has(k)).length;
  const score = jaccardScore(baseline.links, current);

  // NETWORK_UPDATE entries written after the baseline's own ledger entry, oldest first.
  const entries = (await ledger.listForProject(projectId))
    .filter((e) => e.eventCode === 'NETWORK_UPDATE')
    .filter((e) => (baseline.ledgerBlock != null ? e.blockNumber > baseline.ledgerBlock : new Date(e.timestamp) > new Date(baseline.createdAt)))
    .sort((a, b) => a.blockNumber - b.blockNumber)
    .map((e) => ({ timestamp: e.timestamp, added: e.details.added, removed: e.details.removed, triggeringSignalId: e.triggeringSignalId }));
  const { history } = rebuildHistory({ baselineLinks: baseline.links, baselineDate: baseline.createdAt, updates: entries });

  return {
    baseline: { id: baseline.baselineId, name: baseline.name, createdAt: baseline.createdAt },
    current: { score, band: bandOf(score), connectionsAdded: added, connectionsRemoved: removed, changedConnections: added + removed },
    history,
  };
}

module.exports = { getAlignment };
