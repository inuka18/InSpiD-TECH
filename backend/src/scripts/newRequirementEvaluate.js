'use strict';
// npm run newreq:evaluate -- --splits=dev          (dev rows only: prints, writes nothing; use this while tuning)
// npm run newreq:evaluate -- --splits=dev,test     (FINAL run: also writes docs/new_requirement_detection.md and .json)
//
// Runs the new-requirement detector on data/scenario/new_requirement_test.csv through the REAL classifier and matcher
// (ai-service) against the seeded requirements and signals of the database (inspid_test only), and replays the scenario
// Expectation signals (train, val, test) to measure false alarms. Read-only. The test rows must be run exactly once:
// the final run refuses to overwrite an existing report that already contains test results unless --force is given.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const mongoose = require('mongoose');
const config = require('../config/env');
const { connectDb } = require('../config/db');
const aiClient = require('../shared/aiClient');
const { Project } = require('../modules/projects/model');
const { Requirement } = require('../modules/requirements/model');
const { Signal } = require('../modules/signals/model');
const { toConfidencePct } = require('../modules/signals/reviewPolicy');
const { rankedToMatch, candidatesOf } = require('../modules/signals/service');
const { analyseSignals } = require('./signalReplay');
const nr = require('../modules/signals/newRequirement');
const C = require('../modules/signals/newRequirementConstants');

const DOCS_DIR = process.env.DOCS_DIR || '/docs';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] ?? d;
const SPLITS = arg('splits', 'dev').split(',');
const FORCE = process.argv.includes('--force');
const pct = (x) => (x === null ? '-' : `${(100 * x).toFixed(1)}%`);
const f3 = (x) => (x === null || x === undefined ? '-' : x.toFixed(3));

function metrics(rows, key) {
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const r of rows) {
    const t = r.truth === 1; const p = r[key].isCandidate;
    if (t && p) c.tp += 1; else if (!t && p) c.fp += 1; else if (t && !p) c.fn += 1; else c.tn += 1;
  }
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : (precision === null || recall === null ? null : 0);
  return { n: rows.length, ...c, precision, recall, f1 };
}

