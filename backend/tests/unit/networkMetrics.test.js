'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../../src/modules/network/metrics');
const { cosineMatrix } = require('../../src/modules/network/pathfinder');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('adjusted Rand index', () => {
  close(m.adjustedRandIndex([0, 0, 1, 1], [5, 5, 9, 9]), 1); // same partition, different label names
  close(m.adjustedRandIndex([0, 0, 1, 1], [0, 0, 1, 2]), 4 / 7); // same value as scikit-learn
  assert.ok(m.adjustedRandIndex([0, 0, 0, 0, 1, 1, 1, 1], [0, 1, 0, 1, 0, 1, 0, 1]) <= 0); // unrelated -> not above 0
});

test('normalized mutual information (arithmetic mean)', () => {
  close(m.normalizedMutualInfo([0, 0, 1, 1], [7, 7, 3, 3]), 1);
  close(m.normalizedMutualInfo([0, 0, 1, 1], [0, 0, 1, 2]), 0.8);
  close(m.normalizedMutualInfo([0, 0, 0], [1, 1, 1]), 1);
});

test('hit@k and its random expectation', () => {
  const sim = [
    [1, 0.9, 0.1, 0.2],
    [0.9, 1, 0.3, 0.1],
    [0.1, 0.3, 1, 0.8],
    [0.2, 0.1, 0.8, 1],
  ];
  const r = m.hitAtK(sim, ['A', 'A', 'B', 'B'], [1, 2]);
  assert.deepEqual(r, { counted: 4, hits: { 1: 4, 2: 4 } });
  const r2 = m.hitAtK(sim, ['A', 'B', 'B', 'A'], [1, 3]);
  assert.equal(r2.hits[1], 0); // every node's single nearest neighbour is in the other group
  assert.equal(r2.hits[3], 4); // but within the top 3 (= everyone else) a partner is always found
  close(m.randomHitExpectation(10, 3, 1), 2 / 9);
  close(m.randomHitExpectation(10, 3, 3), 1 - (7 / 9) * (6 / 8) * (5 / 7));
  assert.equal(m.randomHitExpectation(10, 1, 1), 0);
});

test('edge precision and top pairs', () => {
  const groups = ['A', 'A', 'B', 'B'];
  assert.equal(m.edgePrecision([[0, 1], [2, 3], [0, 2]], groups), 2 / 3);
  assert.equal(m.edgePrecision([[0, 2]], groups, new Set(['0~2'])), 1); // listed dependency counts
  assert.equal(m.edgePrecision([], groups), null);
  const sim = [[1, 0.9, 0.2], [0.9, 1, 0.5], [0.2, 0.5, 1]];
  assert.deepEqual(m.topPairs(sim, 2), [[0, 1], [1, 2]]);
});

test('group connectivity: inside-the-group paths versus anywhere in the graph', () => {
  const groups = ['A', 'A', 'A', 'B', 'B'];
  const ok = m.groupConnectivity([[0, 1], [1, 2], [3, 4], [2, 3]], groups);
  assert.equal(ok.inside, 1);
  assert.equal(ok.wholeGraph, 1);
  // A = {0,1,2} is only connected THROUGH node 3 (a B node) -> not connected inside the group
  const viaOutsider = m.groupConnectivity([[0, 1], [0, 3], [3, 2], [3, 4]], groups);
  assert.equal(viaOutsider.groups, 2);
  assert.equal(viaOutsider.inside, 0.5);
  assert.equal(viaOutsider.wholeGraph, 1);
});

test('tf-idf baseline: texts sharing words are more similar', () => {
  const sim = cosineMatrix(m.tfidfVectors(['Card payments checkout', 'Card payments wallet', 'Search filters speed']));
  assert.ok(sim[0][1] > sim[0][2]);
  assert.ok(sim[0][1] > 0 && sim[0][2] === 0);
});
