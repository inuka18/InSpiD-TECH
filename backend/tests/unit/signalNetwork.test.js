'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../src/modules/network/constants');
const { combineSimilarity, combinedMatrix, profileWeight, evidenceBoost } = require('../../src/modules/network/combine');
const { extractEvidence, mentionedIds } = require('../../src/modules/network/evidence');
const { updateProfile } = require('../../src/modules/network/profile');
const { jaccardScore, bandOf, rebuildHistory, dayOf } = require('../../src/modules/network/alignment');
const { diffLinks } = require('../../src/modules/network/diff');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('combined similarity', () => {
  it('without profiles or evidence it is exactly the text similarity', () => {
    const c = combineSimilarity({ textSim: 0.62 });
    assert.equal(c.sim, 0.62);
    assert.deepEqual(c.contributions, { text: 0.62, profile: 0, boost: 0 });
  });

  it('the profile weight is 0 when either side has no profile, and grows to 0.35 at 10 signals', () => {
    assert.equal(profileWeight(0, 8), 0);
    assert.equal(profileWeight(5, 0), 0);
    near(profileWeight(5, 8), 0.35 * 0.5); // the thinner profile counts
    near(profileWeight(10, 30), 0.35);
    near(profileWeight(50, 50), 0.35); // capped
  });

  it('sim = (1 - w) * text + w * profile + boost', () => {
    const c = combineSimilarity({ textSim: 0.5, profileSim: 0.9, countA: 10, countB: 12, evidence: { coref: 1 } });
    near(c.w, 0.35);
    near(c.sim, 0.65 * 0.5 + 0.35 * 0.9 + 0.06);
    near(c.contributions.text, 0.325);
    near(c.contributions.profile, 0.315);
    near(c.contributions.boost, 0.06);
  });

  it('the boost: 0.15 per id mention (cap 0.30), 0.06 per co-reference (cap 0.20), total cap 0.35', () => {
    near(evidenceBoost({ idMention: 1 }), 0.15);
    near(evidenceBoost({ idMention: 5 }), 0.30);
    near(evidenceBoost({ coref: 2 }), 0.12);
    near(evidenceBoost({ coref: 9 }), 0.20);
    near(evidenceBoost({ idMention: 2, coref: 1 }), 0.35); // 0.30 + 0.06 -> total cap
    near(evidenceBoost({ idMention: 9, coref: 9 }), 0.35);
    assert.equal(evidenceBoost({}), 0);
  });

  it('the result is capped at 1 and the three parts still add up to it', () => {
    const c = combineSimilarity({ textSim: 0.9, evidence: { idMention: 2, coref: 3 } });
    assert.equal(c.sim, 1);
    near(c.contributions.text + c.contributions.profile + c.contributions.boost, 1);
  });

  it('combinedMatrix: text only for plain requirements, boost for evidence pairs, symmetric', () => {
    const reqs = [
      { reqId: 'A', embedding: [1, 0] }, { reqId: 'B', embedding: [0.8, 0.6] }, { reqId: 'C', embedding: [0, 1] },
    ];
    const plain = combinedMatrix(reqs).sim;
    near(plain[0][1], 0.8);
    const withEv = combinedMatrix(reqs, new Map([['A|C', { idMention: 1, coref: 0 }]])).sim;
    near(withEv[0][2], 0.15);
    near(withEv[2][0], 0.15);
    near(withEv[0][1], 0.8);
  });

  it('combinedMatrix uses the profile only when BOTH requirements have one', () => {
    const reqs = [
      { reqId: 'A', embedding: [1, 0], signalProfile: { vector: [0, 1], count: 10 } },
      { reqId: 'B', embedding: [0, 1], signalProfile: { vector: [0, 1], count: 10 } },
      { reqId: 'C', embedding: [0, 1] },
    ];
    const m = combinedMatrix(reqs).sim;
    near(m[0][1], 0.65 * 0 + 0.35 * 1); // text 0, profile 1
    near(m[0][2], 0); // C has no profile
  });
});