(async () => {
  if (!/_test$/.test(config.mongoDbName) || /mongodb\.net|mongodb\+srv:/i.test(config.mongoUri)) {
    throw new Error(`Refusing to run against database "${config.mongoDbName}": use the local inspid_test database.`);
  }
  const jsonPath = path.join(DOCS_DIR, 'new_requirement_detection.json');
  if (SPLITS.includes('test') && fs.existsSync(jsonPath) && !FORCE) {
    const prev = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (prev.splits?.includes('test')) throw new Error('A report with test-row results already exists. The test rows are run once; pass --force only to re-run on purpose.');
  }
  await connectDb();
  const csv = parse(fs.readFileSync(path.join(config.scenarioDir, 'new_requirement_test.csv'), 'utf8'), { columns: true, skip_empty_lines: true })
    .filter((r) => SPLITS.includes(r.split));
  const projects = await Project.find({}).sort({ projectId: 1 }).lean();

  // ---------------------------------------------------------------- 1. the new-requirement test set
  const rows = [];
  for (const pd of projects) {
    const mine = csv.filter((r) => r.project_id === pd.projectId);
    if (!mine.length) continue;
    const reqs = await Requirement.find({ projectId: pd.projectId }).sort({ reqId: 1 }).lean();
    const sigs = await Signal.find({ projectId: pd.projectId }, { text: 1 }).lean();
    const stats = nr.buildTokenStats(reqs.map((r) => `${r.title}. ${r.description || ''}`), sigs.map((s) => s.text));
    const classified = await aiClient.classifyBatch(mine.map((r) => r.text));
    const lists = await aiClient.matchBatch(mine.map((r) => r.text), candidatesOf(reqs), 3);
    mine.forEach((r, i) => {
      const { match } = rankedToMatch(lists[i] ?? [], reqs);
      const conf = toConfidencePct(classified[i].confidence);
      const args = { label: classified[i].label, confidence: conf, text: r.text, matches: match.alternatives, tokenStats: stats };
      const full = nr.detectNewRequirement(args);
      const aOnly = nr.detectNewRequirement({ ...args, useNovelTokens: false });
      rows.push({
        id: r.nr_id, split: r.split, projectId: r.project_id, text: r.text, truth: Number(r.is_new_requirement), label: classified[i].label, confidence: conf,
        similarity: match.similarity, closestRequirementId: match.alternatives[0]?.requirementId ?? null, full, aOnly,
      });
    });
  }
  const bySplit = {};
  for (const s of SPLITS) {
    const rs = rows.filter((r) => r.split === s);
    bySplit[s] = { withNovelTokens: metrics(rs, 'full'), onlyRuleA: metrics(rs, 'aOnly') };
  }
  const wrong = (key) => rows.filter((r) => (r.truth === 1) !== r[key].isCandidate).map((r) => ({
    id: r.id, split: r.split, projectId: r.projectId, truth: r.truth, predicted: r[key].isCandidate ? 1 : 0, kind: r.truth ? 'missed (FN)' : 'false alarm (FP)',
    label: r.label, confidence: r.confidence, similarity: r.similarity, closestRequirementId: r.closestRequirementId, novelTokens: r[key].novelTokens, rule: r[key].rule, text: r.text,
  }));

  // ---------------------------------------------------------------- 2. specificity: scenario Expectation signals
  const spec = [];
  for (const pd of projects) {
    const reqs = await Requirement.find({ projectId: pd.projectId }).sort({ reqId: 1 }).lean();
    if (!reqs.length) continue;
    const all = await Signal.find({ projectId: pd.projectId, split: { $in: ['train', 'val', 'test'] }, seeded: true }).sort({ timestamp: 1, signalId: 1 }).lean();
    const analyses = await analyseSignals(reqs, all);
    const stats = nr.buildTokenStats(reqs.map((r) => `${r.title}. ${r.description || ''}`), []);
    all.forEach((s, i) => {
      const { ai, ranked } = analyses[i];
      if (s.label === 'Expectation') {
        const { match } = rankedToMatch(ranked ?? [], reqs);
        const args = { label: ai.label, confidence: toConfidencePct(ai.confidence), text: s.text, matches: match.alternatives, tokenStats: stats };
        spec.push({ projectId: pd.projectId, split: s.split, classifierExpectation: ai.label === 'Expectation', full: nr.detectNewRequirement(args).isCandidate, aOnly: nr.detectNewRequirement({ ...args, useNovelTokens: false }).isCandidate });
      }
      stats.add(s.text); // "earlier signals" = the signals before this one
    });
  }
  const share = (xs, k) => (xs.length ? xs.filter((x) => x[k]).length / xs.length : null);
  const specRow = (xs) => ({ expectations: xs.length, flaggedWithNovelTokens: xs.filter((x) => x.full).length, flaggedOnlyRuleA: xs.filter((x) => x.aOnly).length, shareWithNovelTokens: share(xs, 'full'), shareOnlyRuleA: share(xs, 'aOnly') });
  const specificity = { overall: specRow(spec), perProject: projects.map((p) => ({ projectId: p.projectId, ...specRow(spec.filter((x) => x.projectId === p.projectId)) })).filter((r) => r.expectations),
    perSplit: ['train', 'val', 'test'].map((s) => ({ split: s, ...specRow(spec.filter((x) => x.split === s)) })) };

  const report = {
    generatedAt: new Date().toISOString(), database: config.mongoDbName, splits: SPLITS,
    constants: { NEW_REQ_MIN_CONFIDENCE: C.NEW_REQ_MIN_CONFIDENCE, NEW_REQ_SIM_LOW: C.NEW_REQ_SIM_LOW, NEW_REQ_SIM_HIGH: C.NEW_REQ_SIM_HIGH, NEW_REQ_NOVEL_MAX_SIGNALS: C.NEW_REQ_NOVEL_MAX_SIGNALS },
    bySplit, wrongDecisions: { withNovelTokens: wrong('full'), onlyRuleA: wrong('aOnly') }, specificity,
  };

  // ---------------------------------------------------------------- output
  const mt = (m) => `| ${m.n} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.tn} | ${pct(m.precision)} | ${pct(m.recall)} | ${f3(m.f1)} |`;
  const lines = [];
  lines.push('# New-requirement detection: evaluation', '', `Generated ${report.generatedAt} on database \`${report.database}\`. Splits run: ${SPLITS.join(', ')}.`, '');
  lines.push('## 1. Detection on new_requirement_test.csv', '', 'Real classifier and matcher. A row is predicted "new requirement" when the detector flags it (Expectation, confidence >= 70, novel).', '',
    '| Split | Rule set | Rows | TP | FP | FN | TN | Precision | Recall | F1 |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const s of SPLITS) {
    lines.push(`| ${s} | with novel-token rule (a)+(b) ${mt(bySplit[s].withNovelTokens)}`);
    lines.push(`| ${s} | without it (only (a)) ${mt(bySplit[s].onlyRuleA)}`);
  }
  for (const [k, title] of [['withNovelTokens', 'Wrong decisions (with the novel-token rule)'], ['onlyRuleA', 'Wrong decisions (only rule (a))']]) {
    lines.push('', `### ${title}`, '', '| id | split | kind | label | conf | top sim | closest | novel tokens | text |', '|---|---|---|---|---|---|---|---|---|');
    for (const w of report.wrongDecisions[k]) lines.push(`| ${w.id} | ${w.split} | ${w.kind} | ${w.label} | ${w.confidence} | ${f3(w.similarity)} | ${w.closestRequirementId ?? '-'} | ${w.novelTokens.join(', ') || '-'} | ${w.text.replace(/\|/g, '/')} |`);
    if (!report.wrongDecisions[k].length) lines.push('| (none) | | | | | | | | |');
  }
  lines.push('', '## 2. Specificity: scenario Expectation signals', '', 'Every scenario Expectation signal belongs to an existing requirement, so every flag is a false alarm. Replayed oldest first with the real classifier and matcher; "earlier signals" are the scenario signals before it.', '',
    '| Scope | Expectations | Flagged (a)+(b) | Share | Flagged (a) only | Share |', '|---|---|---|---|---|---|');
  const sr = (name, r) => `| ${name} | ${r.expectations} | ${r.flaggedWithNovelTokens} | ${pct(r.shareWithNovelTokens)} | ${r.flaggedOnlyRuleA} | ${pct(r.shareOnlyRuleA)} |`;
  lines.push(sr('**all**', specificity.overall), ...specificity.perProject.map((r) => sr(r.projectId, r)), ...specificity.perSplit.map((r) => sr(`split ${r.split}`, r)));
  lines.push('', '## 3. Honest limits', '',
    '- The test set is small (60 rows: 28 dev, 32 test) and was written by us, so the numbers are indicative, not a guarantee on real project chatter.',
    '- The constants were fixed a priori and not tuned on the test rows. Nothing was tuned on dev either: dev precision 100% and recall 81% were not clearly poor, so every constant is still its a-priori default (tuning log in `backend/src/modules/signals/newRequirementConstants.js`: none).',
    `- Constants used: ${Object.entries(report.constants).map(([k, v]) => `${k}=${v}`).join(', ')}.`, '');
  const md = lines.join('\n');
  console.log(md);
  if (SPLITS.includes('test')) {
    fs.writeFileSync(path.join(DOCS_DIR, 'new_requirement_detection.md'), md);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`\nWrote ${DOCS_DIR}/new_requirement_detection.md and .json`);
  } else {
    console.log('\n(dev-only run: nothing written)');
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
