'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../helpers/harness');

// Stubbed ai client: every signal is a confident Expectation whose best match is far away (similarity 0.2), so the detector
// flags it unless a test says otherwise. Texts are embedded by keyword so that grouping is controlled:
//   koko -> axis 1 (koko texts are ~identical), loyalty -> axis 2, everything else -> axis 0 (the requirements).
const vec = (t) => {
  if (/koko/i.test(t)) return [0.2, 0.98, 0, 0];
  if (/loyalty/i.test(t)) return [0, 0, 1, 0];
  return [1, 0, 0, 0];
};

describe('requirement candidates (stubbed ai client, *_test database)', () => {
  let h;
  const KOKO1 = 'We would like to implement the koko payment option as well.';
  const KOKO2 = 'Customers keep asking whether koko instalments are possible.';

  before(async () => { h = await start(); });
  after(async () => { await h.close(); });
  beforeEach(() => Object.assign(h.ai, { down: false, matchDown: false, embedDown: false, label: 'Expectation', confidence: 0.95, similarity: 0.2, matchTo: null, embedFn: vec, classifyFor: null, matchFor: null }));

  // A fresh project with 3 requirements and a computed network.
  async function fresh() {
    const p = await h.newProject();
    const reqs = [await p.addRequirement(), await p.addRequirement(), await p.addRequirement()];
    await h.api('GET', `/projects/${p.projectId}/network`);
    const base = `/projects/${p.projectId}`;
    return {
      pid: p.projectId, reqs,
      post: (body) => h.api('POST', `${base}/signals`, { body: { source: 'Slack', ...body } }),
      candidates: (q = '', opts) => h.api('GET', `${base}/requirement-candidates${q}`, opts),
      review: (id, body, opts) => h.api('POST', `${base}/requirement-candidates/${id}/review`, { body, ...opts }),
      ledger: async () => (await h.api('GET', `${base}/ledger`)).data,
    };
  }

  it('preview flags a possible new requirement: pending, "new-requirement", reason, nothing saved', async () => {
    const p = await fresh();
    const r = await h.api('POST', `/projects/${p.pid}/signals/preview`, { body: { source: 'Slack', text: KOKO1 } });
    assert.equal(r.status, 200);
    assert.equal(r.data.newRequirement.isCandidate, true);
    assert.equal(r.data.newRequirement.reason, 'no close requirement');
    assert.equal(r.data.newRequirement.joinsCandidateId, null);
    assert.equal(r.data.reviewStatus, 'pending');
    assert.equal(r.data.reviewReason, 'new-requirement');
    assert.equal(r.data.wouldApply, false);
    assert.equal((await p.candidates()).data.length, 0);
  });

  it('is never a candidate when the match is close, or the label is not Expectation', async () => {
    const p = await fresh();
    h.ai.similarity = 0.7;
    const close = await p.post({ text: 'The test requirement should work.' });
    assert.equal(close.data.newRequirement.isCandidate, false);
    assert.equal(close.data.reviewStatus, 'accepted'); // the normal flow is untouched
    h.ai.similarity = 0.2;
    h.ai.label = 'Constraint';
    assert.equal((await p.post({ text: KOKO1 })).data.newRequirement.isCandidate, false);
    assert.equal((await p.candidates()).data.length, 0);
  });

  it('the borderline band needs a novel token: "koko" qualifies, a word from the requirements does not', async () => {
    const p = await fresh();
    h.ai.similarity = 0.42;
    const novel = await p.post({ text: 'would like to implement the koko payment option as well' });
    assert.equal(novel.data.newRequirement.isCandidate, true);
    assert.equal(novel.data.newRequirement.reason, 'new terms: koko, payment');
    const plain = await p.post({ text: 'Please make the test requirement testable' });
    assert.equal(plain.data.newRequirement.isCandidate, false);
    assert.equal(plain.data.reviewStatus, 'accepted');
  });

  it('create: a candidate signal is saved pending and changes nothing; a repeated mention joins the same candidate', async () => {
    const p = await fresh();
    const before = (await p.ledger()).length;
    const a = await p.post({ text: KOKO1 });
    assert.equal(a.status, 201);
    assert.equal(a.data.reviewStatus, 'pending');
    assert.equal(a.data.reviewReason, 'new-requirement');
    assert.equal(a.data.applied, false);
    assert.equal(a.data.statusChange, null);
    assert.equal(a.data.newRequirement.candidateId, 'RC-0001');
    assert.equal(a.data.signal.candidateId, 'RC-0001');
    assert.equal((await p.ledger()).length, before); // no ledger entry
    for (const r of p.reqs) assert.equal((await h.models('Requirement').findOne({ reqId: r.reqId })).liveStatus, 'Confirmed');

    const b = await p.post({ text: KOKO2 });
    assert.equal(b.data.newRequirement.joinsCandidateId, 'RC-0001');
    assert.equal(b.data.newRequirement.candidateId, 'RC-0001');
    const other = await p.post({ text: 'The business wants a loyalty points programme.' });
    assert.equal(other.data.newRequirement.candidateId, 'RC-0002');

    const list = (await p.candidates('?status=pending')).data;
    assert.equal(list.length, 2);
    const rc1 = list.find((c) => c.id === 'RC-0001');
    assert.equal(rc1.mentions, 2);
    assert.deepEqual(rc1.evidence.map((e) => e.text), [KOKO1, KOKO2]);
    assert.equal(rc1.title, 'Koko payment option');
    assert.equal(rc1.type, 'FR');
    assert.equal(rc1.closestSimilarity, 0.2);
    assert.equal('centroid' in rc1, false);

    // a preview now says which candidate it would join
    const pv = await h.api('POST', `/projects/${p.pid}/signals/preview`, { body: { source: 'Slack', text: 'koko again please' } });
    assert.equal(pv.data.newRequirement.joinsCandidateId, 'RC-0001');
  });

  it('any member can read the candidates; outsiders cannot; only a PM can review', async () => {
    const pid = h.projectId;
    await h.addRequirement();
    const created = await h.api('POST', `/projects/${pid}/signals`, { body: { source: 'Slack', text: KOKO1 } });
    const id = created.data.signal.candidateId;
    assert.ok(id);
    assert.equal((await h.api('GET', `/projects/${pid}/requirement-candidates`, { token: h.member.token })).status, 200);
    assert.equal((await h.api('GET', `/projects/${pid}/requirement-candidates`, { token: h.outsider.token })).status, 403);
    const denied = await h.api('POST', `/projects/${pid}/requirement-candidates/${id}/review`, { token: h.member.token, body: { action: 'reject' } });
    assert.equal(denied.status, 403);
    assert.equal((await h.api('GET', `/projects/${pid}/requirement-candidates?status=pending`)).data.find((c) => c.id === id).status, 'pending');
  });

  it('approve: creates the requirement (next id, ledger entry with the first evidence signal), finalises the evidence, ONE network update', async () => {
    const p = await fresh();
    const s1 = (await p.post({ text: KOKO1 })).data.signal;
    const s2 = (await p.post({ text: KOKO2 })).data.signal;
    const netBefore = (await p.ledger()).filter((e) => e.eventCode === 'NETWORK_UPDATE').length;

    const r = await p.review('RC-0001', { action: 'approve', title: 'Koko payment option', description: 'Pay in instalments with Koko.', type: 'FR', priority: 'High', note: 'seen twice' });
    assert.equal(r.status, 200);
    const newId = r.data.requirement.id;
    assert.equal(newId, `${p.reqs[0].reqId.replace(/\d+$/, '')}04`); // next free id
    assert.equal(r.data.requirement.title, 'Koko payment option');
    assert.equal(r.data.requirement.priority, 'High');
    assert.equal(r.data.requirement.liveStatus, 'Confirmed');
    assert.equal(r.data.candidate.status, 'approved');
    assert.equal(r.data.candidate.createdRequirementId, newId);
    assert.deepEqual(r.data.signals.map((s) => s.status), ['accepted', 'accepted']);

    const entries = await p.ledger();
    const created = entries.find((e) => e.eventCode === 'REQUIREMENT_CREATED' && e.requirementId === newId);
    assert.ok(created);
    assert.equal(created.triggeringSignalId, s1.id);
    assert.equal(created.triggeringSignal, KOKO1);
    const netAfter = entries.filter((e) => e.eventCode === 'NETWORK_UPDATE').length;
    assert.ok(netAfter - netBefore <= 1, `expected at most one NETWORK_UPDATE, got ${netAfter - netBefore}`);
    assert.equal(netAfter - netBefore, 1); // the new node connects to the network
    assert.equal((await h.api('GET', `/projects/${p.pid}/ledger/verify`)).data.valid, true);

    // the evidence signals are accepted and mapped to the new requirement, with history rows and network evidence/profile
    for (const s of [s1, s2]) {
      const sig = await h.models('Signal').findOne({ projectId: p.pid, signalId: s.id }).lean();
      assert.equal(sig.reviewStatus, 'accepted');
      assert.equal(sig.reqId, newId);
      assert.equal(sig.applied, true);
      assert.equal(await h.models('StatusHistory').countDocuments({ projectId: p.pid, signalId: s.id, reqId: newId }), 1);
    }
    const profile = await h.models('Requirement').findOne({ projectId: p.pid, reqId: newId }).select('+signalProfile').lean();
    assert.equal(profile.signalProfile.count, 2);
    const net = (await h.api('GET', `/projects/${p.pid}/network`)).data;
    assert.ok(net.links.some((l) => l.source === newId || l.target === newId));

    const fb = await h.models('Feedback').findOne({ projectId: p.pid, kind: 'requirement-candidate' }).lean();
    assert.equal(fb.action, 'approve');
    assert.equal(fb.candidateId, 'RC-0001');
    assert.equal(fb.candidate.closestSimilarity, 0.2);
    assert.equal(fb.candidate.evidenceCount, 2);
    assert.equal(fb.candidate.createdRequirementId, newId);

    // the retraining export ignores candidate decisions
    const exp = await h.api('GET', `/projects/${p.pid}/feedback/export`);
    assert.ok(!exp.text.includes('koko'));
    // and approving twice is refused
    assert.equal((await p.review('RC-0001', { action: 'approve' })).status, 409);
  });

  it('concurrent approvals create exactly ONE requirement', async () => {
    const p = await fresh();
    await p.post({ text: KOKO1 });
    const calls = await Promise.all([1, 2, 3].map(() => p.review('RC-0001', { action: 'approve' })));
    const statuses = calls.map((c) => c.status).sort();
    assert.deepEqual(statuses, [200, 409, 409]);
    assert.equal(await h.models('Requirement').countDocuments({ projectId: p.pid }), 4);
    assert.equal((await p.ledger()).filter((e) => e.eventCode === 'REQUIREMENT_CREATED').length, 1);
  });

  it('concurrent approve + merge + reject on one candidate: exactly one wins', async () => {
    const p = await fresh();
    await p.post({ text: KOKO1 });
    const calls = await Promise.all([
      p.review('RC-0001', { action: 'approve' }),
      p.review('RC-0001', { action: 'merge', mergeIntoRequirementId: p.reqs[0].reqId }),
      p.review('RC-0001', { action: 'reject' }),
    ]);
    assert.equal(calls.filter((c) => c.status === 200).length, 1);
    assert.equal(calls.filter((c) => c.status === 409).length, 2);
  });

  it('merge: maps the evidence to the chosen requirement as Expectations; no new requirement; at most one network update', async () => {
    const p = await fresh();
    await p.post({ text: KOKO1 });
    await p.post({ text: KOKO2 });
    const target = p.reqs[1].reqId;
    const netBefore = (await p.ledger()).filter((e) => e.eventCode === 'NETWORK_UPDATE').length;
    const r = await p.review('RC-0001', { action: 'merge', mergeIntoRequirementId: target });
    assert.equal(r.status, 200);
    assert.equal(r.data.candidate.status, 'merged');
    assert.equal(r.data.candidate.mergedInto, target);
    assert.equal(r.data.requirement, null);
    assert.equal(await h.models('Requirement').countDocuments({ projectId: p.pid }), 3);
    const sigs = await h.models('Signal').find({ projectId: p.pid, candidateId: 'RC-0001' }).lean();
    assert.equal(sigs.length, 2);
    for (const s of sigs) { assert.equal(s.reviewStatus, 'accepted'); assert.equal(s.reqId, target); assert.equal(s.label, 'Expectation'); }
    const netAfter = (await p.ledger()).filter((e) => e.eventCode === 'NETWORK_UPDATE').length;
    assert.ok(netAfter - netBefore <= 1);
    const fb = await h.models('Feedback').findOne({ projectId: p.pid, kind: 'requirement-candidate' }).lean();
    assert.equal(fb.action, 'merge');
    assert.equal(fb.candidate.mergedInto, target);
  });

  it('merge validation: mergeIntoRequirementId is required, and the requirement must exist', async () => {
    const p = await fresh();
    await p.post({ text: KOKO1 });
    assert.equal((await p.review('RC-0001', { action: 'merge' })).status, 400);
    assert.equal((await p.review('RC-0001', { action: 'merge', mergeIntoRequirementId: 'NOPE-R99' })).status, 404);
    assert.equal((await p.candidates('?status=pending')).data.length, 1); // still pending
  });

  it('reject: signals rejected, no status effect; a near-identical repeat is stored but suppressed', async () => {
    const p = await fresh();
    const before = (await p.ledger()).length;
    const s1 = (await p.post({ text: KOKO1 })).data.signal;
    const r = await p.review('RC-0001', { action: 'reject', note: 'out of scope' });
    assert.equal(r.status, 200);
    assert.equal(r.data.candidate.status, 'rejected');
    assert.equal((await h.models('Signal').findOne({ projectId: p.pid, signalId: s1.id })).reviewStatus, 'rejected');
    assert.equal((await p.ledger()).length, before);
    assert.equal(await h.models('Requirement').countDocuments({ projectId: p.pid }), 3);
    assert.equal((await h.models('Feedback').findOne({ projectId: p.pid, kind: 'requirement-candidate' })).action, 'reject');

    const repeat = await p.post({ text: 'koko instalments for payment please' });
    assert.equal(repeat.status, 201);
    assert.equal(repeat.data.reviewStatus, 'pending');
    assert.equal(repeat.data.newRequirement.suppressed, true);
    assert.equal(repeat.data.newRequirement.reason, 'similar to a rejected candidate');
    assert.equal(repeat.data.newRequirement.candidateId, null);
    assert.equal(repeat.data.signal.candidateId, null);
    assert.equal(repeat.data.signal.suppressed, true);
    assert.equal((await p.candidates()).data.length, 1); // nothing created or attached
    assert.equal((await p.candidates('?status=pending')).data.length, 0);

    const base = `/projects/${p.pid}/signals`;
    const hidden = (await h.api('GET', `${base}?reviewStatus=pending`)).data;
    assert.ok(!hidden.some((s) => s.id === repeat.data.signal.id));
    const shown = (await h.api('GET', `${base}?reviewStatus=pending&includeSuppressed=true`)).data;
    assert.ok(shown.some((s) => s.id === repeat.data.signal.id));
  });

  it('extract and bulk: one /embed call for the candidate-looking items; bulk creates and extends candidates', async () => {
    const p = await fresh();
    const text = `${KOKO1}\n${KOKO2}\nThe business wants a loyalty points programme.`;
    const e0 = h.ai.calls.embed;
    const ex = await h.api('POST', `/projects/${p.pid}/signals/extract`, { body: { text, name: 'notes' } });
    assert.equal(ex.status, 200);
    assert.equal(h.ai.calls.embed - e0, 1);
    assert.equal(ex.data.segments.length, 3);
    assert.ok(ex.data.segments.every((s) => s.newRequirement.isCandidate));
    assert.equal(ex.data.newRequirementCount, 3);
    assert.equal((await p.candidates()).data.length, 0); // extract saves nothing

    const e1 = h.ai.calls.embed;
    const bulk = await h.api('POST', `/projects/${p.pid}/signals/bulk`, {
      body: { documentId: ex.data.documentId, name: 'notes', source: 'Standup', items: ex.data.segments.map((s) => ({ text: s.text })) },
    });
    assert.equal(bulk.status, 201);
    assert.equal(h.ai.calls.embed - e1, 1);
    assert.equal(bulk.data.summary.pending, 3);
    assert.equal(bulk.data.newRequirementCount, 3);
    const cands = (await p.candidates('?status=pending')).data;
    assert.equal(cands.length, 2);
    assert.equal(cands.find((c) => c.evidence.some((e) => e.text === KOKO1)).mentions, 2);
    assert.deepEqual(bulk.data.results.map((r) => r.newRequirement.candidateId), ['RC-0001', 'RC-0001', 'RC-0002']);
  });

  it('a signal reviewed on its own leaves its candidate; an empty candidate disappears', async () => {
    const p = await fresh();
    const s = (await p.post({ text: KOKO1 })).data.signal;
    const rv = await h.api('POST', `/projects/${p.pid}/signals/${s.id}/review`, { body: { action: 'reject' } });
    assert.equal(rv.status, 200);
    assert.equal((await p.candidates()).data.length, 0);
  });

  it('degrades when the embedder is down: the signal is stored pending, flagged, without a candidate', async () => {
    const p = await fresh();
    h.ai.embedDown = true;
    const r = await p.post({ text: KOKO1 });
    assert.equal(r.status, 201);
    assert.equal(r.data.reviewStatus, 'pending');
    assert.equal(r.data.newRequirement.isCandidate, true);
    assert.equal(r.data.newRequirement.candidateId, null);
    assert.equal((await p.candidates()).data.length, 0);
  });
});