describe('evidence extraction', () => {
  const ids = ['RET-R01', 'RET-R04', 'RET-R07', 'RET-R040'];
  const alt = (a, b, c) => [{ requirementId: 'RET-R01', similarity: a }, { requirementId: 'RET-R04', similarity: b }, { requirementId: 'RET-R07', similarity: c }];

  it('finds ids of this project, case-insensitively, without matching inside longer ids', () => {
    assert.deepEqual(mentionedIds('ret-r04 depends on RET-R07, see RET-R040 too', ids), ['RET-R04', 'RET-R07', 'RET-R040']);
    assert.deepEqual(mentionedIds('RET-R040 only', ids), ['RET-R040']);
    assert.deepEqual(mentionedIds('XRET-R04 and RET-R041 and RET-R04x', ids), []);
    assert.deepEqual(mentionedIds('ABC-R01 is another project', ids), []);
    assert.deepEqual(mentionedIds('RET-R04, RET-R04 again', ids), ['RET-R04']);
  });

  it('two or more ids make pairs (sorted, one row per pair)', () => {
    const rows = extractEvidence({ text: 'RET-R07 blocks RET-R01 and RET-R04', requirementId: 'RET-R01', alternatives: alt(0.9, 0.2, 0.1), projectReqIds: ids });
    assert.deepEqual(rows.map((r) => `${r.kind}:${r.reqA}|${r.reqB}`), ['idmention:RET-R01|RET-R04', 'idmention:RET-R01|RET-R07', 'idmention:RET-R04|RET-R07']);
    assert.equal(rows[0].similarityA, 0.9);
    assert.equal(rows[0].similarityB, 0.2);
  });

  it('one id plus the matched requirement makes a pair; the matched requirement alone makes none', () => {
    const rows = extractEvidence({ text: 'This depends on RET-R04.', requirementId: 'RET-R07', alternatives: [], projectReqIds: ids });
    assert.deepEqual(rows.map((r) => [r.kind, r.reqA, r.reqB]), [['idmention', 'RET-R04', 'RET-R07']]);
    assert.deepEqual(extractEvidence({ text: 'About RET-R07 itself', requirementId: 'RET-R07', alternatives: [], projectReqIds: ids }), []);
  });

  it('co-reference: top two both >= 0.40 and within 0.10', () => {
    const rows = extractEvidence({ text: 'no ids here', requirementId: 'RET-R01', alternatives: alt(0.62, 0.55, 0.2), projectReqIds: ids });
    assert.deepEqual(rows.map((r) => [r.kind, r.reqA, r.reqB, r.similarityA, r.similarityB]), [['coref', 'RET-R01', 'RET-R04', 0.62, 0.55]]);
  });

  it('co-reference needs both similarities >= 0.40, a gap <= 0.10, and the applied requirement to be one of the two', () => {
    const run = (alternatives, requirementId = 'RET-R01') => extractEvidence({ text: 'x', requirementId, alternatives, projectReqIds: ids });
    assert.equal(run(alt(0.62, 0.39, 0.1)).length, 0); // second too low
    assert.equal(run(alt(0.80, 0.60, 0.1)).length, 0); // gap 0.20
    assert.equal(run(alt(0.50, 0.40, 0.1)).length, 1); // gap exactly 0.10, second exactly 0.40
    assert.equal(run(alt(0.62, 0.55, 0.2), 'RET-R07').length, 0); // a correction to another requirement
    assert.equal(run([{ requirementId: 'RET-R01', similarity: 0.9 }]).length, 0); // manual match: no alternatives
  });

  it('an id mention wins over a co-reference of the same pair (one row per signal and pair)', () => {
    const rows = extractEvidence({ text: 'RET-R01 and RET-R04 again', requirementId: 'RET-R01', alternatives: alt(0.62, 0.55, 0.2), projectReqIds: ids });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'idmention');
  });
});

