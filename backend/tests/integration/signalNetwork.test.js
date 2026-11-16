'use strict';
// Signals feed the network, baselines and alignment (stubbed ai client, *_test database only).
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../helpers/harness');
const aiClient = require('../../src/shared/aiClient');

// Four requirements on a quarter circle: Alpha 0 deg, Beta 25, Gamma 50, Delta 170. Text-only Pathfinder links:
// Alpha-Beta, Beta-Gamma, Gamma-Delta (Alpha-Gamma is the weaker side of the triangle and is dropped).
const unit = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const ANGLE = { Alpha: 0, Beta: 25, Gamma: 50, Delta: 170 };
const embedFn = (text) => {
  const key = Object.keys(ANGLE).find((k) => text.startsWith(`${k}.`));
  return key ? unit(ANGLE[key]) : unit(30); // a signal text
};
const sha = (c) => c.repeat(64);

describe('signals feed the requirement network', () => {
  let h;
  let id;
  const sig = () => `/projects/${h.projectId}/signals`;
  const post = (text, extra = {}) => h.api('POST', sig(), { body: { source: 'Slack', text, ...extra } });
  const ledger = (eventType) => h.models('LedgerEntry').find({ projectId: h.projectId, eventType }).sort({ blockNumber: 1 }).lean();
  const evidence = () => h.models('SignalEvidence').find({ projectId: h.projectId }).sort({ createdAt: 1 }).lean();
  const profile = async (reqId) => (await h.models('Requirement').findOne({ projectId: h.projectId, reqId }).select('+signalProfile').lean()).signalProfile;
  const net = () => h.api('GET', `/projects/${h.projectId}/network`);
  const state = () => h.models('NetworkState').findOne({ projectId: h.projectId }).lean();

  before(async () => {
    h = await start();
    h.ai.embedFn = embedFn;
    id = {};
    for (const title of Object.keys(ANGLE)) id[title] = (await h.addRequirement('Confirmed', { title, description: 'Original description' })).reqId;
    await net(); // computes the text-only network, the clusters and the initial baseline
  });
  after(async () => { await h.close(); });
  beforeEach(() => Object.assign(h.ai, { down: false, matchDown: false, embedDown: false, label: 'Expectation', confidence: 0.95, similarity: 0.7, matchTo: id.Beta }));

  it('the first GET /network: text-only links, ONE initial baseline and its BASELINE_CREATED ledger entry', async () => {
    const r = await net();
    assert.deepEqual(r.data.links.map((l) => l.id).sort(), [`${id.Alpha}~${id.Beta}~semantic`, `${id.Beta}~${id.Gamma}~semantic`, `${id.Gamma}~${id.Delta}~semantic`].sort());
    for (const l of r.data.links) {
      assert.equal(l.evidenceCount, 0);
      assert.equal(l.contributions.profile, 0);
      assert.equal(l.contributions.boost, 0);
      assert.equal(l.contributions.text, l.weight);
    }
    const baselines = await h.api('GET', `/projects/${h.projectId}/baselines`);
    assert.equal(baselines.data.length, 1);
    assert.equal(baselines.data[0].name, 'Initial baseline');
    assert.equal(baselines.data[0].initial, true);
    assert.equal(baselines.data[0].linkCount, 3);
    const created = await ledger('BASELINE_CREATED');
    assert.equal(created.length, 1);
    assert.equal(created[0].actor, 'system');
  });

  it('concurrent first GET /network calls create exactly one initial baseline', async () => {
    const other = await h.newProject(); // a project of its own, never visited before
    const base = `/projects/${other.projectId}`;
    for (const title of Object.keys(ANGLE)) await other.addRequirement({ title, description: 'x', type: 'FR' });
    const rs = await Promise.all(Array.from({ length: 6 }, () => h.api('GET', `${base}/network`)));
    assert.ok(rs.every((r) => r.status === 200));
    assert.equal(await h.models('Baseline').countDocuments({ projectId: other.projectId }), 1);
    assert.equal(await h.models('LedgerEntry').countDocuments({ projectId: other.projectId, eventType: 'BASELINE_CREATED' }), 1);
    assert.equal((await h.api('GET', `${base}/ledger/verify`)).data.valid, true);
  });

  it('alignment right after the initial baseline: 100, Strong Alignment, one history point', async () => {
    const r = await h.api('GET', `/projects/${h.projectId}/alignment`);
    assert.equal(r.status, 200);
    assert.equal(r.data.baseline.name, 'Initial baseline');
    assert.deepEqual(r.data.current, { score: 100, band: 'Strong Alignment', connectionsAdded: 0, connectionsRemoved: 0, changedConnections: 0 });
    assert.equal(r.data.history.length, 1);
    assert.equal(r.data.history[0].alignmentScore, 100);
  });

  it('an applied signal naming two requirement ids stores evidence and the signal profile; an unchanged network writes NO ledger entry', async () => {
    const before = (await ledger('NETWORK_UPDATE')).length;
    const r = await post(`${id.Alpha} and ${id.Gamma} have to be delivered together.`);
    assert.equal(r.status, 201);
    assert.equal(r.data.applied, true);
    const rows = await evidence();
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].kind, rows[0].reqA, rows[0].reqB, rows[0].signalId], ['idmention', id.Alpha, id.Gamma, r.data.signal.id]);
    const p = await profile(id.Beta); // the matched requirement
    assert.equal(p.count, 1);
    assert.equal(p.vector.length, 2);
    assert.equal((await ledger('NETWORK_UPDATE')).length, before); // boost 0.15 is not enough to change a link
    const link = (await net()).data.links.find((l) => l.id.startsWith(id.Alpha) && l.id.includes(id.Gamma));
    assert.equal(link, undefined);
  });

  it('the second such signal adds the link: exactly ONE NETWORK_UPDATE entry, triggered by that signal, details {added, removed}', async () => {
    const before = (await ledger('NETWORK_UPDATE')).length;
    const r = await post(`Again: ${id.Gamma} depends on ${id.Alpha}.`);
    assert.equal(r.data.applied, true);
    const updates = await ledger('NETWORK_UPDATE');
    assert.equal(updates.length, before + 1);
    const last = updates.at(-1);
    assert.equal(last.triggeringSignalId, r.data.signal.id);
    assert.equal(last.reqId, id.Beta);
    const entry = (await h.api('GET', `/projects/${h.projectId}/ledger`)).data.find((e) => e.txHash === last.txHash);
    assert.equal(entry.eventType, 'Network Updated');
    assert.deepEqual(entry.details, { added: [`${id.Alpha}~${id.Gamma}~semantic`], removed: [] });
    assert.equal((await h.api('GET', `/projects/${h.projectId}/ledger/verify`)).data.valid, true);
  });

  it('GET /network: the new link carries weight, evidenceCount and contributions; clusters are unchanged by the incremental update', async () => {
    const r = await net();
    const l = r.data.links.find((x) => x.id === `${id.Alpha}~${id.Gamma}~semantic`);
    assert.ok(l, 'Alpha-Gamma link');
    assert.equal(l.evidenceCount, 2);
    assert.equal(l.contributions.boost, 0.3);
    assert.ok(Math.abs(l.contributions.text - 0.642788) < 1e-5);
    assert.equal(l.contributions.profile, 0);
    assert.ok(Math.abs(l.weight - (l.contributions.text + l.contributions.boost)) < 1e-5);
    assert.ok(r.data.clusters.length >= 3);
  });

  it('GET /network/links/:linkId/evidence: contributions and the supporting signals, newest first', async () => {
    const r = await h.api('GET', `/projects/${h.projectId}/network/links/${id.Alpha}~${id.Gamma}~semantic/evidence`);
    assert.equal(r.status, 200);
    assert.equal(r.data.evidenceCount, 2);
    assert.deepEqual(r.data.evidenceByKind, { idmention: 2, coref: 0 });
    assert.equal(r.data.signals.length, 2);
    assert.match(r.data.signals[0].text, /^Again:/); // newest first
    assert.equal(r.data.signals[0].kind, 'idmention');
    for (const k of ['signalId', 'text', 'source', 'authorRole', 'timestamp', 'label', 'similarityA', 'similarityB']) assert.ok(k in r.data.signals[0], k);
    assert.equal((await h.api('GET', `/projects/${h.projectId}/network/links/${id.Alpha}~${id.Delta}~semantic/evidence`)).status, 404);
  });

  it('alignment after the change: Jaccard 3/4 = 75 (Moderate Drift), history row for today with the driver signal', async () => {
    const r = await h.api('GET', `/projects/${h.projectId}/alignment`);
    assert.deepEqual(r.data.current, { score: 75, band: 'Moderate Drift', connectionsAdded: 1, connectionsRemoved: 0, changedConnections: 1 });
    const last = r.data.history.at(-1);
    assert.equal(last.alignmentScore, 75);
    assert.equal(last.connectionsAdded, 1);
    assert.equal(last.changedConnections, 1);
    assert.equal(last.driverSignalId, null); // only 1 connection changed: below the driver threshold
  });

  it('a control message (no ids, no close second candidate) updates the profile but changes nothing', async () => {
    const before = (await ledger('NETWORK_UPDATE')).length;
    const rows = (await evidence()).length;
    const r = await post('Nothing special, just a status remark about the same work.');
    assert.equal(r.data.applied, true);
    assert.equal((await evidence()).length, rows);
    assert.equal((await ledger('NETWORK_UPDATE')).length, before);
    assert.equal((await profile(id.Beta)).count, 3);
  });

  it('co-reference: two close candidates both above 0.40 give a coref row', async () => {
    const orig = aiClient.match;
    aiClient.match = async () => [{ id: id.Gamma, similarity: 0.62 }, { id: id.Delta, similarity: 0.55 }, { id: id.Alpha, similarity: 0.2 }];
    try {
      const r = await post('Delivery touches both the gateway and the shipping side.');
      assert.equal(r.data.applied, true);
      const rows = (await evidence()).filter((e) => e.kind === 'coref');
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0].reqA, rows[0].reqB, rows[0].similarityA, rows[0].similarityB], [id.Gamma, id.Delta, 0.62, 0.55]);
    } finally {
      aiClient.match = orig;
    }
  });

  it('pending and rejected signals give NO evidence or profile; accepting or correcting one does', async () => {
    h.ai.confidence = 0.5; // below the threshold: pending
    const rows = (await evidence()).length;
    const countBefore = (await profile(id.Delta))?.count ?? 0;
    const p1 = (await post(`${id.Delta} and ${id.Beta} belong together.`, { })).data;
    const p2 = (await post(`${id.Delta} and ${id.Beta} belong together, second.`)).data;
    assert.equal(p1.reviewStatus, 'pending');
    assert.equal((await evidence()).length, rows);
    const rej = await h.api('POST', `${sig()}/${p1.signal.id}/review`, { body: { action: 'reject' } });
    assert.equal(rej.status, 200);
    assert.equal((await evidence()).length, rows); // rejected: nothing
    const acc = await h.api('POST', `${sig()}/${p2.signal.id}/review`, { body: { action: 'accept' } });
    assert.equal(acc.status, 200);
    const now = await evidence();
    assert.equal(now.length, rows + 1);
    assert.equal(now.at(-1).signalId, p2.signal.id);
    assert.equal((await profile(id.Beta)).count, 4); // Beta: 3 before + the accepted signal (the co-reference signal went to Gamma)
    assert.equal((await profile(id.Delta))?.count ?? 0, countBefore);
  });

  it('a PM correction to another requirement moves the profile there and evidence follows the CORRECTED requirement', async () => {
    h.ai.confidence = 0.5;
    const s = (await post('Plain pending message about delivery.')).data;
    const before = (await profile(id.Gamma))?.count ?? 0;
    const r = await h.api('POST', `${sig()}/${s.signal.id}/review`, { body: { action: 'correct', correctedLabel: 'Constraint', correctedRequirementId: id.Gamma } });
    assert.equal(r.status, 200);
    assert.equal((await profile(id.Gamma)).count, before + 1);
  });

  it('a None signal and a rejected one never reach the network', async () => {
    h.ai.label = 'None';
    const rows = (await evidence()).length;
    const countBefore = (await profile(id.Beta)).count;
    const r = await post(`${id.Alpha} and ${id.Delta} are mentioned but this is chit-chat.`);
    assert.equal(r.data.applied, false);
    assert.equal((await evidence()).length, rows);
    assert.equal((await profile(id.Beta)).count, countBefore);
  });

  it('bulk: evidence, profiles and exactly one NETWORK_UPDATE per signal that changes the network (none for the others)', async () => {
    const before = (await ledger('NETWORK_UPDATE')).length;
    const items = [
      { text: `${id.Beta} and ${id.Delta} are two halves of one story.` },
      { text: `More proof that ${id.Delta} and ${id.Beta} are linked.` },
      { text: 'A neutral note on the same work.' },
    ];
    const r = await h.api('POST', `${sig()}/bulk`, { body: { documentId: sha('b'), name: 'notes.txt', source: 'Standup', items } });
    assert.equal(r.status, 201);
    assert.equal(r.data.summary.applied + r.data.summary.noChange, 3);
    const rows = (await evidence()).filter((e) => e.reqA === id.Beta && e.reqB === id.Delta);
    assert.equal(rows.length, 3); // 1 from the accepted signal earlier + 2 from this document
    const updates = await ledger('NETWORK_UPDATE');
    assert.ok(updates.length - before <= 1, 'at most the second item can change the network');
    for (const u of updates.slice(before)) assert.ok(r.data.results.some((x) => x.signalId === u.triggeringSignalId));
    assert.equal((await h.api('GET', `/projects/${h.projectId}/ledger/verify`)).data.valid, true);
  });

  it('ai-service down on /embed: the signal still succeeds, evidence is kept, the network is marked stale and catches up later', async () => {
    h.ai.embedDown = true;
    const countBefore = (await profile(id.Beta)).count;
    const r = await post(`${id.Alpha} and ${id.Beta} again.`);
    assert.equal(r.status, 201);
    assert.equal(r.data.applied, true);
    const st = await state();
    assert.equal(st.stale, true);
    assert.deepEqual(st.pendingSignalIds, [r.data.signal.id]);
    assert.equal((await profile(id.Beta)).count, countBefore); // profile update skipped
    assert.ok((await evidence()).some((e) => e.signalId === r.data.signal.id));
    const g = await net(); // still down: a warning, not a failure
    assert.equal(g.status, 200);
    assert.match(g.data.warning, /could not be computed/i);

    h.ai.embedDown = false;
    const ok = await net();
    assert.equal(ok.data.warning, undefined);
    assert.equal((await state()).stale, false);
    assert.deepEqual((await state()).pendingSignalIds, []);
    assert.equal((await profile(id.Beta)).count, countBefore + 1); // caught up
  });

  it('seeded signals (dataset rows) never feed the network', async () => {
    const network = require('../../src/modules/network/service');
    const rows = (await evidence()).length;
    const r = await network.onSignalApplied({ projectId: h.projectId, signal: { signalId: 'SC-SEED', text: `${id.Alpha} and ${id.Beta}`, split: 'train', matchAlternatives: [] }, requirementId: id.Beta, actor: 'x' });
    assert.equal(r.skipped, true);
    assert.equal((await evidence()).length, rows);
  });

  it('preview (dry run) writes nothing to the network', async () => {
    const rows = (await evidence()).length;
    const counts = (await profile(id.Beta)).count;
    const r = await h.api('POST', `${sig()}/preview`, { body: { source: 'Slack', text: `${id.Alpha} and ${id.Delta} preview.` } });
    assert.equal(r.status, 200);
    assert.equal((await evidence()).length, rows);
    assert.equal((await profile(id.Beta)).count, counts);
  });

  it('POST /network/recompute keeps the signal evidence (the combined similarity is used)', async () => {
    const r = await h.api('POST', `/projects/${h.projectId}/network/recompute`);
    assert.equal(r.status, 200);
    const link = (await net()).data.links.find((l) => l.id === `${id.Alpha}~${id.Gamma}~semantic`);
    assert.ok(link, 'the evidence-backed link survives a full recompute');
  });

  it('the ledger chain is still valid after all of this', async () => {
    assert.equal((await h.api('GET', `/projects/${h.projectId}/ledger/verify`)).data.valid, true);
  });
});

