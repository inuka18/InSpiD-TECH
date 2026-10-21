'use strict';
// npm run network:evaluate  -  evaluate the computed network against the answer key (network_ground_truth).
// Uses the SAME pathfinder.js / clustering.js the app runs. Read-only. Needs the ai-service (/embed).
// Writes docs/network_evaluation.md and .json (DOCS_DIR, default /docs).
//
// Nothing is tuned on the ground truth EXCEPT the old clustering distance cutoff (see the report).
// Section 6 replays the scenario train + val signals offline and in memory (no database writes) through the evidence and
// signal-profile code and compares the text-only network with the signal-informed one.
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../config/env');
const { connectDb } = require('../config/db');
const aiClient = require('../shared/aiClient');
const { Project } = require('../modules/projects/model');
const { Requirement } = require('../modules/requirements/model');
const { NetworkGroundTruth } = require('../modules/network/model');
const { Signal } = require('../modules/signals/model');
const { analyseSignals, replay, signalMatrix } = require('./signalReplay');
const { pathfinder, cosineMatrix, distanceMatrix } = require('../modules/network/pathfinder');
const { agglomerate, agglomerateToK, targetClusterCount, DEFAULT_CUTOFF } = require('../modules/network/clustering');
const M = require('../modules/network/metrics');

const DOCS_DIR = process.env.DOCS_DIR || '/docs';
const CUTOFFS = Array.from({ length: 31 }, (_, i) => Math.round((0.3 + i * 0.02) * 100) / 100); // 0.30 .. 0.90
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pct = (x) => (x === null || x === undefined ? '-' : `${(100 * x).toFixed(1)}%`);
const f2 = (x) => (x === null || x === undefined ? '-' : x.toFixed(2));
const f3 = (x) => (x === null || x === undefined ? '-' : x.toFixed(3));
const textOf = (r) => `${r.title}. ${r.description || ''}`.trim();

// The cutoff with the highest mean ARI over `projects`; if several tie, the middle one of the tied plateau.
function bestCutoff(projects) {
  const scored = CUTOFFS.map((c) => ({ c, ari: mean(projects.map((p) => M.adjustedRandIndex(agglomerate(p.dist, c), p.groups))) }));
  const top = Math.max(...scored.map((s) => s.ari));
  const tied = scored.filter((s) => Math.abs(s.ari - top) < 1e-9).map((s) => s.c);
  return { cutoff: tied[Math.floor((tied.length - 1) / 2)], ari: top, sweep: scored };
}