describe('signal profile', () => {
  const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

  it('starts from the (normalised) embedding with count 1', () => {
    const p = updateProfile(null, [3, 4]);
    assert.deepEqual(p.vector.map((x) => Math.round(x * 1e6) / 1e6), [0.6, 0.8]);
    assert.equal(p.count, 1);
  });

  it('EMA: normalize(0.85 * profile + 0.15 * embedding), count + 1', () => {
    const p = updateProfile({ vector: [1, 0], count: 3 }, [0, 1]);
    const raw = [0.85, 0.15];
    const n = norm(raw);
    near(p.vector[0], raw[0] / n);
    near(p.vector[1], raw[1] / n);
    near(norm(p.vector), 1);
    assert.equal(p.count, 4);
  });

  it('moves toward repeated signals', () => {
    let p = { vector: [1, 0], count: 1 };
    for (let i = 0; i < 20; i += 1) p = updateProfile(p, [0, 1]);
    assert.ok(p.vector[1] > 0.95);
    assert.equal(p.count, 21);
  });
});

describe('link diff (incremental update)', () => {
  it('lists added and removed links; kept links with a new weight are only "reweighted"', () => {
    const stored = [{ reqA: 'A', reqB: 'B', weight: 0.7 }, { reqA: 'B', reqB: 'C', weight: 0.6 }];
    const computed = [{ reqA: 'A', reqB: 'B', weight: 0.75 }, { reqA: 'A', reqB: 'C', weight: 0.65 }];
    const d = diffLinks(stored, computed);
    assert.deepEqual(d.added.map((l) => l.id), ['A~C~semantic']);
    assert.deepEqual(d.removed.map((l) => l.id), ['B~C~semantic']);
    assert.deepEqual(d.reweighted.map((l) => l.id), ['A~B~semantic']);
    const same = diffLinks(stored, stored.map((l) => ({ ...l })));
    assert.equal(same.added.length + same.removed.length + same.reweighted.length, 0);
  });
});

describe('alignment score and bands', () => {
  const L = (...pairs) => pairs.map(([source, target]) => ({ source, target }));

  it('Jaccard over undirected link sets, rounded', () => {
    assert.equal(jaccardScore(L(['A', 'B'], ['B', 'C']), L(['B', 'A'], ['C', 'B'])), 100); // direction does not matter
    assert.equal(jaccardScore(L(['A', 'B'], ['B', 'C']), L(['A', 'B'], ['A', 'C'])), 33); // 1 / 3
    assert.equal(jaccardScore(L(['A', 'B'], ['B', 'C']), L(['A', 'B'], ['B', 'C'], ['A', 'C'])), 67); // 2 / 3
    assert.equal(jaccardScore(L(['A', 'B']), L(['C', 'D'])), 0);
  });

  it('two empty sets are identical; one empty set against a non-empty one is 0', () => {
    assert.equal(jaccardScore([], []), 100);
    assert.equal(jaccardScore([], L(['A', 'B'])), 0);
  });

  it('accepts link ids as well as link objects', () => {
    assert.equal(jaccardScore(L(['A', 'B']), [{ reqA: 'A', reqB: 'B' }]), 100);
  });

  it('bands: >= 80 Strong, 60-79 Moderate, below 60 Significant', () => {
    assert.equal(bandOf(100), 'Strong Alignment');
    assert.equal(bandOf(80), 'Strong Alignment');
    assert.equal(bandOf(79), 'Moderate Drift');
    assert.equal(bandOf(60), 'Moderate Drift');
    assert.equal(bandOf(59), 'Significant Drift');
    assert.equal(bandOf(0), 'Significant Drift');
  });
});

