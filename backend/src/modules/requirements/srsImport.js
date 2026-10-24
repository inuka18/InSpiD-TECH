'use strict';
// Import a project's initial requirements from an SRS document.
//   preview: reads the document (template tables, or rule-based detection) and returns candidates. Saves nothing.
//   confirm: creates the chosen requirements through the normal create path (skipNetwork), then runs ONE network recompute,
//            which also creates the Initial baseline when the project has none.
// The document content is processed in memory and never logged or stored (only the requirements the PM confirms are saved).
const crypto = require('crypto');
const path = require('path');
const mongoose = require('mongoose');
const AppError = require('../../shared/AppError');
const aiClient = require('../../shared/aiClient');
const { extractTextFromFile } = require('../signals/documentText');
const network = require('../network/service');
const { Baseline } = require('../network/model');
const { Requirement } = require('./model');
const requirements = require('./service');
const parser = require('./srsParser');

const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

// One import claim per (project, document, items): a second identical confirm (double click) replays the first result.
const srsImportSchema = new mongoose.Schema(
  { projectId: { type: String, required: true }, key: { type: String, required: true }, status: { type: String, enum: ['running', 'done'], default: 'running' }, result: { type: mongoose.Schema.Types.Mixed }, createdAt: { type: Date, default: Date.now } },
  { collection: 'srs_imports' }
);
srsImportSchema.index({ projectId: 1, key: 1 }, { unique: true });
const SrsImport = mongoose.models.SrsImport || mongoose.model('SrsImport', srsImportSchema);

// One import at a time per project (in this process), so two imports never race for the same requirement ids.
const chains = new Map();
function withProjectLock(projectId, fn) {
  const run = (chains.get(projectId) || Promise.resolve()).catch(() => {}).then(fn);
  chains.set(projectId, run);
  run.then(() => {}, () => {}).then(() => { if (chains.get(projectId) === run) chains.delete(projectId); });
  return run;
}

async function docxHtml(buffer) {
  if (buffer.subarray(0, 2).toString('latin1') !== 'PK') throw new AppError(400, 'BAD_DOCX', 'This file is not a valid .docx document');
  try {
    // eslint-disable-next-line global-require
    return (await require('mammoth').convertToHtml({ buffer })).value;
  } catch {
    throw new AppError(422, 'DOCX_UNREADABLE', 'Could not read this .docx file');
  }
}

async function preview(projectId, file) {
  if (!file?.buffer) throw new AppError(400, 'NO_INPUT', 'Send the SRS file in the multipart field "file"');
  const ext = path.extname(file.originalname || '').toLowerCase();
  const existing = await Requirement.find({ projectId }).select('reqId title description sourceDocument').lean();
  const documentId = sha256(file.buffer);
  let method = 'heuristic';
  let parsed = null;
  if (ext === '.docx') {
    const t = parser.parseTemplateHtml(await docxHtml(file.buffer));
    if (t.found) { method = 'template'; parsed = t; }
  }
  if (!parsed) parsed = parser.parseHeuristic(await extractTextFromFile(file)); // 415 for other file types, 422 when empty
  const out = parser.buildPreview({ documentName: file.originalname || 'SRS', documentId, method, parsed, existing });
  if (!out.candidates.length) out.warnings.push(method === 'template' ? 'The template tables contain no filled-in requirement rows.' : 'No requirement-like sentences or numbered items were found.');
  return out;
}

// ------------------------------------------------------------------ confirm
async function embedPreflight(items) {
  const texts = items.map((i) => `${i.title}. ${i.description || ''}`.trim());
  for (let from = 0; from < texts.length; from += 256) {
    const res = await aiClient.embed(texts.slice(from, from + 256)); // throws 502 when the ai-service is down
    if (!Array.isArray(res?.vectors)) throw new AppError(502, 'AI_SERVICE_ERROR', 'AI service returned an unexpected /embed answer');
  }
}

async function runImport(projectId, body, user) {
  const { documentName, items, force } = body;
  const existing = await Requirement.find({ projectId }).select('reqId title description sourceDocument').lean();
  const dups = parser.findDuplicates(items, existing);
  const seen = new Set();
  const toCreate = [];
  const skipped = [];
  items.forEach((it, i) => {
    const key = parser.normalise(it.description || it.title);
    if (!force && dups.has(i)) { skipped.push({ sourceId: it.sourceId || null, title: it.title, reason: `duplicate of ${dups.get(i).requirementId}` }); return; }
    if (seen.has(key)) { skipped.push({ sourceId: it.sourceId || null, title: it.title, reason: 'repeated in this import' }); return; }
    seen.add(key);
    toCreate.push(it);
  });

  const result = { documentName, requested: items.length, created: 0, skipped: skipped.length, failed: 0, ids: [], skippedItems: skipped, firstError: null, network: null, baselineCreated: false };
  if (!toCreate.length) return result;

  await embedPreflight(toCreate); // 502 before anything is saved
  const hadBaseline = Boolean(await Baseline.exists({ projectId, initial: true }));
  for (const it of toCreate) {
    try {
      const created = await requirements.create(projectId, {
        title: it.title, description: it.description || '', type: it.type, granularity: 'Sprint Commitment',
        ...(parser.mapPriority(it.priority) ? { priority: parser.mapPriority(it.priority) } : {}),
        cluster: it.featureArea || '', // stored ONLY as groupId (answer key); never used to form clusters
        sourceDocument: { name: documentName, sourceId: it.sourceId || '' },
      }, user, { skipNetwork: true });
      result.ids.push(created.id);
      result.created += 1;
    } catch (err) {
      result.failed += 1;
      if (!result.firstError) result.firstError = err instanceof AppError ? err.message : 'Could not create a requirement';
    }
  }
  if (result.created) {
    try {
      const net = await network.computeNetwork(projectId, { actor: user.email }); // ONE recompute: embeddings, Pathfinder, clusters, one NETWORK_UPDATE
      result.network = { updated: true, requirements: net.requirements, links: net.links, clusters: net.clusters };
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      result.network = { updated: false, message: `The requirements were saved, but the network could not be built (${err.message}). It is built the next time the Network Map is opened.` };
    }
    result.baselineCreated = !hadBaseline && Boolean(await Baseline.exists({ projectId, initial: true }));
  }
  return result;
}

async function confirm(projectId, body, user) {
  const key = `${body.documentId}:${sha256(JSON.stringify({ items: body.items, force: Boolean(body.force) }))}`;
  return withProjectLock(projectId, async () => {
    // A claim only protects against a double click / retry: after REPLAY_WINDOW_MS the same import is treated as a new one.
    await SrsImport.deleteMany({ projectId, key, createdAt: { $lt: new Date(Date.now() - REPLAY_WINDOW_MS) } });
    try {
      await SrsImport.create({ projectId, key, status: 'running' });
    } catch (err) {
      if (err.code !== 11000) throw err;
      const prior = await SrsImport.findOne({ projectId, key }).lean();
      if (prior?.status === 'done') return { ...prior.result, alreadyImported: true }; // double click: same answer, nothing created
      throw new AppError(409, 'IMPORT_IN_PROGRESS', 'This import is already running');
    }
    try {
      const result = await runImport(projectId, body, user);
      await SrsImport.updateOne({ projectId, key }, { $set: { status: 'done', result } });
      return result;
    } catch (err) {
      await SrsImport.deleteOne({ projectId, key }); // nothing was saved (or the failure was before any save): the PM can retry
      throw err;
    }
  });
}

module.exports = { preview, confirm, SrsImport };
