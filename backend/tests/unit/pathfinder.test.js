'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pathfinder, cosineMatrix, distanceMatrix } = require('../../src/modules/network/pathfinder');

test('a triangle with distances 1, 1, 3 prunes the 3-edge', () => {
  const d = [[0, 1, 3], [1, 0, 1], [3, 1, 0]]; // d(0,1)=1, d(1,2)=1, d(0,2)=3
  assert.deepEqual(pathfinder(d), [[0, 1], [1, 2]]);
});

test('equal-length ties are all kept (standard PFNET)', () => {
  const d = [[0, 1, 1], [1, 0, 1], [1, 1, 0]];
  assert.deepEqual(pathfinder(d), [[0, 1], [0, 2], [1, 2]]);
});

test('a path-like metric keeps only neighbouring nodes', () => {
  const d = [0, 1, 2, 3, 4].map((i) => [0, 1, 2, 3, 4].map((j) => Math.abs(i - j)));
  assert.deepEqual(pathfinder(d), [[0, 1], [1, 2], [2, 3], [3, 4]]);
});

test('a 4-cycle: the two equal long sides are both kept, the diagonals are pruned', () => {
  // 0-1:1, 1-2:2, 2-3:1, 3-0:2, diagonals 3
  const d = [[0, 1, 3, 2], [1, 0, 2, 3], [3, 2, 0, 1], [2, 3, 1, 0]];
  assert.deepEqual(pathfinder(d), [[0, 1], [0, 3], [1, 2], [2, 3]]);
});

test('float noise inside the tolerance counts as a tie, a real difference does not', () => {
  const near = [[0, 0.3, 0.3000000004], [0.3, 0, 0.3], [0.3000000004, 0.3, 0]];
  assert.equal(pathfinder(near).length, 3);
  const far = [[0, 0.3, 0.31], [0.3, 0, 0.3], [0.31, 0.3, 0]];
  assert.deepEqual(pathfinder(far), [[0, 1], [1, 2]]);
});

test('only the upper triangle is read, so the result is symmetric by construction', () => {
  const d = [[0, 1, 3], [99, 0, 1], [-5, 7, 0]]; // garbage below the diagonal
  assert.deepEqual(pathfinder(d), [[0, 1], [1, 2]]);
});

test('deterministic, and independent of the order the nodes are listed in', () => {
  const rnd = (() => { let s = 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const n = 9;
  const d = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) { d[i][j] = Math.round(rnd() * 1000) / 1000 + 0.01; d[j][i] = d[i][j]; }
  const base = pathfinder(d);
  assert.deepEqual(pathfinder(d), base);
  const perm = [3, 0, 7, 1, 8, 2, 6, 4, 5];
  const dp = perm.map((a) => perm.map((b) => d[a][b]));
  const mapped = pathfinder(dp).map(([i, j]) => [perm[i], perm[j]].sort((x, y) => x - y).join('-')).sort();
  assert.deepEqual(mapped, base.map(([i, j]) => `${i}-${j}`).sort());
});

test('cosine similarity and distance matrices', () => {
  const sim = cosineMatrix([[1, 0], [0, 1], [2, 0]]);
  assert.equal(sim[0][1], 0);
  assert.equal(sim[0][2], 1);
  assert.equal(sim[1][0], 0);
  const dist = distanceMatrix(sim);
  assert.equal(dist[0][2], 0);
  assert.equal(dist[0][1], 1);
});