(async () => {
  await connectDb();
  const projectDocs = await Project.find({}).sort({ projectId: 1 }).lean();
  const data = [];
  for (const pd of projectDocs) {
    const reqs = await Requirement.find({ projectId: pd.projectId }).sort({ reqId: 1 }).lean();
    if (reqs.length < 3) continue;
    const gt = await NetworkGroundTruth.find({ projectId: pd.projectId }).lean();
    if (!gt.length) throw new Error(`No network_ground_truth for ${pd.projectId}: run npm run seed first.`);
    const idx = new Map(reqs.map((r, i) => [r.reqId, i]));
    const emb = await aiClient.embed(reqs.map(textOf));
    const sim = cosineMatrix(emb.vectors);
    const tfSim = cosineMatrix(M.tfidfVectors(reqs.map(textOf)));
    const deps = new Set(gt.filter((g) => g.relationType === 'dependency').map((g) => `${Math.min(idx.get(g.reqA), idx.get(g.reqB))}~${Math.max(idx.get(g.reqA), idx.get(g.reqB))}`));
    const signals = await Signal.find({ projectId: pd.projectId, split: { $in: ['train', 'val'] } }).sort({ timestamp: 1, signalId: 1 }).lean();
    data.push({ projectId: pd.projectId, n: reqs.length, groups: reqs.map((r) => r.groupId), sim, tfSim, dist: distanceMatrix(sim), deps, reqs, vectors: emb.vectors, signals });
  }
  if (!data.length) throw new Error('No projects with requirements found; run npm run seed first.');

  // ---- clustering cutoff: in-sample (all projects) and leave-one-project-out
  const inSample = bestCutoff(data);
  const lopo = data.map((p) => {
    const others = data.filter((q) => q !== p);
    const chosen = bestCutoff(others);
    const a = agglomerate(p.dist, chosen.cutoff);
    return { projectId: p.projectId, nodes: p.n, cutoff: chosen.cutoff, ari: M.adjustedRandIndex(a, p.groups), nmi: M.normalizedMutualInfo(a, p.groups), clusters: new Set(a).size, avgSize: p.n / new Set(a).size };
  });
  const inSampleRows = data.map((p) => {
    const a = agglomerate(p.dist, inSample.cutoff);
    return { projectId: p.projectId, nodes: p.n, cutoff: inSample.cutoff, ari: M.adjustedRandIndex(a, p.groups), nmi: M.normalizedMutualInfo(a, p.groups), clusters: new Set(a).size, avgSize: p.n / new Set(a).size, groundTruthGroups: new Set(p.groups).size };
  });
  // What the app uses: the same dendrogram cut to k = clamp(round(sqrt(n)), 3, 8) clusters. k is NOT tuned on anything.
  const kRows = data.map((p) => {
    const k = targetClusterCount(p.n);
    const a = agglomerateToK(p.dist, k);
    return { projectId: p.projectId, nodes: p.n, k, ari: M.adjustedRandIndex(a, p.groups), nmi: M.normalizedMutualInfo(a, p.groups), clusters: new Set(a).size, avgSize: p.n / new Set(a).size, groundTruthGroups: new Set(p.groups).size };
  });

  // ---- per-project network metrics
  const rows = data.map((p) => {
    const edges = pathfinder(p.dist);
    const pairs = (p.n * (p.n - 1)) / 2;
    const topE = M.topPairs(p.sim, edges.length);
    const allPairs = M.topPairs(p.sim, pairs);
    const nn = (sim) => M.hitAtK(sim, p.groups, [1, 3]);
    const mini = nn(p.sim);
    const tf = nn(p.tfSim);
    const sizes = new Map();
    p.groups.forEach((g) => sizes.set(g, (sizes.get(g) || 0) + 1));
    const rnd = { 1: 0, 3: 0 };
    let counted = 0;
    p.groups.forEach((g) => { if (sizes.get(g) >= 2) { counted += 1; [1, 3].forEach((k) => { rnd[k] += M.randomHitExpectation(p.n, sizes.get(g), k); }); } });
    const conn = M.groupConnectivity(edges, p.groups);
    return {
      projectId: p.projectId, nodes: p.n, groupsInTruth: sizes.size, pathfinderEdges: edges.length, allPairs: pairs,
      edgeReductionPct: 100 * (1 - edges.length / pairs),
      nn: { counted, minilm: { hit1: mini.hits[1], hit3: mini.hits[3] }, tfidf: { hit1: tf.hits[1], hit3: tf.hits[3] }, random: { hit1: rnd[1], hit3: rnd[3] } },
      edgePrecision: {
        pathfinder: M.edgePrecision(edges, p.groups, p.deps), topSimilarity: M.edgePrecision(topE, p.groups, p.deps),
        allPairs: M.edgePrecision(allPairs, p.groups, p.deps),
        pathfinderEdgeCount: edges.length, goodPathfinderEdges: Math.round(M.edgePrecision(edges, p.groups, p.deps) * edges.length),
        goodTopEdges: Math.round(M.edgePrecision(topE, p.groups, p.deps) * topE.length),
      },
      connectivity: conn,
    };
  });
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const overall = {
    nodes: sum((r) => r.nodes), pathfinderEdges: sum((r) => r.pathfinderEdges), allPairs: sum((r) => r.allPairs),
    nn: {
      counted: sum((r) => r.nn.counted),
      minilm: { hit1: sum((r) => r.nn.minilm.hit1), hit3: sum((r) => r.nn.minilm.hit3) },
      tfidf: { hit1: sum((r) => r.nn.tfidf.hit1), hit3: sum((r) => r.nn.tfidf.hit3) },
      random: { hit1: sum((r) => r.nn.random.hit1), hit3: sum((r) => r.nn.random.hit3) },
    },
    goodPathfinderEdges: sum((r) => r.edgePrecision.goodPathfinderEdges), goodTopEdges: sum((r) => r.edgePrecision.goodTopEdges),
    groups: sum((r) => r.connectivity.groups),
    insideConnected: sum((r) => Math.round(r.connectivity.inside * r.connectivity.groups)),
    wholeConnected: sum((r) => Math.round(r.connectivity.wholeGraph * r.connectivity.groups)),
    lopo: { ari: mean(lopo.map((r) => r.ari)), nmi: mean(lopo.map((r) => r.nmi)) },
    inSample: { ari: mean(inSampleRows.map((r) => r.ari)), nmi: mean(inSampleRows.map((r) => r.nmi)) },
    kBased: { ari: mean(kRows.map((r) => r.ari)), nmi: mean(kRows.map((r) => r.nmi)) },
    clusterSummary: {
      kBased: { clusters: kRows.reduce((s, r) => s + r.clusters, 0), avgSize: sum((r) => r.nodes) / kRows.reduce((s, r) => s + r.clusters, 0) },
      cutoffLopo: { clusters: lopo.reduce((s, r) => s + r.clusters, 0), avgSize: sum((r) => r.nodes) / lopo.reduce((s, r) => s + r.clusters, 0) },
      cutoffInSample: { clusters: inSampleRows.reduce((s, r) => s + r.clusters, 0), avgSize: sum((r) => r.nodes) / inSampleRows.reduce((s, r) => s + r.clusters, 0) },
    },
  };

  // ---- signal-informed network: replay train + val signals (and, as a second view, val only) through the app's own logic
  const metricsOf = (p, sim) => {
    const edges = pathfinder(distanceMatrix(sim));
    const nn = M.hitAtK(sim, p.groups, [1, 3]);
    return { counted: nn.counted, hit1: nn.hits[1], hit3: nn.hits[3], edges: edges.length, goodEdges: Math.round(M.edgePrecision(edges, p.groups, p.deps) * edges.length), edgeKeys: new Set(edges.map(([i, j]) => `${p.reqs[i].reqId}~${p.reqs[j].reqId}`)) };
  };
  const views = [{ key: 'trainVal', label: 'train + val signals', include: () => true }, { key: 'valOnly', label: 'val signals only', include: (s) => s.split === 'val' }];
  const signalEval = { views: {} };
  for (const v of views) signalEval.views[v.key] = { label: v.label, perProject: [] };
  for (const p of data) {
    const analysis = await analyseSignals(p.reqs, p.signals);
    const text = metricsOf(p, p.sim);
    for (const v of views) {
      const rep = await replay({ reqs: p.reqs, signals: p.signals, analysis, include: v.include });
      const sig = metricsOf(p, signalMatrix(p.reqs, p.vectors, rep));
      const changed = [...sig.edgeKeys].filter((k) => !text.edgeKeys.has(k)).length;
      signalEval.views[v.key].perProject.push({
        projectId: p.projectId, signals: p.signals.filter(v.include).length, considered: rep.considered, applied: rep.applied, idmentionRows: rep.idmention, corefRows: rep.coref,
        requirementsWithProfile: rep.profiles.size, linksAdded: changed, linksRemoved: [...text.edgeKeys].filter((k) => !sig.edgeKeys.has(k)).length,
        text: { counted: text.counted, hit1: text.hit1, hit3: text.hit3, edges: text.edges, goodEdges: text.goodEdges },
        signal: { counted: sig.counted, hit1: sig.hit1, hit3: sig.hit3, edges: sig.edges, goodEdges: sig.goodEdges },
      });
    }
  }
  const totals = (list) => {
    const t = (f) => list.reduce((s, r) => s + f(r), 0);
    return {
      signals: t((r) => r.signals), applied: t((r) => r.applied), idmentionRows: t((r) => r.idmentionRows), corefRows: t((r) => r.corefRows),
      linksAdded: t((r) => r.linksAdded), linksRemoved: t((r) => r.linksRemoved),
      text: { counted: t((r) => r.text.counted), hit1: t((r) => r.text.hit1), hit3: t((r) => r.text.hit3), edges: t((r) => r.text.edges), goodEdges: t((r) => r.text.goodEdges) },
      signal: { counted: t((r) => r.signal.counted), hit1: t((r) => r.signal.hit1), hit3: t((r) => r.signal.hit3), edges: t((r) => r.signal.edges), goodEdges: t((r) => r.signal.goodEdges) },
    };
  };
  for (const v of views) signalEval.views[v.key].overall = totals(signalEval.views[v.key].perProject);
  // verdict in percentage points; differences under 3 points are inside the noise of ~114 requirements
  const verdictOf = (o) => {
    const d = [100 * (o.signal.hit1 - o.text.hit1) / o.text.counted, 100 * (o.signal.hit3 - o.text.hit3) / o.text.counted, 100 * (o.signal.goodEdges / o.signal.edges - o.text.goodEdges / o.text.edges)];
    const big = d.some((x) => Math.abs(x) >= 3);
    if (!big) return { deltas: d, verdict: 'no clear difference (every change is under 3 points, which is inside the noise)' };
    if (d.every((x) => x >= -1)) return { deltas: d, verdict: 'signals help' };
    if (d.every((x) => x <= 1)) return { deltas: d, verdict: 'signals hurt' };
    return { deltas: d, verdict: 'mixed (some measures up, some down)' };
  };
  // how many projects improved on all three measures / got worse on at least one (consistency matters more than one overall number)
  const perProjectDirection = (list) => {
    const d = list.map((r) => [r.signal.hit1 - r.text.hit1, r.signal.hit3 - r.text.hit3, r.signal.goodEdges / r.signal.edges - r.text.goodEdges / r.text.edges]);
    return { improved: d.filter((x) => x.every((y) => y >= -1e-9) && x.some((y) => y > 1e-9)).length, worse: d.filter((x) => x.some((y) => y < -1e-9)).length, projects: list.length };
  };
  for (const v of views) Object.assign(signalEval.views[v.key], { verdict: verdictOf(signalEval.views[v.key].overall), direction: perProjectDirection(signalEval.views[v.key].perProject) });

  const result = { generatedAt: new Date().toISOString(), database: config.mongoDbName, embeddingModel: 'sentence-transformers/all-MiniLM-L6-v2',
    clustering: { usedByApp: 'k-based', rule: 'k = clamp(round(sqrt(n)), 3, 8)' }, kBased: kRows, cutoffConstantKeptForComparison: DEFAULT_CUTOFF, cutoffInSample: { cutoff: inSample.cutoff, meanAri: inSample.ari, sweep: inSample.sweep }, lopo, inSampleRows, perProject: rows, overall, signalInformed: signalEval };

  // ---- report
  const L = ['# Requirements network evaluation', '',
    `Generated by \`npm run network:evaluate\` on database \`${config.mongoDbName}\` with the MiniLM embeddings from the ai-service. The key is \`network_ground_truth\` (scenario_related_pairs.csv: \`same_group\` and \`dependency\` pairs) plus each requirement's \`group_id\`.`, '',
    `**Small data warning:** there are only ${data.length} projects with ${Math.min(...data.map((p) => p.n))} to ${Math.max(...data.map((p) => p.n))} requirements each (${overall.nodes} in total, ${new Set(data.flatMap((p) => p.groups.map((g) => p.projectId + g))).size} ground-truth groups of 2 to 6 members). Differences of a few points are noise, and per-project numbers rest on very few items.`, '',
    '**What was tuned on the ground truth:** nothing in the app. The number of clusters is k = clamp(round(sqrt(n)), 3, 8) per project (5, 5, 6, 6 here), **chosen for usability in the UI and not tuned on `group_id`** (or on any other data), so its scores below are not inflated by tuning. The old distance-cutoff clustering is kept only for comparison: its single number (the cutoff) was chosen as the value in 0.30..0.90 (step 0.02) with the highest mean adjusted Rand index (ARI) against `group_id`, and it is no longer used by the app. The embedding model, the Pathfinder rule and the baselines use no ground truth.', '',
    '## 1. Network size and edge reduction (Pathfinder, r = infinity, q = n - 1)', '',
    '| Project | Nodes | Pathfinder edges | All possible pairs | Edge reduction |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.projectId} | ${r.nodes} | ${r.pathfinderEdges} | ${r.allPairs} | ${r.edgeReductionPct.toFixed(1)}% |`),
    `| **Overall** | ${overall.nodes} | ${overall.pathfinderEdges} | ${overall.allPairs} | ${(100 * (1 - overall.pathfinderEdges / overall.allPairs)).toFixed(1)}% |`, '',
    '## 2. Nearest-neighbour hit rate', '',
    'For each requirement whose group has at least one other member: is its most similar other requirement (hit@1), or one of its 3 most similar (hit@3), in the same `group_id`? Random is the exact expected value for picking neighbours uniformly at random.', '',
    '| Project | n | MiniLM hit@1 | TF-IDF hit@1 | Random hit@1 | MiniLM hit@3 | TF-IDF hit@3 | Random hit@3 |', '|---|---|---|---|---|---|---|---|',
    ...[...rows.map((r) => [r.projectId, r.nn]), ['**Overall**', overall.nn]].map(([name, nn]) =>
      `| ${name} | ${nn.counted} | ${pct(nn.minilm.hit1 / nn.counted)} | ${pct(nn.tfidf.hit1 / nn.counted)} | ${pct(nn.random.hit1 / nn.counted)} | ${pct(nn.minilm.hit3 / nn.counted)} | ${pct(nn.tfidf.hit3 / nn.counted)} | ${pct(nn.random.hit3 / nn.counted)} |`), '',
    '## 3. Edge precision', '',
    'Share of edges whose two requirements are in the same `group_id` or form a listed `dependency` pair. "Top-similarity" is the plain similarity graph cut at the SAME number of edges as Pathfinder (the most similar pairs). "All pairs" is the base rate if edges were drawn at random.', '',
    '| Project | Pathfinder | Top-similarity (same edge count) | All pairs (base rate) |', '|---|---|---|---|',
    ...rows.map((r) => `| ${r.projectId} | ${pct(r.edgePrecision.pathfinder)} (${r.edgePrecision.goodPathfinderEdges}/${r.pathfinderEdges}) | ${pct(r.edgePrecision.topSimilarity)} (${r.edgePrecision.goodTopEdges}/${r.pathfinderEdges}) | ${pct(r.edgePrecision.allPairs)} |`),
    `| **Overall** | ${pct(overall.goodPathfinderEdges / overall.pathfinderEdges)} (${overall.goodPathfinderEdges}/${overall.pathfinderEdges}) | ${pct(overall.goodTopEdges / overall.pathfinderEdges)} (${overall.goodTopEdges}/${overall.pathfinderEdges}) | - |`, '',
    '## 4. Group connectivity', '',
    '"Inside the group" = the share of ground-truth groups (2 or more members) whose members are connected using only edges between members of that group. "Anywhere in the graph" is trivially 100% for Pathfinder, because Pathfinder on a complete graph always returns a connected graph; it is shown only for reference.', '',
    '| Project | Groups | Connected inside the group | Connected anywhere in the graph (trivial) |', '|---|---|---|---|',
    ...rows.map((r) => `| ${r.projectId} | ${r.connectivity.groups} | ${pct(r.connectivity.inside)} | ${pct(r.connectivity.wholeGraph)} |`),
    `| **Overall** | ${overall.groups} | ${pct(overall.insideConnected / overall.groups)} (${overall.insideConnected}/${overall.groups}) | ${pct(overall.wholeConnected / overall.groups)} |`, '',
    '## 5. Clustering quality (computed clusters vs `group_id`)', '',
    'Adjusted Rand index (ARI) and normalized mutual information (NMI, arithmetic-mean normalization). 1 = identical partitions; ARI near 0 = no better than chance. Cluster counts differ from the number of ground-truth groups on purpose: k was chosen for readability, not to match the key.', '',
    '### 5a. What the app uses: the dendrogram cut to k clusters', '',
    '| Project | Nodes | k | Clusters | Average cluster size | Ground-truth groups | ARI | NMI |', '|---|---|---|---|---|---|---|---|',
    ...kRows.map((r) => `| ${r.projectId} | ${r.nodes} | ${r.k} | ${r.clusters} | ${r.avgSize.toFixed(1)} | ${r.groundTruthGroups} | ${f3(r.ari)} | ${f3(r.nmi)} |`),
    `| **Overall** | ${overall.nodes} | | ${overall.clusterSummary.kBased.clusters} | ${overall.clusterSummary.kBased.avgSize.toFixed(1)} | ${kRows.reduce((s, r) => s + r.groundTruthGroups, 0)} | mean ${f3(overall.kBased.ari)} | mean ${f3(overall.kBased.nmi)} |`, '',
    '### 5b. The old cutoff version, leave-one-project-out (no longer used by the app)', '',
    'For each project the cutoff is chosen on the OTHER three projects only and then scored on the held-out one.', '',
    '| Project | Cutoff chosen on the other 3 | Clusters | Average cluster size | ARI | NMI |', '|---|---|---|---|---|---|',
    ...lopo.map((r) => `| ${r.projectId} | ${r.cutoff} | ${r.clusters} | ${r.avgSize.toFixed(1)} | ${f3(r.ari)} | ${f3(r.nmi)} |`),
    `| **Overall** | | ${overall.clusterSummary.cutoffLopo.clusters} | ${overall.clusterSummary.cutoffLopo.avgSize.toFixed(1)} | mean ${f3(overall.lopo.ari)} | mean ${f3(overall.lopo.nmi)} |`, '',
    '### 5c. The old cutoff version, in-sample (optimistic: tuned on these same four projects)', '',
    `Cutoff ${inSample.cutoff} (highest mean ARI over all four projects, ${f3(inSample.ari)}).`, '',
    '| Project | Cutoff | Clusters | Average cluster size | Ground-truth groups | ARI | NMI |', '|---|---|---|---|---|---|---|',
    ...inSampleRows.map((r) => `| ${r.projectId} | ${r.cutoff} | ${r.clusters} | ${r.avgSize.toFixed(1)} | ${r.groundTruthGroups} | ${f3(r.ari)} | ${f3(r.nmi)} |`),
    `| **Overall** | | ${overall.clusterSummary.cutoffInSample.clusters} | ${overall.clusterSummary.cutoffInSample.avgSize.toFixed(1)} | | mean ${f3(overall.inSample.ari)} | mean ${f3(overall.inSample.nmi)} |`, '',
    '### 5d. Side by side (mean over the four projects)', '',
    '| Method | Clusters in total | Average cluster size | ARI | NMI |', '|---|---|---|---|---|',
    `| **k clusters (app)** | ${overall.clusterSummary.kBased.clusters} | ${overall.clusterSummary.kBased.avgSize.toFixed(1)} | ${f3(overall.kBased.ari)} | ${f3(overall.kBased.nmi)} |`,
    `| Cutoff, leave-one-project-out | ${overall.clusterSummary.cutoffLopo.clusters} | ${overall.clusterSummary.cutoffLopo.avgSize.toFixed(1)} | ${f3(overall.lopo.ari)} | ${f3(overall.lopo.nmi)} |`,
    `| Cutoff, in-sample (optimistic) | ${overall.clusterSummary.cutoffInSample.clusters} | ${overall.clusterSummary.cutoffInSample.avgSize.toFixed(1)} | ${f3(overall.inSample.ari)} | ${f3(overall.inSample.nmi)} |`, '',
    '### Cutoff sweep for the old cutoff version (mean ARI over the four projects)', '',
    '| Cutoff | ' + inSample.sweep.filter((_, i) => i % 2 === 0).map((s) => s.c.toFixed(2)).join(' | ') + ' |', '|---|' + inSample.sweep.filter((_, i) => i % 2 === 0).map(() => '---|').join(''),
    '| Mean ARI | ' + inSample.sweep.filter((_, i) => i % 2 === 0).map((s) => f2(s.ari)).join(' | ') + ' |', '',
    '## How to read these numbers', '',
    `- **Neighbours:** MiniLM finds a same-group requirement as the nearest neighbour ${pct(overall.nn.minilm.hit1 / overall.nn.counted)} of the time (TF-IDF ${pct(overall.nn.tfidf.hit1 / overall.nn.counted)}, random ${pct(overall.nn.random.hit1 / overall.nn.counted)}), and within the top 3 ${pct(overall.nn.minilm.hit3 / overall.nn.counted)} (TF-IDF ${pct(overall.nn.tfidf.hit3 / overall.nn.counted)}, random ${pct(overall.nn.random.hit3 / overall.nn.counted)}). That is well above random and above TF-IDF overall, but the per-project gaps to TF-IDF are inconsistent (TF-IDF is ahead at hit@1 in some projects), so with 114 requirements this is weak evidence of a real advantage.`,
    `- **Edges:** Pathfinder removes ${(100 * (1 - overall.pathfinderEdges / overall.allPairs)).toFixed(1)}% of the possible pairs. Its edge precision (${pct(overall.goodPathfinderEdges / overall.pathfinderEdges)}) is only ${((overall.goodPathfinderEdges - overall.goodTopEdges) / overall.pathfinderEdges * 100).toFixed(1)} points from the plain similarity graph with the same number of edges (${pct(overall.goodTopEdges / overall.pathfinderEdges)}); that difference is inside the noise. Its benefit here is the large reduction in edges, not higher precision.`,
    `- **Groups vs text:** Pathfinder on a complete graph yields about n - 1 edges, i.e. a spanning structure, so it cannot connect every group internally. Only ${pct(overall.insideConnected / overall.groups)} of the ground-truth groups are connected inside the group.`,
    `- **Clusters:** the app's k-based clustering gives ${overall.clusterSummary.kBased.clusters} clusters over ${overall.nodes} requirements (average size ${overall.clusterSummary.kBased.avgSize.toFixed(1)}) with mean ARI ${f3(overall.kBased.ari)} and NMI ${f3(overall.kBased.nmi)}. The old cutoff version gave ${overall.clusterSummary.cutoffInSample.clusters} clusters (average size ${overall.clusterSummary.cutoffInSample.avgSize.toFixed(1)}) with in-sample ARI ${f3(overall.inSample.ari)} and leave-one-project-out ARI ${f3(overall.lopo.ari)}. Compare ARI/NMI only as agreement with the key: fewer, bigger clusters can raise or lower them for reasons unrelated to usefulness, and the differences are small relative to the noise of 4 projects.`,
    '- **Why the key may be a poor yardstick:** `group_id` is the scenario author\'s business grouping, not a similarity-by-wording grouping. In SYS-RET, for example, the group "Customer Accounts" contains Social account sign-in, Returns and refunds, and Wishlist. A text-based network cannot be expected to reproduce such groups, so these scores measure agreement with the key, not the usefulness of the network.', ''];
  // ---- section 6
  const sigTable = (key) => {
    const v = signalEval.views[key];
    const cell = (a, b, n) => `${pct(a / n)} -> ${pct(b / n)}`;
    const line = (name, r) => `| ${name} | ${r.signals} | ${r.applied} | ${r.idmentionRows} / ${r.corefRows} | ${cell(r.text.hit1, r.signal.hit1, r.text.counted)} | ${cell(r.text.hit3, r.signal.hit3, r.text.counted)} | ${pct(r.text.goodEdges / r.text.edges)} -> ${pct(r.signal.goodEdges / r.signal.edges)} | +${r.linksAdded} / -${r.linksRemoved} |`;
    return ['| Project | Signals replayed | Applied (would be auto-accepted) | Evidence rows (id mention / co-reference) | hit@1 text -> signal | hit@3 text -> signal | Edge precision text -> signal | Links vs text-only |', '|---|---|---|---|---|---|---|---|',
      ...v.perProject.map((r) => line(r.projectId, r)), line('**Overall**', v.overall)];
  };
  const pp = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  const tv = signalEval.views.trainVal;
  const vo = signalEval.views.valOnly;
  L.push('## 6. Signal-informed network (replay of scenario signals)', '',
    'Question: does feeding the communication signals into the network (evidence rows, signal profiles, combined similarity) move the network closer to the key than the requirement texts alone? The scenario **train** and **val** signals of every project are replayed offline and in memory (nothing is written to the database): each is classified and matched with the ai-service and decided with the app\'s own review policy and status engine, so only signals the app would auto-apply count. For those, the same evidence extraction (id mentions, co-reference), signal profile (moving average) and combined similarity as in the app are used. "Text only" is the network of section 1-3. Test-split signals are not used.', '',
    '**Constants.** All constants (`backend/src/modules/network/constants.js`: profile 0.85/0.15 and weight up to 0.35, id-mention boost 0.15 per row capped at 0.30, co-reference boost 0.06 per row capped at 0.20, total boost capped at 0.35, co-reference threshold 0.40 and gap 0.10) are **a-priori choices by evidence strength (an explicit id mention is stronger evidence than an inferred co-reference). They were not tuned on `group_id` or on this evaluation, and must not be changed after reading it.**', '',
    '**Caveats.** (1) The classifier was trained on the scenario train split, so its confidence on train signals is optimistic and more of them pass the 90% auto-accept threshold than fresh messages would; the val-only view is the less biased one (val was used to choose the model, not to train it). (2) The scenario messages never contain requirement ids, so the id-mention path is exercised only by the app tests and the demo, not here; only profiles and co-reference can act in this replay. (3) The pipeline\'s match is sometimes wrong, and a wrong match puts the message into the wrong profile; that is part of what is measured.', '',
    `### 6a. ${tv.label}`, '', ...sigTable('trainVal'), '',
    `### 6b. ${vo.label}`, '', ...sigTable('valOnly'), '',
    '### Verdict', '',
    `- **${tv.label}:** ${tv.verdict.verdict}. Overall change (points): hit@1 ${pp(tv.verdict.deltas[0])}, hit@3 ${pp(tv.verdict.deltas[1])}, edge precision ${pp(tv.verdict.deltas[2])}; ${tv.overall.linksAdded} links added and ${tv.overall.linksRemoved} removed against the text-only network (${tv.overall.text.edges} links). Not consistent across projects: ${tv.direction.improved} of ${tv.direction.projects} improved on all three measures and ${tv.direction.worse} got worse on at least one.`,
    `- **${vo.label} (the less biased view):** ${vo.verdict.verdict}. Overall change (points): hit@1 ${pp(vo.verdict.deltas[0])}, hit@3 ${pp(vo.verdict.deltas[1])}, edge precision ${pp(vo.verdict.deltas[2])}; ${vo.overall.linksAdded} links added and ${vo.overall.linksRemoved} removed. ${vo.direction.improved} of ${vo.direction.projects} projects improved on all three measures and ${vo.direction.worse} got worse on at least one.`,
    `- **Bottom line:** ${vo.verdict.verdict.startsWith('no clear difference') ? 'on the less biased val-only replay the signals make no clear difference to agreement with the key' + (tv.verdict.verdict === 'signals help' ? '; the small gain in the train + val view is not consistent across projects and is probably helped by the optimistic classifier confidence on train signals, so it should not be read as proof that signals improve the network' : '') : vo.verdict.verdict}. This replay can only use profiles and co-reference (the scenario messages contain no requirement ids), which are the weak parts of the design; the id-mention path is demonstrated in docs/demo_signal_network.md instead.`,
    '- With 4 projects and 114 requirements a change under about 3 points cannot be told from noise, and the key (`group_id`) is the author\'s business grouping rather than a wording-based one (see above), so even a real improvement in how well the network follows the conversations might not show up against it. This section measures agreement with the key only.', '');
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(path.join(DOCS_DIR, 'network_evaluation.md'), L.join('\n'), 'utf8');
  fs.writeFileSync(path.join(DOCS_DIR, 'network_evaluation.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(L.join('\n'));
})()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
