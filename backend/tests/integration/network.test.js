'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../helpers/harness');

// Two obvious topics (payments, search); the stubbed /embed returns these vectors, keyed by requirement title.
const VEC = {
  'Payment A': [1, 0.1, 0, 0], 'Payment B': [0.9, 0.2, 0, 0], 'Payment C': [0.95, 0.05, 0, 0.1],
  'Search A': [0, 0, 1, 0.1], 'Search B': [0, 0.1, 0.9, 0.2], 'Search C': [0, 0.05, 0.95, 0],
  'Payment F': [0.97, 0.12, 0, 0.02],
};
const embedFn = (text) => {
  if (text.includes('[MOVED]')) return VEC['Payment A']; // used to drag a search requirement into the payments topic
  const key = Object.keys(VEC).find((k) => text.startsWith(`${k}.`));
  assert.ok(key, `no stub vector for "${text}"`);
  return VEC[key];
};

describe('requirements network (Pathfinder + clusters, stubbed /embed, *_test database)', () => {
  let h;
  const reqs = {};
  const net = () => h.api('GET', `/projects/${h.projectId}/network`);
  const updates = () => h.models('LedgerEntry').find({ projectId: h.projectId, eventType: 'NETWORK_UPDATE' }).sort({ blockNumber: 1 }).lean();
  const idsOf = (res) => res.data.links.filter((l) => l.kind === 'pathfinder').map((l) => l.id).sort();

  before(async () => {
    h = await start();
    h.ai.embedFn = embedFn;
    // group_id differs from the topic on purpose: clusters must NOT follow it
    for (const [title, groupId] of [['Payment A', 'ZZ-1'], ['Payment B', 'ZZ-2'], ['Payment C', 'ZZ-1'], ['Search A', 'ZZ-2'], ['Search B', 'ZZ-1'], ['Search C', 'ZZ-2']]) {
      reqs[title] = await h.addRequirement('Confirmed', { title, description: 'Original description', groupId });
    }
  });
  after(async () => { await h.close(); });

  it('AI service down and nothing computed yet: nodes, an empty link list and a warning; cluster stays null', async () => {
    h.ai.embedDown = true;
    const r = await net();
    assert.equal(r.status, 200);
    assert.equal(r.data.nodes.length, 6);
    assert.deepEqual(r.data.links, []);
    assert.match(r.data.warning, /could not be computed/i);
    assert.ok(r.data.nodes.every((n) => n.cluster === null)); // never falls back to group_id
    const list = await h.api('GET', `/projects/${h.projectId}/requirements`);
    assert.ok(list.data.every((q) => q.cluster === null));
    assert.equal((await updates()).length, 0);
    h.ai.embedDown = false;
  });

  it('first GET computes the network, stores links and clusters, and writes ONE NETWORK_UPDATE ledger entry', async () => {
    const r = await net();
    assert.equal(r.status, 200);
    assert.equal(r.data.warning, undefined);
    const links = r.data.links.filter((l) => l.kind === 'pathfinder');
    assert.ok(links.length >= 5); // a connected graph over 6 nodes has at least n-1 edges
    for (const l of links) {
      assert.equal(l.relationType, 'semantic');
      assert.ok(l.weight > 0 && l.weight <= 1, `weight ${l.weight}`);
      assert.ok(l.id.endsWith('~semantic'));
    }
    // k = clamp(round(sqrt(6)), 3, 8) = 3 clusters; they follow the TEXT (topic), never group_id: no cluster mixes the two topics
    const c = (t) => r.data.nodes.find((n) => n.id === reqs[t].reqId).cluster;
    assert.equal(r.data.clusters.length, 3);
    assert.equal(r.data.clusters.reduce((s, k) => s + k.size, 0), 6);
    const topicsIn = new Map();
    r.data.nodes.forEach((n) => topicsIn.set(n.cluster, new Set([...(topicsIn.get(n.cluster) || []), n.title.split(' ')[0]])));
    assert.ok([...topicsIn.values()].every((t) => t.size === 1));
    assert.notEqual(c('Payment A'), c('Search A'));
    assert.match(c('Payment A'), /^cluster-\d+$/);
    assert.match(r.data.nodes[0].clusterLabel, /^Cluster \d+/);
    // persisted on the requirements
    const stored = await h.models('Requirement').findOne({ projectId: h.projectId, reqId: reqs['Payment A'].reqId }).lean();
    assert.equal(stored.clusterId, c('Payment A'));
    assert.equal(stored.embeddingTextHash.length, 40);
    const list = await h.api('GET', `/projects/${h.projectId}/requirements`);
    assert.ok(list.data.every((q) => /^cluster-\d+$/.test(q.cluster)));
    assert.deepEqual((await h.api('GET', `/projects/${h.projectId}/requirements/clusters`)).data.map((k) => k.id), ['cluster-1', 'cluster-2', 'cluster-3']);
    // exactly one ledger entry, listing every added link
    const u = await updates();
    assert.equal(u.length, 1);
    const entry = (await h.api('GET', `/projects/${h.projectId}/ledger`)).data.find((e) => e.eventCode === 'NETWORK_UPDATE');
    assert.equal(entry.eventType, 'Network Updated');
    assert.deepEqual(entry.details.added.slice().sort(), idsOf(r));
    assert.deepEqual(entry.details.removed, []);
    assert.equal((await h.api('GET', `/projects/${h.projectId}/ledger/verify`)).data.valid, true);
  });

  it('a second GET changes nothing: no re-embedding, no ledger entry', async () => {
    const before = { ...h.ai.calls };
    await net();
    await net();
    assert.equal(h.ai.calls.embed, before.embed);
    assert.equal((await updates()).length, 1);
  });

  it('an edit that moves a requirement embeds only that requirement and writes ONE ledger entry with added and removed links', async () => {
    const before = await net();
    const embedded = h.ai.calls.embedTexts;
    const r = await h.api('PATCH', `/projects/${h.projectId}/requirements/${reqs['Search C'].reqId}`, { body: { description: '[MOVED] now about payments' } });
    assert.equal(r.status, 200);
    assert.equal(h.ai.calls.embedTexts - embedded, 1); // the other vectors came from the cache
    const after = await net();
    assert.notDeepEqual(idsOf(after), idsOf(before));
    const u = await updates();
    assert.equal(u.length, 2);
    const details = (await h.api('GET', `/projects/${h.projectId}/ledger`)).data.filter((e) => e.eventCode === 'NETWORK_UPDATE').sort((a, b) => a.blockNumber - b.blockNumber)[1].details;
    assert.ok(details.added.length > 0 && details.removed.length > 0);
    assert.deepEqual(idsOf(after).filter((id) => !idsOf(before).includes(id)).sort(), details.added.slice().sort());
    assert.deepEqual(idsOf(before).filter((id) => !idsOf(after).includes(id)).sort(), details.removed.slice().sort());
    assert.equal(u[1].reqId, reqs['Search C'].reqId);
  });

  it('an edit that leaves the links unchanged writes no ledger entry (and a non-text edit does not even embed)', async () => {
    const count = (await updates()).length;
    const embedded = h.ai.calls.embedTexts;
    const r = await h.api('PATCH', `/projects/${h.projectId}/requirements/${reqs['Payment B'].reqId}`, { body: { description: 'Completely different words, same meaning' } });
    assert.equal(r.status, 200);
    assert.equal(h.ai.calls.embedTexts - embedded, 1);
    assert.equal((await updates()).length, count);
    const e2 = h.ai.calls.embedTexts;
    await h.api('PATCH', `/projects/${h.projectId}/requirements/${reqs['Payment B'].reqId}`, { body: { granularity: 'Daily Task' } });
    assert.equal(h.ai.calls.embedTexts, e2);
    assert.equal((await updates()).length, count);
  });

  it('creating a requirement through the API adds its links and appends REQUIREMENT_CREATED plus NETWORK_UPDATE', async () => {
    const count = (await updates()).length;
    const r = await h.api('POST', `/projects/${h.projectId}/requirements`, { body: { title: 'Payment F', description: 'A new payment requirement' } });
    assert.equal(r.status, 201);
    assert.match(r.data.cluster, /^cluster-\d+$/);
    assert.equal((await updates()).length, count + 1);
    const types = (await h.api('GET', `/projects/${h.projectId}/ledger`)).data.map((e) => e.eventCode);
    assert.ok(types.includes('REQUIREMENT_CREATED'));
    const n = await net();
    assert.ok(n.data.links.some((l) => l.source === r.data.id || l.target === r.data.id));
  });

  it('manual links are never pruned or changed by a recompute; recompute is PM only', async () => {
    const manual = await h.api('POST', `/projects/${h.projectId}/network/manual-links`, { body: { sourceId: reqs['Payment A'].reqId, targetId: reqs['Search A'].reqId, reason: 'Checkout search integration' } });
    assert.equal(manual.status, 201);
    const count = (await updates()).length;
    const embedded = h.ai.calls.embedTexts;
    const r = await h.api('POST', `/projects/${h.projectId}/network/recompute`);
    assert.equal(r.status, 200);
    assert.equal(h.ai.calls.embedTexts - embedded, 7); // a full recompute re-embeds everything
    assert.deepEqual(r.data.added, []);
    assert.deepEqual(r.data.removed, []);
    assert.equal(r.data.ledgerEntry, null); // nothing changed -> no ledger entry
    assert.equal((await updates()).length, count);
    const n = await net();
    const m = n.data.links.filter((l) => l.kind === 'manual');
    assert.equal(m.length, 1);
    assert.equal(m[0].id, manual.data.id);
    assert.equal((await h.api('POST', `/projects/${h.projectId}/network/recompute`, { token: h.member.token })).status, 403);
  });

  it('the answer key is never returned as links', async () => {
    await h.models('NetworkGroundTruth').create({ projectId: h.projectId, reqA: reqs['Payment A'].reqId, reqB: reqs['Search A'].reqId, relationType: 'same_group' });
    const r = await net();
    assert.ok(r.data.links.every((l) => ['pathfinder', 'manual'].includes(l.kind)));
    assert.ok(r.data.links.every((l) => !['same_group', 'dependency'].includes(l.relationType)));
    const viaIntegration = await h.api('GET', `/projects/${h.projectId}/live-state`);
    assert.ok(viaIntegration.data.requirements.every((q) => q.cluster === null || /^cluster-\d+$/.test(q.cluster)));
  });

  it('AI service down after links exist: edits still succeed, GET returns the stored links with a warning, recompute fails clearly', async () => {
    h.ai.embedDown = true;
    const stored = (await net()).data.links.length;
    const patched = await h.api('PATCH', `/projects/${h.projectId}/requirements/${reqs['Payment C'].reqId}`, { body: { description: 'Changed while the AI service is down' } });
    assert.equal(patched.status, 200);
    const r = await net();
    assert.equal(r.status, 200);
    assert.match(r.data.warning, /could not be computed or refreshed/i);
    assert.equal(r.data.links.length, stored);
    assert.equal((await h.api('POST', `/projects/${h.projectId}/network/recompute`)).status, 502);
    h.ai.embedDown = false;
    const healed = await net(); // catches up on the next GET
    assert.equal(healed.data.warning, undefined);
  });
});
