'use strict';
// THE CONTRACT other components (gap detection, schedule, retrospectives) must use to read
// Component 1's data. Do not query our Mongo collections directly.
const { Requirement } = require('../requirements/model');
const network = require('../network/service');
const ledger = require('../ledger/service');

async function liveState(projectId) {
  const reqs = await Requirement.find({ projectId }).sort({ reqId: 1 }).lean();
  return {
    projectId,
    generatedAt: new Date().toISOString(),
    requirements: reqs.map((r) => ({
      id: r.reqId,
      title: r.title,
      liveStatus: r.liveStatus,
      resourceRole: r.resourceRole,
      granularity: r.granularity,
      cluster: r.clusterId ?? null,
      type: r.type,
    })),
  };
}

const getNetwork = (projectId) => network.getNetwork(projectId);
const getLedger = (projectId) => ledger.listForProject(projectId);

// TODO (schedule component): the real baseline (phases, dates, capacity). Until then this is the
// per-requirement planning view derived from live state.
async function scheduleBaseline(projectId) {
  const { requirements, generatedAt } = await liveState(projectId);
  return {
    projectId,
    generatedAt,
    phases: [],
    items: requirements
      .filter((r) => r.liveStatus !== 'Dropped')
      .map((r) => ({ requirementId: r.id, title: r.title, granularity: r.granularity, resourceRole: r.resourceRole, liveStatus: r.liveStatus })),
  };
}

module.exports = { liveState, getNetwork, getLedger, scheduleBaseline };
