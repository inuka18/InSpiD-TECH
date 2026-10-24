'use strict';
// node src/scripts/srsEvaluate.js   (inspid_test only; needs the ai-service)
// 1. Runs the two sample SRS files and the public CCTNS FRS through preview and confirm into temporary projects of inspid_test and
//    prints the numbers (created, ledger entries, baseline, links, clusters, timings).
// 2. Heuristic check: the two samples converted to plain paragraphs WITHOUT tables (introduction text + one statement per line), and the
//    CCTNS PDF, through the rule-based mode; recall / precision against the known requirements.
// Writes docs/srs_import_evaluation.md and .json (DOCS_DIR, default /docs). Read-only except for its own SYS-SRS* projects, which it
// deletes and recreates on every run.
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const mammoth = require('mammoth');
const config = require('../config/env');
const { connectDb } = require('../config/db');
const { Project } = require('../modules/projects/model');
const { Requirement, StatusHistory } = require('../modules/requirements/model');
const { LedgerEntry } = require('../modules/ledger/model');
const net = require('../modules/network/model');
const network = require('../modules/network/service');
const srs = require('../modules/requirements/srsImport');
const parser = require('../modules/requirements/srsParser');

const DOCS_DIR = process.env.DOCS_DIR || '/docs';
const SAMPLES = path.join(DOCS_DIR, 'samples', 'srs');
const USER = { email: 'srs-eval@inspid.test' };
const FILES = [
  { pid: 'SYS-SRS1', name: 'SRS_Online_Retail_Platform_Sample.docx', type: 'template' },
  { pid: 'SYS-SRS2', name: 'SRS_Hospital_Management_System_Sample.docx', type: 'template' },
  { pid: 'SYS-SRS3', name: '0000 - cctns.pdf', type: 'pdf' },
];
const CCTNS_EXPECTED = { 'Help Module': 2, 'Support Module': 5, 'Audit Module': 8, 'Access Module': 10, 'Ease of Use': 9, Usability: 47, 'System Availability': 5, 'Performance and Scalability': 5, 'System Functionality': 24 };
const pct = (x) => (x === null ? '-' : `${(100 * x).toFixed(1)}%`);
const ms = (t0) => Math.round(performance.now() - t0);

async function reset(pid) {
  const m = (n) => mongoose.model(n);
  await Promise.all(['Requirement', 'StatusHistory', 'LedgerEntry', 'RequirementLink', 'ManualLink', 'SignalEvidence', 'Baseline', 'NetworkState', 'SrsImport', 'Signal']
    .map((n) => m(n).deleteMany({ projectId: pid })));
  await Project.deleteMany({ projectId: pid });
  await Project.create({ projectId: pid, name: `SRS evaluation ${pid}`, domain: 'test', description: 'temporary: srsEvaluate.js' });
}

const asFile = (name) => ({ originalname: name, buffer: fs.readFileSync(path.join(SAMPLES, name)) });

async function runImport(f, { selectAll = false } = {}) {
  await reset(f.pid);
  const file = asFile(f.name);
  const t0 = performance.now();
  const pv = await srs.preview(f.pid, file);
  const previewMs = ms(t0);
  const chosen = pv.candidates.filter((c) => (selectAll ? !c.placeholders || true : c.selected));
  const toItems = (cs) => cs.map((c) => ({ sourceId: c.sourceId, title: c.title, description: c.description, type: c.type, featureArea: c.featureArea, priority: c.priority }));
  const t1 = performance.now();
  const res = await srs.confirm(f.pid, { documentId: pv.documentId, documentName: pv.documentName, items: toItems(chosen) }, USER);
  const confirmMs = ms(t1);
  const ledger = await LedgerEntry.aggregate([{ $match: { projectId: f.pid } }, { $group: { _id: '$eventType', n: { $sum: 1 } } }]);
  const t2 = performance.now();
  const view = await network.getNetwork(f.pid);
  const networkMs = ms(t2);
  const reqs = await Requirement.find({ projectId: f.pid }).sort({ reqId: 1 }).lean();
  const clusters = new Map();
  reqs.forEach((r) => { const k = `${r.clusterId} ${r.clusterLabel}`; (clusters.get(k) ?? clusters.set(k, []).get(k)).push(r); });
  return {
    file: f.name, method: pv.method, previewCandidates: pv.candidates.length, selectedByDefault: pv.candidates.filter((c) => c.selected).length,
    fr: pv.candidates.filter((c) => c.type === 'FR').length, nfr: pv.candidates.filter((c) => c.type === 'NFR').length,
    placeholders: pv.candidates.filter((c) => c.placeholders).length, warnings: pv.warnings, imported: chosen.length,
    created: res.created, failed: res.failed, skipped: res.skipped, firstError: res.firstError, ids: [res.ids[0], res.ids[res.ids.length - 1]],
    network: res.network, baselineCreated: res.baselineCreated, ledger: Object.fromEntries(ledger.map((l) => [l._id, l.n])),
    nodes: view.nodes?.length ?? reqs.length, links: (view.links ?? view.edges ?? []).length, timings: { previewMs, confirmMs, getNetworkMs: networkMs },
    clusters: [...clusters].map(([k, rs]) => ({ cluster: k, size: rs.length, sample: rs.slice(0, 4).map((r) => r.title) })),
  };
}

