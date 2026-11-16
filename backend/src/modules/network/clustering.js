'use strict';
// Pure agglomerative clustering (average linkage) on a distance matrix, plus cluster naming.
// The app cuts the dendrogram to k clusters (agglomerateToK, k from targetClusterCount); the distance-cutoff
// cut (agglomerate) is kept for the evaluation. group_id from the CSV is never an input here.

// Distance cutoff for agglomerate(): clusters are merged while their average pairwise distance is <= this value
// (distance = 1 - cosine). NOT used by the app any more (it gave 18 clusters for 31 requirements); it is the value
// `npm run network:evaluate` found by tuning against group_id and is kept so the evaluation can still report it.
const DEFAULT_CUTOFF = 0.6;

/**
 * Number of clusters the app asks for: k = clamp(round(sqrt(n)), 3, 8), never more than n.
 * Chosen for usability in the UI. It is NOT tuned on group_id (or anything else in the data).
 */
function targetClusterCount(n) {
  if (n <= 0) return 0;
  return Math.min(n, Math.max(3, Math.min(8, Math.round(Math.sqrt(n)))));
}

/**
 * Shared average-linkage loop: repeatedly merge the two closest clusters (smallest average distance, ties keep the
 * earliest pair) while `shouldMerge(bestDistance, clusterCount)` says so.
 * Clusters are numbered by size (largest first), then by smallest node index, so the result is deterministic.
 */
function dendrogramCut(dist, shouldMerge) {
  const n = dist.length;
  let clusters = Array.from({ length: n }, (_, i) => [i]);
  const avg = (a, b) => {
    let s = 0;
    for (const i of a) for (const j of b) s += i < j ? dist[i][j] : dist[j][i];
    return s / (a.length * b.length);
  };
  for (;;) {
    let best = null;
    for (let a = 0; a < clusters.length; a += 1) {
      for (let b = a + 1; b < clusters.length; b += 1) {
        const d = avg(clusters[a], clusters[b]);
        if (best === null || d < best.d - 1e-12) best = { a, b, d }; // strict: ties keep the earliest pair
      }
    }
    if (best === null || !shouldMerge(best.d, clusters.length)) break;
    clusters[best.a] = [...clusters[best.a], ...clusters[best.b]].sort((x, y) => x - y);
    clusters = clusters.filter((_, idx) => idx !== best.b);
  }
  clusters.sort((x, y) => y.length - x.length || x[0] - y[0]);
  const assign = new Array(n);
  clusters.forEach((members, c) => members.forEach((i) => { assign[i] = c; }));
  return assign;
}

/** Cut the average-linkage dendrogram at a distance cutoff. @returns {number[]} cluster index (0-based) per node. */
const agglomerate = (dist, cutoff = DEFAULT_CUTOFF) => dendrogramCut(dist, (d) => d <= cutoff);

/** Cut the SAME dendrogram so that exactly min(k, n) clusters remain. @returns {number[]} cluster index per node. */
const agglomerateToK = (dist, k) => dendrogramCut(dist, (_d, count) => count > Math.max(1, k));

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'under', 'across', 'via', 'per', 'from', 'into', 'over', 'than', 'that', 'this', 'are', 'not', 'all', 'any', 'can']);
const words = (title) => [...new Set(String(title).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])].filter((w) => !STOPWORDS.has(w));

/**
 * Names clusters "Cluster k (word1, word2)" with the two most distinctive title words: term frequency inside the
 * cluster times (1 + ln(clusters / clusters containing the word)). Ties go alphabetically.
 * @returns {Array<{ id: string, label: string, index: number, members: number[] }>}
 */
function describeClusters(assign, titles) {
  const K = assign.length ? Math.max(...assign) + 1 : 0;
  const members = Array.from({ length: K }, () => []);
  assign.forEach((c, i) => members[c].push(i));
  const tf = members.map((m) => {
    const counts = new Map();
    m.forEach((i) => words(titles[i]).forEach((w) => counts.set(w, (counts.get(w) || 0) + 1)));
    return counts;
  });
  const df = new Map();
  tf.forEach((counts) => counts.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)));
  return members.map((m, c) => {
    const top = [...tf[c].entries()]
      .map(([w, f]) => ({ w, score: f * (1 + Math.log(K / df.get(w))) }))
      .sort((x, y) => y.score - x.score || x.w.localeCompare(y.w))
      .slice(0, 2)
      .map((x) => x.w);
    return { id: `cluster-${c + 1}`, label: `Cluster ${c + 1}${top.length ? ` (${top.join(', ')})` : ''}`, index: c, members: m };
  });
}

module.exports = { agglomerateToK, targetClusterCount, agglomerate, describeClusters, DEFAULT_CUTOFF };
