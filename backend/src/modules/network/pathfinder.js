'use strict';
// Pure Pathfinder network scaling, PFNET(r = infinity, q = n - 1).
//
// Input: a symmetric n x n distance matrix d (smaller = more related). Only the upper triangle is read, so the
// result is symmetric by construction. Minimax path distances D (the weight of a path is its LARGEST edge) are
// computed with Floyd-Warshall, and edge (i, j) is kept only if no indirect path has all its edges shorter than
// d(i, j), i.e. d(i, j) <= D(i, j). Ties are kept (standard PFNET), within a small tolerance for float noise.
// On a complete graph the result is the union of all minimum spanning trees.

const TOLERANCE = 1e-6;

/** @returns {Array<[number, number]>} kept edges as index pairs i < j, sorted. Deterministic. */
function pathfinder(dist, { tolerance = TOLERANCE } = {}) {
  const n = dist.length;
  const d = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const v = Number(dist[i][j]);
      if (!Number.isFinite(v)) throw new Error(`distance (${i}, ${j}) is not a finite number`);
      d[i][j] = v;
      d[j][i] = v;
    }
  }
  const D = d.map((row) => row.slice());
  for (let k = 0; k < n; k += 1) {
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const via = Math.max(D[i][k], D[k][j]);
        if (via < D[i][j]) D[i][j] = via;
      }
    }
  }
  const edges = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (d[i][j] <= D[i][j] + tolerance) edges.push([i, j]);
    }
  }
  return edges;
}

/** Cosine similarity matrix (rounded to 6 decimals so exact ties stay ties) of row vectors. */
function cosineMatrix(vectors) {
  const norm = vectors.map((v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1);
  const n = vectors.length;
  const sim = Array.from({ length: n }, () => new Array(n).fill(1));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      let dot = 0;
      for (let k = 0; k < vectors[i].length; k += 1) dot += vectors[i][k] * vectors[j][k];
      const s = Math.round((dot / (norm[i] * norm[j])) * 1e6) / 1e6;
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }
  return sim;
}

/** d = 1 - similarity, never negative. */
const distanceMatrix = (sim) => sim.map((row) => row.map((s) => Math.max(0, Math.round((1 - s) * 1e6) / 1e6)));

module.exports = { pathfinder, cosineMatrix, distanceMatrix, TOLERANCE };