// ---- heuristic check on table-less text
async function plainTextOf(name) {
  const html = (await mammoth.convertToHtml({ path: path.join(SAMPLES, name) })).value;
  const known = parser.parseTemplateHtml(html).candidates;
  const intro = html.replace(/<table[\s\S]*?<\/table>/gi, '\n').replace(/<\/(p|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').split('\n').map((l) => l.trim()).filter(Boolean);
  // introduction text first, then one statement per line (no tables, no ids)
  return { text: `${intro.join('\n')}\n\n3.1 Functional requirements\n${known.filter((k) => k.type === 'FR').map((k) => k.description).join('\n')}\n\n3.2 Non-functional requirements\n${known.filter((k) => k.type === 'NFR').map((k) => k.description).join('\n')}\n`, known };
}

function checkSample(parsed, known) {
  const norm = (s) => parser.normalise(s);
  const knownKeys = known.map((k) => norm(k.description));
  const matchedKnown = new Set();
  const wrong = [];
  for (const c of parsed.candidates) {
    const key = norm(c.description);
    const i = knownKeys.findIndex((k, idx) => !matchedKnown.has(idx) && (key === k || key.includes(k) || k.includes(key)));
    if (i >= 0) matchedKnown.add(i); else wrong.push({ text: c.description.slice(0, 110), confidence: c.confidence });
  }
  const missed = known.filter((_, i) => !matchedKnown.has(i)).map((k) => ({ sourceId: k.sourceId, text: k.description.slice(0, 110) }));
  const typeOk = parsed.candidates.filter((c) => { const k = known.find((x) => norm(c.description).includes(norm(x.description))); return k && k.type === c.type; }).length;
  return {
    known: known.length, found: parsed.candidates.length, matched: matchedKnown.size, recall: matchedKnown.size / known.length,
    precision: parsed.candidates.length ? matchedKnown.size / parsed.candidates.length : null, wronglyKept: wrong, missed,
    medium: parsed.candidates.filter((c) => c.confidence === 'medium').length, low: parsed.candidates.filter((c) => c.confidence === 'low').length, typeCorrect: typeOk,
  };
}

function checkCctns(parsed) {
  const found = new Map();
  const extras = [];
  for (const c of parsed.candidates) {
    if (CCTNS_EXPECTED[c.featureArea]) (found.get(c.featureArea) ?? found.set(c.featureArea, []).get(c.featureArea)).push(c);
    else extras.push({ section: c.featureArea || '(none)', confidence: c.confidence, text: c.description.slice(0, 120) });
  }
  const rows = Object.entries(CCTNS_EXPECTED).map(([section, expected]) => {
    const cs = found.get(section) ?? [];
    const ns = new Set(cs.map((c) => Number(/#(\d+)$/.exec(c.sourceId)?.[1])));
    const missing = Array.from({ length: expected }, (_, i) => i + 1).filter((n) => !ns.has(n));
    const hit = cs.filter((c) => Number(/#(\d+)$/.exec(c.sourceId)?.[1]) <= expected).length;
    return { section, expected, found: cs.length, correct: hit, wronglyKept: cs.length - hit, missed: missing.length, missingNumbers: missing, medium: cs.filter((c) => c.confidence === 'medium').length, low: cs.filter((c) => c.confidence === 'low').length, placeholders: cs.filter((c) => c.placeholders).length };
  });
  const expectedTotal = Object.values(CCTNS_EXPECTED).reduce((a, b) => a + b, 0);
  const correct = rows.reduce((a, r) => a + r.correct, 0);
  const foundTotal = parsed.candidates.length;
  return { rows, expectedTotal, foundTotal, correct, recall: correct / expectedTotal, precision: correct / foundTotal, extras, typeCounts: { FR: parsed.candidates.filter((c) => c.type === 'FR').length, NFR: parsed.candidates.filter((c) => c.type === 'NFR').length } };
}

(async () => {
  if (!/_test$/.test(config.mongoDbName) || /mongodb\.net|mongodb\+srv:/i.test(config.mongoUri)) throw new Error(`Refusing to run against "${config.mongoDbName}": use the local inspid_test database.`);
  await connectDb();
  await Promise.all([net.Baseline, net.NetworkState, net.SignalEvidence, StatusHistory, srs.SrsImport].map((m) => m.init()));
  const report = { generatedAt: new Date().toISOString(), database: config.mongoDbName, imports: [], cctnsFullImport: null, heuristic: {} };

  // ---- 1. preview + confirm
  for (const f of FILES.slice(0, 2)) report.imports.push(await runImport(f));
  // CCTNS: default selection (medium confidence, no placeholders) and the full 115 (every item of the nine sections)
  const cctnsFile = asFile(FILES[2].name);
  const cctnsPreview = await srs.preview('SYS-SRS3', cctnsFile);
  report.cctnsDefaultSelection = { candidates: cctnsPreview.candidates.length, selected: cctnsPreview.candidates.filter((c) => c.selected).length, placeholders: cctnsPreview.candidates.filter((c) => c.placeholders).length, low: cctnsPreview.candidates.filter((c) => c.confidence === 'low').length };
  await reset('SYS-SRS3');
  const full = cctnsPreview.candidates.filter((c) => CCTNS_EXPECTED[c.featureArea]);
  const t1 = performance.now();
  const res = await srs.confirm('SYS-SRS3', { documentId: cctnsPreview.documentId, documentName: cctnsPreview.documentName, items: full.map((c) => ({ sourceId: c.sourceId, title: c.title, description: c.description, type: c.type, featureArea: c.featureArea, priority: c.priority })) }, USER);
  const confirmMs = ms(t1);
  const t2 = performance.now();
  const view = await network.getNetwork('SYS-SRS3');
  const getMs = ms(t2);
  const reqs = await Requirement.find({ projectId: 'SYS-SRS3' }).sort({ reqId: 1 }).lean();
  const groups = new Map();
  reqs.forEach((r) => { const k = `${r.clusterId} ${r.clusterLabel}`; (groups.get(k) ?? groups.set(k, []).get(k)).push(r); });
  report.cctnsFullImport = {
    imported: full.length, created: res.created, failed: res.failed, firstError: res.firstError, network: res.network, baselineCreated: res.baselineCreated,
    nodes: reqs.length, links: (view.links ?? view.edges ?? []).length, timings: { confirmMs, getNetworkMs: getMs },
    clusters: [...groups].map(([k, rs]) => ({ cluster: k, size: rs.length, featureAreas: Object.fromEntries([...new Set(rs.map((r) => r.groupId))].map((a) => [a, rs.filter((r) => r.groupId === a).length])), sample: rs.slice(0, 3).map((r) => r.title) })),
  };

  // ---- 2. heuristic check
  for (const name of FILES.slice(0, 2).map((f) => f.name)) {
    const { text, known } = await plainTextOf(name);
    report.heuristic[name] = checkSample(parser.parseHeuristic(text), known);
  }
  report.heuristic.cctns = checkCctns(cctnsPreview);

  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--write')) fs.writeFileSync(path.join(DOCS_DIR, 'srs_import_evaluation.json'), JSON.stringify(report, null, 2));
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
