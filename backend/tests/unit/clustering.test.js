'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agglomerate, agglomerateToK, targetClusterCount, describeClusters, DEFAULT_CUTOFF } = require('../../src/modules/network/clustering');

// nodes 0,1,2 are close to each other, 3,4 are close to each other, the two groups are far apart
const blobs = [
  [0, 0.1, 0.12, 0.9, 0.95],
  [0.1, 0, 0.11, 0.92, 0.9],
  [0.12, 0.11, 0, 0.88, 0.93],
  [0.9, 0.92, 0.88, 0, 0.1],
  [0.95, 0.9, 0.93, 0.1, 0],
];

test('average linkage cut at a cutoff separates the two blobs', () => {
  assert.deepEqual(agglomerate(blobs, 0.5), [0, 0, 0, 1, 1]); // biggest cluster is number 0
});

test('a huge cutoff gives one cluster, a zero cutoff gives singletons', () => {
  assert.deepEqual(agglomerate(blobs, 5), [0, 0, 0, 0, 0]);
  assert.deepEqual(agglomerate(blobs, 0), [0, 1, 2, 3, 4]);
});

test('clusters are numbered by size, then by smallest member, and the result is deterministic', () => {
  const swapped = [3, 4, 0, 1, 2].map((a) => [3, 4, 0, 1, 2].map((b) => blobs[a][b])); // big blob now last
  assert.deepEqual(agglomerate(swapped, 0.5), [1, 1, 0, 0, 0]);
  assert.deepEqual(agglomerate(blobs, 0.5), agglomerate(blobs, 0.5));
});

test('cluster names use the two most distinctive title words, never a group id', () => {
  const titles = ['Card payments', 'Wallet payments', 'Search filters', 'Search speed', 'Refund payments'];
  const assign = [0, 0, 1, 1, 0];
  const c = describeClusters(assign, titles);
  assert.equal(c.length, 2);
  assert.equal(c[0].id, 'cluster-1');
  assert.equal(c[0].label, 'Cluster 1 (payments, card)');
  assert.equal(c[1].label, 'Cluster 2 (search, filters)');
  assert.deepEqual(c[0].members, [0, 1, 4]);
});

test('empty input and single nodes work', () => {
  assert.deepEqual(agglomerate([], 0.5), []);
  assert.deepEqual(agglomerate([[0]], 0.5), [0]);
  assert.deepEqual(describeClusters([0], ['Wishlist']).map((c) => c.label), ['Cluster 1 (wishlist)']);
});

test('targetClusterCount: k = clamp(round(sqrt(n)), 3, 8), never more than n', () => {
  const table = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 3, 9: 3, 23: 5, 26: 5, 31: 6, 34: 6, 36: 6, 49: 7, 64: 8, 100: 8, 400: 8 };
  for (const [n, k] of Object.entries(table)) assert.equal(targetClusterCount(Number(n)), k, `n=${n}`);
});

test('agglomerateToK cuts the same dendrogram to exactly k clusters', () => {
  assert.deepEqual(agglomerateToK(blobs, 2), [0, 0, 0, 1, 1]);
  assert.deepEqual(agglomerateToK(blobs, 1), [0, 0, 0, 0, 0]);
  assert.deepEqual(agglomerateToK(blobs, 5), [0, 1, 2, 3, 4]); // k = n: every node alone
  assert.deepEqual(agglomerateToK(blobs, 9), [0, 1, 2, 3, 4]); // k > n is clipped to n
  assert.deepEqual(agglomerateToK(blobs, 3).length, 5);
  assert.equal(new Set(agglomerateToK(blobs, 3)).size, 3);
  assert.equal(new Set(agglomerateToK(blobs, 4)).size, 4);
});

test('agglomerateToK gives the same partition as a distance cutoff that happens to produce k clusters', () => {
  assert.deepEqual(agglomerateToK(blobs, 2), agglomerate(blobs, 0.5));
  assert.deepEqual(agglomerateToK(blobs, 1), agglomerate(blobs, 5));
  assert.deepEqual(agglomerateToK(blobs, 5), agglomerate(blobs, 0));
});

test('agglomerateToK numbers clusters by size, then smallest member, and is deterministic', () => {
  const swapped = [3, 4, 0, 1, 2].map((a) => [3, 4, 0, 1, 2].map((b) => blobs[a][b]));
  assert.deepEqual(agglomerateToK(swapped, 2), [1, 1, 0, 0, 0]);
  assert.deepEqual(agglomerateToK(blobs, 3), agglomerateToK(blobs, 3));
  assert.deepEqual(agglomerateToK([], 3), []);
  assert.deepEqual(agglomerateToK([[0]], 3), [0]);
});

test('the old cutoff and its constant are still available', () => {
  assert.equal(DEFAULT_CUTOFF, 0.6);
  assert.deepEqual(agglomerate(blobs), [0, 0, 0, 1, 1]);
});
