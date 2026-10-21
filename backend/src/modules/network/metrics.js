'use strict';
// Pure evaluation maths for the network (used by `npm run network:evaluate` and unit-tested).

const choose2 = (x) => (x * (x - 1)) / 2;

function contingency(a, b) {
  const rows = [...new Set(a)];
  const cols = [...new Set(b)];
  const table = rows.map(() => cols.map(() => 0));
  a.forEach((x, i) => { table[rows.indexOf(x)][cols.indexOf(b[i])] += 1; });
  return table;
}

/** Adjusted Rand index (same formula as scikit-learn). 1 = identical partitions, ~0 = random. */
function adjustedRandIndex(a, b) {
  const n = a.length;
  if (n < 2) return 1;
  const t = contingency(a, b);
  const sumCells = t.flat().reduce((s, x) => s + choose2(x), 0);
  const sumRows = t.reduce((s, r) => s + choose2(r.reduce((x, y) => x + y, 0)), 0);
  const sumCols = t[0].map((_, j) => t.reduce((s, r) => s + r[j], 0)).reduce((s, x) => s + choose2(x), 0);
  const expected = (sumRows * sumCols) / choose2(n);
  const max = (sumRows + sumCols) / 2;
  if (max === expected) return 1; // both partitions are trivial and identical in structure
  return (sumCells - expected) / (max - expected);
}

const entropy = (counts, n) => -counts.filter((c) => c > 0).reduce((s, c) => s + (c / n) * Math.log(c / n), 0);

/** Normalized mutual information, arithmetic-mean normalization (scikit-learn default). */
function normalizedMutualInfo(a, b) {
  const n = a.length;
  const t = contingency(a, b);
  const rowSums = t.map((r) => r.reduce((x, y) => x + y, 0));
  const colSums = t[0].map((_, j) => t.reduce((s, r) => s + r[j], 0));
  const ha = entropy(rowSums, n);
  const hb = entropy(colSums, n);
  if (ha === 0 && hb === 0) return 1;
  let mi = 0;
  t.forEach((row, i) => row.forEach((c, j) => { if (c > 0) mi += (c / n) * Math.log((c * n) / (rowSums[i] * colSums[j])); }));
  return (2 * mi) / (ha + hb);
}

/**
 * Nearest-neighbour hit rates. For each node with at least one same-group partner: are its top-k most similar
 * OTHER nodes (ties: lower index first) containing a same-group node?
 */
function hitAtK(sim, groups, ks = [1, 3]) {
  const n = sim.length;
  const hits = Object.fromEntries(ks.map((k) => [k, 0]));
  let counted = 0;
  for (let i = 0; i < n; i += 1) {
    if (!groups.some((g, j) => j !== i && g === groups[i])) continue;
    counted += 1;
    const order = [...Array(n).keys()].filter((j) => j !== i).sort((x, y) => sim[i][y] - sim[i][x] || x - y);
    for (const k of ks) if (order.slice(0, k).some((j) => groups[j] === groups[i])) hits[k] += 1;
  }
  return { counted, hits };
}

/** Exact expected hit@k if the nearest neighbours were picked uniformly at random (n nodes, group of size g). */
function randomHitExpectation(n, g, k) {
  const others = n - 1;
  const outside = n - g;
  if (g < 2) return 0;
  if (k >= others) return 1;
  let none = 1; // probability that none of the k picks is in the group (hypergeometric)
  for (let i = 0; i < k; i += 1) none *= (outside - i) / (others - i);
  return 1 - Math.max(0, none);
}

/** Share of edges whose endpoints are in the same group or form a listed dependency pair. */
function edgePrecision(edges, groups, dependencyPairs = new Set()) {
  if (!edges.length) return null;
  const good = edges.filter(([i, j]) => groups[i] === groups[j] || dependencyPairs.has(`${Math.min(i, j)}~${Math.max(i, j)}`)).length;
  return good / edges.length;
}

/** Top-E most similar pairs (ties: lower indices first), as index pairs. */
function topPairs(sim, e) {
  const pairs = [];
  for (let i = 0; i < sim.length; i += 1) for (let j = i + 1; j < sim.length; j += 1) pairs.push([i, j]);
  return pairs.sort((p, q) => sim[q[0]][q[1]] - sim[p[0]][p[1]] || p[0] - q[0] || p[1] - q[1]).slice(0, e);
}

function connected(nodes, edges) {
  if (nodes.length < 2) return true;
  const set = new Set(nodes);
  const adj = new Map(nodes.map((x) => [x, []]));
  edges.forEach(([i, j]) => { if (set.has(i) && set.has(j)) { adj.get(i).push(j); adj.get(j).push(i); } });
  const seen = new Set([nodes[0]]);
  const stack = [nodes[0]];
  while (stack.length) for (const nb of adj.get(stack.pop())) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
  return seen.size === nodes.length;
}

/**
 * Group connectivity. `inside` = share of ground-truth groups (size >= 2) whose members are connected using only
 * edges BETWEEN members of that group. `wholeGraph` = members connected anywhere in the graph (trivially 1 for
 * Pathfinder on a complete graph, reported only for reference).
 */
function groupConnectivity(edges, groups) {
  const byGroup = new Map();
  groups.forEach((g, i) => byGroup.set(g, [...(byGroup.get(g) || []), i]));
  const multi = [...byGroup.values()].filter((m) => m.length >= 2);
  const all = [...Array(groups.length).keys()];
  return {
    groups: multi.length,
    inside: multi.length ? multi.filter((m) => connected(m, edges)).length / multi.length : null,
    wholeGraph: multi.length ? multi.filter((m) => {
      const seen = new Set([m[0]]);
      const stack = [m[0]];
      const adj = new Map(all.map((x) => [x, []]));
      edges.forEach(([i, j]) => { adj.get(i).push(j); adj.get(j).push(i); });
      while (stack.length) for (const nb of adj.get(stack.pop())) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      return m.every((x) => seen.has(x));
    }).length / multi.length : null,
  };
}

// ---- TF-IDF cosine baseline (lowercase word tokens, smoothed idf, L2-normalised)
const tokens = (t) => String(t).toLowerCase().match(/[a-z][a-z0-9-]+/g) || [];

function tfidfVectors(texts) {
  const docs = texts.map(tokens);
  const vocab = [...new Set(docs.flat())].sort();
  const index = new Map(vocab.map((w, i) => [w, i]));
  const df = new Array(vocab.length).fill(0);
  docs.forEach((d) => new Set(d).forEach((w) => { df[index.get(w)] += 1; }));
  return docs.map((d) => {
    const v = new Array(vocab.length).fill(0);
    const tf = new Map();
    d.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1));
    tf.forEach((c, w) => { v[index.get(w)] = (1 + Math.log(c)) * (Math.log((1 + texts.length) / (1 + df[index.get(w)])) + 1); });
    return v;
  });
}

module.exports = { adjustedRandIndex, normalizedMutualInfo, hitAtK, randomHitExpectation, edgePrecision, topPairs, groupConnectivity, tfidfVectors };
