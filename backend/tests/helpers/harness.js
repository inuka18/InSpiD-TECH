'use strict';
// Integration-test harness: real Express app + real (local, *_test) MongoDB, stubbed ai client.
// Creates its own temporary project/users and deletes everything it made on close().
const crypto = require('crypto');
const http = require('http');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const config = require('../../src/config/env');
const AppError = require('../../src/shared/AppError');

// Second guard (the first is tests/guard.js): never touch a database that is not clearly a test one.
function assertTestDb() {
  const name = config.mongoDbName;
  if (name === 'inspid' || !/_test$/.test(name) || /mongodb\.net|mongodb\+srv:/i.test(config.mongoUri)) {
    throw new Error(`Refusing to run integration tests against database "${name}". Use MONGODB_DB_NAME=inspid_test on the local Mongo.`);
  }
}

async function start() {
  assertTestDb();
  const { connectDb } = require('../../src/config/db');
  await connectDb();
  const app = require('../../src/app');
  const { Project } = require('../../src/modules/projects/model');
  const { Requirement } = require('../../src/modules/requirements/model');
  const { User } = require('../../src/modules/auth/model');
  await Promise.all([Project, Requirement, User, require('../../src/modules/ledger/model').LedgerEntry].map((m) => m.init()));

  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  const projectId = `SYS-T${suffix}`;
  await Project.create({ projectId, name: `Test ${suffix}`, domain: 'test', description: 'temporary test project' });

  const hash = await bcrypt.hash('unused', 4);
  const mkUser = async (role, jobTitle, projectIds) => {
    const u = await User.create({
      email: `${role.toLowerCase()}.${suffix.toLowerCase()}.${crypto.randomBytes(2).toString('hex')}@test.invalid`, passwordHash: hash,
      name: `${jobTitle} (test)`, role, jobTitle, projectId: projectIds[0], projectIds,
    });
    return { user: u, token: jwt.sign({ sub: String(u._id) }, config.jwtSecret, { expiresIn: '10m' }) };
  };
  const pm = await mkUser('PM', 'Project Manager', [projectId]);
  const member = await mkUser('TeamMember', 'QA Engineer', [projectId]);
  const outsider = await mkUser('TeamMember', 'Outsider', ['SYS-OTHER-' + suffix]);

  let reqN = 0;
  const addRequirement = async (liveStatus = 'Confirmed', extra = {}) => {
    reqN += 1;
    return Requirement.create({
      projectId, reqId: `T${suffix}-R${String(reqN).padStart(2, '0')}`, title: `Test requirement ${reqN}`, description: 'Something testable',
      type: 'FR', groupId: 'g', granularity: 'Weekly Workload', initialStatus: liveStatus, finalStatus: liveStatus, liveStatus, resourceRole: 'Unassigned', ...extra,
    });
  };

  // ---- stubbed ai client (the service calls aiClient.classify / aiClient.match at call time)
  const aiClient = require('../../src/shared/aiClient');
  const original = { classify: aiClient.classify, match: aiClient.match, embed: aiClient.embed, classifyBatch: aiClient.classifyBatch, matchBatch: aiClient.matchBatch };
  // embedFn(text) -> vector. Tests set it to control the requirement network; embedDown simulates an ai-service outage.
  const ai = { calls: { classify: 0, match: 0, embed: 0, embedTexts: 0, classifyBatch: 0, matchBatch: 0 }, classifyFor: null, matchFor: null, embedDown: false, embedFn: null, down: false, matchDown: false, label: 'Expectation', confidence: 0.95, similarity: 0.7, matchTo: null };
  aiClient.classify = async () => {
    ai.calls.classify += 1;
    if (ai.down) throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', 'AI service unreachable (/classify)');
    return { label: ai.label, confidence: ai.confidence, scores: {}, model_version: 'test-v1' };
  };
  aiClient.match = async (text, candidates) => {
    ai.calls.match += 1;
    if (ai.matchDown) throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', 'AI service unreachable (/match)');
    const first = ai.matchTo || candidates[0].id;
    return [{ id: first, similarity: ai.similarity }, ...candidates.filter((c) => c.id !== first).map((c, i) => ({ id: c.id, similarity: 0.2 - i * 0.01 }))].slice(0, 3);
  };

  // batch versions used by documents (extract / bulk). classifyFor(text) -> { label, confidence } lets a test decide per text.
  aiClient.classifyBatch = async (texts) => {
    ai.calls.classifyBatch += 1;
    if (ai.down) throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', 'AI service unreachable (/classify/batch)');
    return texts.map((t) => {
      const r = ai.classifyFor ? ai.classifyFor(t) : { label: ai.label, confidence: ai.confidence };
      return { label: r.label, confidence: r.confidence, scores: {}, model_version: 'test-v1' };
    });
  };
  aiClient.matchBatch = async (texts, candidates) => {
    ai.calls.matchBatch += 1;
    if (ai.matchDown) throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', 'AI service unreachable (/match/batch)');
    return texts.map((t) => {
      const first = (ai.matchFor && ai.matchFor(t, candidates)) || ai.matchTo || candidates[0].id;
      return [{ id: first, similarity: ai.similarity }, ...candidates.filter((c) => c.id !== first).map((c, i) => ({ id: c.id, similarity: 0.2 - i * 0.01 }))].slice(0, 3);
    });
  };

  aiClient.embed = async (texts) => {
    ai.calls.embed += 1;
    ai.calls.embedTexts += texts.length;
    if (ai.embedDown) throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', 'AI service unreachable (/embed)');
    return { vectors: texts.map((t) => (ai.embedFn ? ai.embedFn(t) : [1, 0, 0, 0])), model: 'stub' };
  };

  async function api(method, path, { token = pm.token, body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, json, data: json?.data, text };
  }

  // multipart upload: fields are strings, file = { name, buffer, type }
  async function form(method, path, { token = pm.token, fields = {}, file } = {}) {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    if (file) fd.append('file', new Blob([file.buffer], { type: file.type || 'application/octet-stream' }), file.name);
    const res = await fetch(`${base}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: fd });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, data: json?.data };
  }

  async function close() {
    aiClient.classifyBatch = original.classifyBatch;
    aiClient.matchBatch = original.matchBatch;
    aiClient.classify = original.classify;
    aiClient.match = original.match;
    aiClient.embed = original.embed;
    const models = ['Signal', 'Feedback', 'Requirement', 'StatusHistory', 'LedgerEntry', 'RequirementLink', 'ManualLink', 'NetworkGroundTruth'].map((n) => mongoose.model(n));
    await Promise.all(models.map((m) => m.deleteMany({ projectId })));
    await Promise.all([User.deleteMany({ _id: { $in: [pm.user._id, member.user._id, outsider.user._id] } }), Project.deleteOne({ projectId })]);
    await new Promise((r) => server.close(r));
    await mongoose.disconnect();
  }

  return { api, form, ai, projectId, pm, member, outsider, addRequirement, close, models: (n) => mongoose.model(n) };
}

module.exports = { start, assertTestDb };