describe('baselines and alignment endpoints', () => {
  let h;
  let id;
  const p = () => `/projects/${h.projectId}`;
  const ledger = (eventType) => h.models('LedgerEntry').find({ projectId: h.projectId, eventType }).sort({ blockNumber: 1 }).lean();
  before(async () => {
    h = await start();
    h.ai.embedFn = embedFn;
    id = {};
    for (const title of Object.keys(ANGLE)) id[title] = (await h.addRequirement('Confirmed', { title, description: 'd' })).reqId;
    await h.api('GET', `${p()}/network`);
  });
  after(async () => { await h.close(); });
  beforeEach(() => Object.assign(h.ai, { down: false, matchDown: false, embedDown: false, label: 'Expectation', confidence: 0.95, similarity: 0.7, matchTo: id.Beta }));

  it('a project without requirements has no baseline: alignment answers 404 with a clear message', async () => {
    const empty = await h.newProject();
    const r = await h.api('GET', `/projects/${empty.projectId}/alignment`);
    assert.equal(r.status, 404);
    assert.match(r.json.error.message, /no baseline/i);
  });

  it('POST /baselines is PM only, freezes the current links and statuses, and appends BASELINE_CREATED to the ledger', async () => {
    assert.equal((await h.api('POST', `${p()}/baselines`, { token: h.member.token, body: { name: 'Nope' } })).status, 403);
    assert.equal((await h.api('POST', `${p()}/baselines`, { body: { name: '  ' } })).status, 400);
    const r = await h.api('POST', `${p()}/baselines`, { body: { name: 'Sprint 1 freeze' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.name, 'Sprint 1 freeze');
    assert.equal(r.data.initial, false);
    assert.equal(r.data.linkCount, 3);
    assert.equal(r.data.ledgerEntry.eventCode, 'BASELINE_CREATED');
    assert.equal(r.data.ledgerEntry.eventType, 'Baseline Created');
    assert.deepEqual(r.data.ledgerEntry.details, { baselineId: r.data.id, name: 'Sprint 1 freeze' });
    assert.equal((await ledger('BASELINE_CREATED')).length, 2);
    assert.equal((await h.api('GET', `${p()}/ledger/verify`)).data.valid, true);
  });

  it('GET /baselines lists both; GET /baselines/:id returns the frozen requirements and links', async () => {
    const list = await h.api('GET', `${p()}/baselines`);
    assert.deepEqual(list.data.map((b) => b.name), ['Initial baseline', 'Sprint 1 freeze']);
    const one = await h.api('GET', `${p()}/baselines/${list.data[1].id}`);
    assert.equal(one.data.requirements.length, 4);
    assert.deepEqual(Object.keys(one.data.requirements[0]).sort(), ['description', 'granularity', 'id', 'resourceRole', 'status', 'title', 'type']);
    assert.equal(one.data.links.length, 3);
    assert.deepEqual(Object.keys(one.data.links[0]).sort(), ['source', 'target', 'weight']);
    assert.equal((await h.api('GET', `${p()}/baselines/BL-nope`)).status, 404);
  });

  it('the default alignment baseline is the LATEST one; ?baselineId= picks another', async () => {
    const list = (await h.api('GET', `${p()}/baselines`)).data;
    assert.equal((await h.api('GET', `${p()}/alignment`)).data.baseline.name, 'Sprint 1 freeze');
    assert.equal((await h.api('GET', `${p()}/alignment?baselineId=${list[0].id}`)).data.baseline.name, 'Initial baseline');
    assert.equal((await h.api('GET', `${p()}/alignment?baselineId=BL-nope`)).status, 404);
  });

  it('after a change: diff lists status changes and links added/removed; alignment is measured against each baseline', async () => {
    const text = (a, b) => `${a} and ${b} must ship together.`;
    await h.api('POST', `${p()}/signals`, { body: { source: 'Slack', text: text(id.Alpha, id.Gamma) } });
    await h.api('POST', `${p()}/signals`, { body: { source: 'Slack', text: text(id.Gamma, id.Alpha) } });
    h.ai.label = 'Conflict';
    h.ai.matchTo = id.Delta;
    await h.api('POST', `${p()}/signals`, { body: { source: 'Slack', text: 'The delta part is blocked because of the vendor.' } });
    const list = (await h.api('GET', `${p()}/baselines`)).data;
    const d = await h.api('GET', `${p()}/baselines/${list[0].id}/diff`);
    assert.equal(d.status, 200);
    assert.deepEqual(d.data.links, { added: [`${id.Alpha}~${id.Gamma}~semantic`], removed: [] });
    assert.deepEqual(d.data.requirements.changed, [{ id: id.Delta, title: 'Delta', from: 'Confirmed', to: 'At Risk' }]);
    const a = await h.api('GET', `${p()}/alignment?baselineId=${list[1].id}`);
    assert.equal(a.data.current.score, 75);
    assert.equal(a.data.history.at(-1).alignmentScore, 75);
    assert.deepEqual(Object.keys(a.data.history[0]).sort(), ['alignmentScore', 'changedConnections', 'connectionsAdded', 'connectionsRemoved', 'date', 'driverSignalId']);
  });

  it('a new baseline freezes the CURRENT network: alignment is 100 again and later drift is counted from it', async () => {
    const r = await h.api('POST', `${p()}/baselines`, { body: { name: 'After the change' } });
    assert.equal(r.data.linkCount, 4);
    const a = await h.api('GET', `${p()}/alignment`);
    assert.equal(a.data.baseline.name, 'After the change');
    assert.equal(a.data.current.score, 100);
    assert.equal(a.data.history.length, 1);
    assert.equal((await h.api('GET', `${p()}/ledger/verify`)).data.valid, true);
  });
});