describe('alignment history rebuild (replay of NETWORK_UPDATE entries)', () => {
  // Asia/Colombo is UTC+5:30: 20:00Z on 1 June is already 2 June in Colombo.
  const base = L2(['A', 'B'], ['B', 'C'], ['C', 'D']);
  function L2(...pairs) { return pairs.map(([source, target]) => ({ source, target })); }
  const up = (iso, added, removed, sig) => ({ timestamp: new Date(iso), added, removed, triggeringSignalId: sig });

  it('days are Asia/Colombo days', () => {
    assert.equal(dayOf('2026-06-01T20:00:00Z'), '2026-06-02');
    assert.equal(dayOf('2026-06-01T18:29:00Z'), '2026-06-01');
  });

  it('no updates: a single point at 100', () => {
    const { history } = rebuildHistory({ baselineLinks: base, baselineDate: '2026-06-01T05:00:00Z', updates: [] });
    assert.deepEqual(history, [{ date: '2026-06-01', alignmentScore: 100, connectionsAdded: 0, connectionsRemoved: 0, changedConnections: 0, driverSignalId: null }]);
  });

  it('replays added/removed, carries the score over quiet days, and names a driver only when >= 2 connections changed', () => {
    const { history, links } = rebuildHistory({
      baselineLinks: base, baselineDate: '2026-06-01T05:00:00Z',
      updates: [
        up('2026-06-02T05:00:00Z', ['A~C~semantic'], [], 'SC-1'), // 1 change: no driver
        up('2026-06-04T05:00:00Z', ['A~D~semantic'], ['B~C~semantic'], 'SC-2'), // 2 changes: SC-2
        up('2026-06-04T09:00:00Z', ['B~D~semantic'], [], 'SC-3'), // same day, smaller change
      ],
    });
    assert.deepEqual(history.map((h) => h.date), ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
    // day 2: base {AB,BC,CD} + AC -> 3/4 = 75
    assert.equal(history[1].alignmentScore, 75);
    assert.deepEqual([history[1].connectionsAdded, history[1].connectionsRemoved, history[1].changedConnections, history[1].driverSignalId], [1, 0, 1, null]);
    // day 3: nothing happened: carried forward, zero counts
    assert.equal(history[2].alignmentScore, 75);
    assert.equal(history[2].changedConnections, 0);
    // day 4: + AD, - BC, + BD -> current {AB,CD,AC,AD,BD}; common = AB,CD = 2, union = 3 + 5 - 2 = 6 -> 33
    assert.equal(history[3].alignmentScore, 33);
    assert.deepEqual([history[3].connectionsAdded, history[3].connectionsRemoved, history[3].changedConnections], [2, 1, 3]);
    assert.equal(history[3].driverSignalId, 'SC-2'); // the largest single change that day
    assert.equal(links.size, 5);
  });

  it('a signal-less update (requirement edit, recompute) counts but is never named as a driver', () => {
    const { history } = rebuildHistory({
      baselineLinks: base, baselineDate: '2026-06-01T05:00:00Z',
      updates: [up('2026-06-02T05:00:00Z', ['A~C~semantic', 'A~D~semantic'], [], null)],
    });
    assert.equal(history[1].changedConnections, 2);
    assert.equal(history[1].driverSignalId, null);
  });

  it('ignores updates from before the baseline and caps the history at 90 days', () => {
    const early = rebuildHistory({ baselineLinks: base, baselineDate: '2026-06-10T05:00:00Z', updates: [up('2026-06-01T05:00:00Z', ['A~C~semantic'], [], 'SC-9')] });
    assert.equal(early.history.length, 1);
    assert.equal(early.history[0].alignmentScore, 100);
    const long = rebuildHistory({ baselineLinks: base, baselineDate: '2026-01-01T05:00:00Z', updates: [up('2026-08-01T05:00:00Z', ['A~C~semantic'], [], 'SC-1')] });
    assert.equal(long.history.length, K.HISTORY_MAX_DAYS);
    assert.equal(long.history.at(-1).date, '2026-08-01');
    assert.equal(long.history.at(-1).alignmentScore, 75);
  });
});
