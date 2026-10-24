'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { start } = require('../helpers/harness');

const fx = (n) => fs.readFileSync(path.join(__dirname, '../fixtures', n));
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('SRS import: preview and confirm (stubbed ai client, *_test database)', () => {
  let h;
  before(async () => { h = await start(); });
  after(async () => { await h.close(); });
  beforeEach(() => Object.assign(h.ai, { embedDown: false, embedFn: (t) => [1, (t.length % 7) / 7, 0, 0] }));

  const fresh = async () => {
    const p = await h.newProject();
    const base = `/projects/${p.projectId}`;
    return {
      pid: p.projectId, base, addRequirement: p.addRequirement,
      preview: (file, opts) => h.form('POST', `${base}/requirements/import-srs/preview`, { file, ...opts }),
      confirm: (body, opts) => h.api('POST', `${base}/requirements/import-srs/confirm`, { body, ...opts }),
      ledger: async () => (await h.api('GET', `${base}/ledger`)).data,
      count: () => h.models('Requirement').countDocuments({ projectId: p.projectId }),
    };
  };
  const retail = () => ({ name: 'SRS_Online_Retail_Platform_Sample.docx', buffer: fx('SRS_Online_Retail_Platform_Sample.docx'), type: DOCX });
  const hospital = () => ({ name: 'SRS_Hospital_Management_System_Sample.docx', buffer: fx('SRS_Hospital_Management_System_Sample.docx'), type: DOCX });
  const itemsOf = (preview, only = true) => preview.candidates.filter((c) => !only || c.selected)
    .map((c) => ({ sourceId: c.sourceId, title: c.title, description: c.description, type: c.type, featureArea: c.featureArea, priority: c.priority }));

  it('preview (template): reads the tables exactly, saves nothing, PM only', async () => {
    const p = await fresh();
    const r = await p.preview(retail());
    assert.equal(r.status, 200);
    assert.equal(r.data.method, 'template');
    assert.equal(r.data.candidates.length, 31);
    assert.equal(r.data.candidates.filter((c) => c.type === 'FR').length, 24);
    assert.equal(r.data.candidates.filter((c) => c.type === 'NFR').length, 7);
    assert.equal(r.data.existingRequirements, 0);
    assert.deepEqual(r.data.duplicates, []);
    assert.equal(r.data.candidates[0].title, 'Product search with filters');
    assert.equal(r.data.candidates[0].priority, 'Must');
    assert.ok(r.data.candidates.every((c) => c.selected));
    assert.match(r.data.documentId, /^[a-f0-9]{64}$/);
    assert.equal(await p.count(), 0);
    assert.equal((await p.preview(retail(), { token: h.member.token })).status, 403);
    assert.equal((await h.form('POST', `${p.base}/requirements/import-srs/preview`, {})).status, 400);
  });

  it('preview (template): the empty template has nothing to import', async () => {
    const p = await fresh();
    const r = await p.preview({ name: 'SRS_Template.docx', buffer: fx('SRS_Template.docx'), type: DOCX });
    assert.equal(r.data.method, 'template');
    assert.equal(r.data.candidates.length, 0);
    assert.match(r.data.warnings.join(' '), /placeholder/);
  });

  it('preview (heuristic): a text file is rule-based, labelled so, and only medium confidence is selected', async () => {
    const p = await fresh();
    const text = 'Overview\nThe system shall let customers pay by card.\nUsers will be able to reset their password.\nThe shop is in Colombo.\n';
    const r = await p.preview({ name: 'notes.txt', buffer: Buffer.from(text), type: 'text/plain' });
    assert.equal(r.status, 200);
    assert.equal(r.data.method, 'heuristic');
    assert.match(r.data.methodNote, /not a trained model/);
    assert.deepEqual(r.data.candidates.map((c) => [c.confidence, c.selected]), [['medium', true], ['low', false]]);
    assert.equal((await p.preview({ name: 'x.exe', buffer: Buffer.from('MZ'), type: 'application/octet-stream' })).status, 415);
  });

  it('confirm: creates the requirements, ONE network update, the Initial baseline, priorities and source fields', async () => {
    const p = await fresh();
    const pv = (await p.preview(retail())).data;
    const r = await p.confirm({ documentId: pv.documentId, documentName: pv.documentName, items: itemsOf(pv) });
    assert.equal(r.status, 201);
    assert.equal(r.data.created, 31);
    assert.equal(r.data.failed, 0);
    assert.equal(r.data.ids.length, 31);
    assert.equal(r.data.network.updated, true);
    assert.equal(r.data.baselineCreated, true);
    assert.equal(await p.count(), 31);

    const entries = await p.ledger();
    assert.equal(entries.filter((e) => e.eventCode === 'REQUIREMENT_CREATED').length, 31);
    assert.equal(entries.filter((e) => e.eventCode === 'NETWORK_UPDATE').length, 1);
    assert.equal(entries.filter((e) => e.eventCode === 'BASELINE_CREATED').length, 1);
    assert.equal((await h.api('GET', `${p.base}/ledger/verify`)).data.valid, true);
    assert.equal(await h.models('Baseline').countDocuments({ projectId: p.pid, initial: true }), 1);

    const reqs = (await h.api('GET', `${p.base}/requirements`)).data;
    assert.equal(reqs.length, 31);
    const r1 = reqs.find((x) => x.sourceDocument?.sourceId === 'FR-001');
    assert.equal(r1.priority, 'High'); // Must
    assert.equal(r1.liveStatus, 'Confirmed');
    assert.equal(r1.granularity, 'Sprint Commitment');
    assert.equal(r1.sourceDocument.name, 'SRS_Online_Retail_Platform_Sample.docx');
    assert.ok(reqs.some((x) => x.priority === 'Medium')); // Should
    assert.ok(reqs.every((x) => x.cluster)); // computed clusters exist right after the import
    const stored = await h.models('Requirement').findOne({ projectId: p.pid, reqId: r1.id }).lean();
    assert.equal(stored.groupId, 'Catalogue'); // the feature area lives ONLY in groupId
    const ids = r.data.ids;
    assert.match(ids[0], /-R01$/);
    assert.match(ids[30], /-R31$/);
  });

  it('a double click (same documentId and items) creates nothing twice, even in parallel', async () => {
    const p = await fresh();
    const pv = (await p.preview(hospital())).data;
    const body = { documentId: pv.documentId, documentName: pv.documentName, items: itemsOf(pv) };
    const calls = await Promise.all([p.confirm(body), p.confirm(body), p.confirm(body)]);
    assert.ok(calls.every((c) => c.status === 201));
    assert.equal(calls.filter((c) => c.data.alreadyImported).length, 2);
    assert.equal(await p.count(), 26);
    assert.equal((await p.ledger()).filter((e) => e.eventCode === 'REQUIREMENT_CREATED').length, 26);
    const again = await p.confirm(body);
    assert.equal(again.data.alreadyImported, true);
    assert.equal(again.data.created, 26);
    assert.equal(await p.count(), 26);
  });

  it('a second import into a project that already has requirements: warns, skips duplicates, force adds them', async () => {
    const p = await fresh();
    await p.addRequirement();
    await p.addRequirement();
    const first = (await p.preview(retail())).data;
    assert.equal(first.existingRequirements, 2);
    await p.confirm({ documentId: first.documentId, documentName: first.documentName, items: itemsOf(first) });
    assert.equal(await p.count(), 33);
    assert.equal(await h.models('Baseline').countDocuments({ projectId: p.pid, initial: true }), 1);

    const second = (await p.preview(retail())).data;
    assert.equal(second.existingRequirements, 33);
    assert.equal(second.duplicates.length, 31);
    assert.ok(second.candidates.every((c) => c.duplicateOf && !c.selected));
    const all = itemsOf(second, false);
    const skip = await p.confirm({ documentId: second.documentId, documentName: second.documentName, items: all.slice(0, 30) });
    assert.equal(skip.data.created, 0);
    assert.equal(skip.data.skipped, 30);
    assert.equal(await p.count(), 33);

    const forced = await p.confirm({ documentId: second.documentId, documentName: second.documentName, items: all, force: true });
    assert.equal(forced.data.created, 31);
    assert.match(forced.data.ids[0], /-R34$/); // numbering continues
    assert.equal(await p.count(), 64);
    assert.equal(forced.data.baselineCreated, false);
    const entries = await p.ledger();
    assert.equal(entries.filter((e) => e.eventCode === 'BASELINE_CREATED').length, 1);
    assert.equal(entries.filter((e) => e.eventCode === 'NETWORK_UPDATE').length, 2); // one per import that created requirements
  });

  it('the ai-service being down is a 502 before anything is saved, and the import can be retried', async () => {
    const p = await fresh();
    const pv = (await p.preview(hospital())).data;
    const body = { documentId: pv.documentId, documentName: pv.documentName, items: itemsOf(pv) };
    h.ai.embedDown = true;
    const down = await p.confirm(body);
    assert.equal(down.status, 502);
    assert.equal(await p.count(), 0);
    assert.equal((await p.ledger()).length, 0);
    h.ai.embedDown = false;
    const retry = await p.confirm(body);
    assert.equal(retry.status, 201);
    assert.equal(retry.data.created, 26);
  });

  it('confirm is PM only and validates its body', async () => {
    const p = await fresh();
    const good = { documentId: 'a'.repeat(64), documentName: 'x.docx', items: [{ title: 'Some title', description: 'd', type: 'FR' }] };
    assert.equal((await p.confirm(good, { token: h.member.token })).status, 403);
    assert.equal((await p.confirm({ ...good, documentId: 'nope' })).status, 400);
    assert.equal((await p.confirm({ ...good, items: [] })).status, 400);
    assert.equal((await p.confirm({ ...good, items: [{ title: 'ab', type: 'FR' }] })).status, 400);
    assert.equal((await p.confirm({ ...good, items: Array.from({ length: 301 }, (_, i) => ({ title: `Title ${i}`, type: 'FR' })) })).status, 400);
  });
});
