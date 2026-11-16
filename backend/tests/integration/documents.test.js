'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { start } = require('../helpers/harness');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name));

// The stub classifier decides from the words in the text, like a tiny keyword model.
const classifyFor = (t) => {
  if (/went live|released|finished|complete/i.test(t)) return { label: 'Completion', confidence: 0.96 };
  if (/blocked|disagree/i.test(t)) return { label: 'Conflict', confidence: 0.95 };
  if (/must not|approval/i.test(t)) return { label: 'Constraint', confidence: 0.6 }; // low confidence -> needs review
  if (/should|wants|need/i.test(t)) return { label: 'Expectation', confidence: 0.93 };
  return { label: 'None', confidence: 0.92 };
};

describe('documents: extract (saves nothing) and bulk (saves through the normal flow)', () => {
  let h;
  let reqA;
  let reqB;
  const sig = () => `/projects/${h.projectId}/signals`;
  const DOC = [
    'Standup notes 3 Aug',
    'Developer: The delivery slot picker was finished and released on Friday.',
    'Finance wants approval before any refund can be issued to a customer.',
    'Hello team,',
    'Happy birthday to Nimal, hope the day goes really well for him!',
    'The tax tables are blocked because the vendor has not delivered them yet.',
    'Search results should load faster than two seconds for every query.',
  ].join('\n');

  before(async () => {
    h = await start();
    h.ai.classifyFor = classifyFor;
  });
  after(async () => { await h.close(); });
  beforeEach(async () => {
    Object.assign(h.ai, { down: false, matchDown: false, similarity: 0.7, matchTo: null, matchFor: null });
    reqA = await h.addRequirement('At Risk', { title: 'Delivery slot selection', description: 'Customers pick a delivery slot' });
    reqB = await h.addRequirement('Confirmed', { title: 'Search response under two seconds' });
    h.ai.matchFor = (text) => (/search/i.test(text) ? reqB.reqId : reqA.reqId);
  });

  it('extract (JSON text): segments with line numbers, speaker labels, labels, matches and decisions; nothing is saved', async () => {
    const Signal = h.models('Signal');
    const before = await Signal.countDocuments({ projectId: h.projectId });
    const r = await h.api('POST', `${sig()}/extract`, { body: { text: DOC, name: 'standup.txt', source: 'Standup' } });
    assert.equal(r.status, 200);
    const d = r.data;
    assert.equal(d.documentId, crypto.createHash('sha256').update(DOC.trim(), 'utf8').digest('hex'));
    assert.equal(d.name, 'standup.txt');
    assert.equal(d.alreadySubmitted, false);
    assert.deepEqual(d.counts, { total: 5, signals: 4, none: 1 }); // "Standup notes 3 Aug" is a short title line, "Hello team," a greeting
    const [done, approval, birthday, blocked, search] = d.segments;
    assert.equal(done.text, 'The delivery slot picker was finished and released on Friday.');
    assert.equal(done.speakerLabel, 'Developer');
    assert.equal(done.line, 2);
    assert.equal(done.label, 'Completion');
    assert.equal(done.confidence, 96);
    assert.equal(done.match.requirementId, reqA.reqId);
    assert.ok(done.match.alternatives.length >= 1);
    assert.equal(done.proposedStatus, 'Confirmed');
    assert.equal(done.wouldAutoApply, true);
    assert.equal(approval.label, 'Constraint');
    assert.equal(approval.wouldAutoApply, false);
    assert.equal(approval.reviewReason, 'low-confidence');
    assert.equal(birthday.label, 'None');
    assert.equal(birthday.match, null);
    assert.equal(birthday.wouldAutoApply, false);
    assert.equal(blocked.label, 'Conflict');
    assert.equal(blocked.line, 6);
    assert.equal(search.match.requirementId, reqB.reqId);
    // the whole batch used ONE classify call and ONE match call
    assert.equal(h.ai.calls.classify, 0);
    // nothing saved, nothing applied
    assert.equal(await Signal.countDocuments({ projectId: h.projectId }), before);
    assert.equal((await h.models('Requirement').findOne({ reqId: reqA.reqId })).liveStatus, 'At Risk');
    assert.equal(await h.models('LedgerEntry').countDocuments({ projectId: h.projectId, eventType: 'STATUS_CHANGE' }), 0);
  });

  it('extract uses one batch classify and one batch match call, whatever the number of segments', async () => {
    const c0 = h.ai.calls.classifyBatch;
    const m0 = h.ai.calls.matchBatch;
    await h.api('POST', `${sig()}/extract`, { body: { text: DOC } });
    assert.equal(h.ai.calls.classifyBatch - c0, 1);
    assert.equal(h.ai.calls.matchBatch - m0, 1);
  });

  it('extract accepts multipart .txt, .md, .docx and .pdf; rejects other types (415) and oversized files (413)', async () => {
    const txt = await h.form('POST', `${sig()}/extract`, { fields: { source: 'Email' }, file: { name: 'notes.txt', buffer: Buffer.from(DOC), type: 'text/plain' } });
    assert.equal(txt.status, 200);
    assert.equal(txt.data.name, 'notes.txt');
    assert.equal(txt.data.source, 'Email');
    assert.equal(txt.data.counts.total, 5);
    const md = await h.form('POST', `${sig()}/extract`, { file: { name: 'notes.md', buffer: Buffer.from('# Notes\n- The wishlist should be ready before the go-live date.\n') } });
    assert.equal(md.status, 200);
    assert.equal(md.data.segments[0].text, 'The wishlist should be ready before the go-live date.');
    const docx = await h.form('POST', `${sig()}/extract`, { file: { name: 'retro.docx', buffer: fixture('sample.docx') } });
    assert.equal(docx.status, 200);
    assert.deepEqual(docx.data.segments.map((s) => s.label), ['Completion', 'Constraint', 'Expectation']); // "Hello team," is ignored
    const pdf = await h.form('POST', `${sig()}/extract`, { file: { name: 'spec.pdf', buffer: fixture('sample.pdf') } });
    assert.ok([200, 415].includes(pdf.status), `pdf status ${pdf.status}`);
    if (pdf.status === 200) assert.match(pdf.data.segments[0].text, /payment gateway must not store card numbers/);
    else assert.equal(pdf.json.error.code, 'PDF_UNSUPPORTED');
    const png = await h.form('POST', `${sig()}/extract`, { file: { name: 'photo.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } });
    assert.equal(png.status, 415);
    assert.equal(png.json.error.code, 'UNSUPPORTED_FILE_TYPE');
    const bin = await h.form('POST', `${sig()}/extract`, { file: { name: 'x.txt', buffer: Buffer.from([65, 0, 66, 0]) } });
    assert.equal(bin.status, 415);
    const badDocx = await h.form('POST', `${sig()}/extract`, { file: { name: 'x.docx', buffer: Buffer.from('not a zip') } });
    assert.equal(badDocx.status, 400);
    const big = await h.form('POST', `${sig()}/extract`, { file: { name: 'big.txt', buffer: Buffer.alloc(2 * 1024 * 1024 + 10, 97) } });
    assert.equal(big.status, 413);
    assert.equal(big.json.error.code, 'FILE_TOO_LARGE');
    assert.equal((await h.api('POST', `${sig()}/extract`, { body: {} })).status, 400);
  });

  it('extract rejects more than 300 segments with a 413 that names the limit', async () => {
    const lines = Array.from({ length: 301 }, (_, i) => `Statement number ${i} about the checkout flow is long enough to count.`).join('\n');
    const r = await h.api('POST', `${sig()}/extract`, { body: { text: lines } });
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, 'TOO_MANY_SEGMENTS');
    assert.match(r.json.error.message, /limit is 300/);
    assert.match(r.json.error.message, /Split the document/);
  });

  it('extract: AI service down -> 502; any project member may extract, a non-member may not', async () => {
    h.ai.down = true;
    assert.equal((await h.api('POST', `${sig()}/extract`, { body: { text: DOC } })).status, 502);
    h.ai.down = false;
    assert.equal((await h.api('POST', `${sig()}/extract`, { body: { text: DOC }, token: h.member.token })).status, 200);
    assert.equal((await h.api('POST', `${sig()}/extract`, { body: { text: DOC }, token: h.outsider.token })).status, 403);
  });

  it('bulk: processes items in order through the normal flow and reports applied / pending / noChange / failed', async () => {
    const ex = (await h.api('POST', `${sig()}/extract`, { body: { text: DOC, name: 'standup.txt' } })).data;
    const items = ex.segments.map((s) => ({ text: s.text }));
    // same requirement as the first item. The Conflict item before it moved it back to At Risk, so this Completion changes it again:
    // each item must see the status the earlier items left behind.
    items.push({ text: 'The delivery slot picker was finished and released again on Monday.' });
    items.push({ text: 'A broken item that points at a requirement which does not exist.', requirementId: 'NOPE-99' });
    h.ai.classifyFor = (t) => (/broken item/.test(t) ? { label: 'Constraint', confidence: 0.99 } : classifyFor(t));
    const r = await h.api('POST', `${sig()}/bulk`, { body: { documentId: ex.documentId, name: 'standup.txt', source: 'Standup', items } });
    h.ai.classifyFor = classifyFor;
    assert.equal(r.status, 201);
    assert.deepEqual(r.data.summary, { applied: 3, pending: 1, noChange: 2, failed: 1 });
    const by = (needle) => r.data.results.find((x) => x.text.includes(needle));
    assert.equal(by('finished and released on Friday').status, 'applied');
    assert.deepEqual(by('finished and released on Friday').statusChange, { from: 'At Risk', to: 'Confirmed' });
    assert.equal(by('Finance wants approval').status, 'pending');
    assert.equal(by('birthday').status, 'noChange');
    assert.equal(by('released again on Monday').status, 'applied');
    assert.deepEqual(by('released again on Monday').statusChange, { from: 'At Risk', to: 'Confirmed' }); // saw the status the Conflict item set
    assert.equal(by('blocked because the vendor').status, 'applied');
    assert.deepEqual(by('blocked because the vendor').statusChange, { from: 'Confirmed', to: 'At Risk' });
    assert.equal(by('broken item').status, 'failed');
    assert.match(by('broken item').error, /not found/);
    // stored with its document and in the ledger
    const feed = (await h.api('GET', sig())).data.filter((s) => s.sourceDocument?.id === ex.documentId);
    assert.equal(feed.length, 6);
    assert.deepEqual(feed[0].sourceDocument, { id: ex.documentId, name: 'standup.txt' });
    assert.equal((await h.models('Requirement').findOne({ reqId: reqA.reqId })).liveStatus, 'Confirmed');
    assert.ok((await h.models('StatusHistory').countDocuments({ projectId: h.projectId, reqId: reqA.reqId })) >= 2);
    assert.equal((await h.api('GET', `/projects/${h.projectId}/ledger/verify`)).data.valid, true);
  });

  it('bulk: the same document is a 409 unless force is true; extract then says alreadySubmitted', async () => {
    const ex = (await h.api('POST', `${sig()}/extract`, { body: { text: 'Standup: The refund screen went live this morning for all customers.' } })).data;
    const body = { documentId: ex.documentId, name: 'once.txt', items: [{ text: ex.segments[0].text }] };
    assert.equal((await h.api('POST', `${sig()}/bulk`, { body })).status, 201);
    const again = await h.api('POST', `${sig()}/bulk`, { body });
    assert.equal(again.status, 409);
    assert.equal(again.json.error.code, 'DOCUMENT_ALREADY_SUBMITTED');
    assert.equal((await h.api('POST', `${sig()}/bulk`, { body: { ...body, force: true } })).status, 201);
    const re = await h.api('POST', `${sig()}/extract`, { body: { text: 'Standup: The refund screen went live this morning for all customers.' } });
    assert.equal(re.data.alreadySubmitted, true);
  });

  it('bulk: an explicit requirementId is used (and counts as the user\'s choice); the AI service being down returns 502 and saves nothing', async () => {
    const Signal = h.models('Signal');
    const text = 'The delivery slot picker was finished and released on Friday.';
    const id = crypto.createHash('sha256').update('manual-choice', 'utf8').digest('hex');
    const ok = await h.api('POST', `${sig()}/bulk`, { body: { documentId: id, name: 'm.txt', items: [{ text, requirementId: reqB.reqId }] } });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.results[0].requirementId, reqB.reqId);
    assert.equal(ok.data.summary.noChange + ok.data.summary.applied, 1);

    const before = await Signal.countDocuments({ projectId: h.projectId });
    h.ai.down = true;
    const id2 = crypto.createHash('sha256').update('down', 'utf8').digest('hex');
    const bad = await h.api('POST', `${sig()}/bulk`, { body: { documentId: id2, name: 'd.txt', items: [{ text }] } });
    h.ai.down = false;
    assert.equal(bad.status, 502);
    assert.equal(await Signal.countDocuments({ projectId: h.projectId }), before);
  });

  it('bulk: validation (max 100 items, documentId format) and membership', async () => {
    const documentId = crypto.createHash('sha256').update('v', 'utf8').digest('hex');
    const many = Array.from({ length: 101 }, (_, i) => ({ text: `Item ${i} about the checkout flow.` }));
    assert.equal((await h.api('POST', `${sig()}/bulk`, { body: { documentId, name: 'x', items: many } })).status, 400);
    assert.equal((await h.api('POST', `${sig()}/bulk`, { body: { documentId: 'abc', name: 'x', items: [{ text: 'hello there' }] } })).status, 400);
    assert.equal((await h.api('POST', `${sig()}/bulk`, { body: { documentId, name: 'x', items: [{ text: 'hello there friends' }] }, token: h.outsider.token })).status, 403);
    assert.equal((await h.api('POST', `${sig()}/bulk`, { body: { documentId, name: 'x', items: [{ text: 'hello there friends, how are you' }] }, token: h.member.token })).status, 201);
  });
});
