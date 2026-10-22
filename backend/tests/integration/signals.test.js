'use strict';
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../helpers/harness');

describe('POST /projects/:projectId/signals (stubbed ai client, *_test database)', () => {
  let h;
  const post = (body, opts) => h.api('POST', `/projects/${h.projectId}/signals`, { body, ...opts });

  before(async () => { h = await start(); });
  after(async () => { await h.close(); });
  beforeEach(() => Object.assign(h.ai, { down: false, matchDown: false, label: 'Expectation', confidence: 0.95, similarity: 0.7, matchTo: null }));

  it('auto-accepts a confident, mapped signal: updates the requirement, history (role + granularity) and ledger', async () => {
    const req = await h.addRequirement('At Risk');
    await h.addRequirement();
    await h.addRequirement(); // so there are 3 candidates to rank
    h.ai.matchTo = req.reqId;
    const r = await post({ source: 'Slack', text: 'The refund screen should be ready by Friday.' });
    assert.equal(r.status, 201);
    const d = r.data;
    assert.equal(d.classification.label, 'Expectation');
    assert.equal(d.classification.confidence, 95);
    assert.equal(d.classification.modelVersion, 'test-v1');
    assert.equal(d.autoAcceptThreshold, 90);
    assert.equal(d.match.requirementId, req.reqId);
    assert.equal(d.match.alternatives.length, 3);
    assert.equal(d.applied, true);
    assert.equal(d.reviewStatus, 'accepted');
    assert.deepEqual(d.statusChange, { from: 'At Risk', to: 'Confirmed' });
    assert.equal(d.ledgerEntry.eventCode, 'STATUS_CHANGE');
    assert.equal(d.ledgerEntry.eventType, 'Status Change');
    assert.equal(d.ledgerEntry.onChain, false);
    assert.equal(d.signal.autoAcceptThreshold, 90);
    assert.equal(d.signal.authorRole ?? d.signal.author, 'Project Manager'); // default = the user's job title

    const { Requirement, StatusHistory } = { Requirement: h.models('Requirement'), StatusHistory: h.models('StatusHistory') };
    assert.equal((await Requirement.findOne({ reqId: req.reqId })).liveStatus, 'Confirmed');
    const hist = await StatusHistory.findOne({ projectId: h.projectId, reqId: req.reqId });
    assert.equal(hist.resourceRole, 'Project Manager');
    assert.equal(hist.granularity, 'Weekly Workload');
    assert.equal(hist.statusChanged, true);
    const v = await h.api('GET', `/projects/${h.projectId}/ledger/verify`);
    assert.equal(v.data.valid, true);
    assert.ok(v.data.entries >= 1);
  });

  it('the 90 threshold: 90 is auto-accepted, 89 stays pending and changes nothing', async () => {
    const r1 = await h.addRequirement('Confirmed');
    const r2 = await h.addRequirement('Confirmed');
    h.ai.label = 'Constraint';
    h.ai.matchTo = r1.reqId; h.ai.confidence = 0.9;
    const hi = await post({ source: 'Email', text: 'Any change needs written approval.' });
    assert.equal(hi.data.reviewStatus, 'accepted');
    assert.equal(hi.data.applied, true);
    h.ai.matchTo = r2.reqId; h.ai.confidence = 0.89;
    const lo = await post({ source: 'Email', text: 'Any change needs written approval.' });
    assert.equal(lo.data.classification.confidence, 89);
    assert.equal(lo.data.reviewStatus, 'pending');
    assert.equal(lo.data.applied, false);
    assert.equal(lo.data.statusChange, null);
    assert.equal(lo.data.proposedStatus, 'Modified'); // proposed, but not applied
    assert.equal((await h.models('Requirement').findOne({ reqId: r2.reqId })).liveStatus, 'Confirmed');
  });

  it('None: stored, never mapped, nothing changes (confident = accepted, unsure = pending)', async () => {
    h.ai.label = 'None'; h.ai.confidence = 0.97;
    const before = h.ai.calls.match;
    const a = await post({ source: 'Slack', text: 'Happy birthday Nimal!' });
    assert.equal(a.status, 201);
    assert.equal(a.data.match, null);
    assert.equal(a.data.reviewStatus, 'accepted');
    assert.equal(a.data.applied, false);
    assert.equal(h.ai.calls.match, before); // /match not even called
    h.ai.confidence = 0.55;
    const b = await post({ source: 'Slack', text: 'Lunch anyone?' });
    assert.equal(b.data.reviewStatus, 'pending');
    assert.equal(b.data.signal.mappedRequirementId, null);
  });

  it('similarity below MATCH_MIN_SIMILARITY (0.30): stored unmapped and pending', async () => {
    await h.addRequirement();
    h.ai.similarity = 0.29;
    h.ai.label = 'Constraint'; // (a confident Expectation this far from every requirement is a possible NEW requirement instead: see requirementCandidates.test.js)
    const r = await post({ source: 'Teams', text: 'The new vendor contract must not change.' });
    assert.equal(r.status, 201);
    assert.equal(r.data.match.requirementId, null);
    assert.equal(r.data.match.similarity, 0.29);
    assert.equal(r.data.reviewStatus, 'pending');
    assert.equal(r.data.reviewReason, 'unmapped');
    assert.equal(r.data.signal.mappedRequirementId, null);
    assert.equal(r.data.applied, false);
  });

  it('AI service down: 202, stored as unclassified + pending, nothing applied', async () => {
    h.ai.down = true;
    const r = await post({ source: 'Slack', text: 'Checkout is complete.' });
    assert.equal(r.status, 202);
    assert.match(r.data.message, /classifier is unavailable/i);
    assert.equal(r.data.classification.label, null);
    assert.equal(r.data.reviewStatus, 'pending');
    assert.equal(r.data.applied, false);
    assert.equal(r.data.signal.classification, null);
  });

  it('matching down (classifier up): 202, label kept, stored unmapped and pending', async () => {
    await h.addRequirement();
    h.ai.matchDown = true;
    const r = await post({ source: 'Slack', text: 'Checkout is complete.' });
    assert.equal(r.status, 202);
    assert.equal(r.data.classification.label, 'Expectation');
    assert.equal(r.data.reviewStatus, 'pending');
    assert.equal(r.data.applied, false);
  });

  it('a given requirementId skips /match', async () => {
    const req = await h.addRequirement('Modified');
    const before = h.ai.calls.match;
    const r = await post({ source: 'Jira Comment', text: 'This should be ready soon.', requirementId: req.reqId, authorRole: 'Developer' });
    assert.equal(h.ai.calls.match, before);
    assert.equal(r.data.match.method, 'manual');
    assert.equal(r.data.signal.author, 'Developer');
    assert.equal(r.data.statusChange.to, 'Confirmed');
    const bad = await post({ source: 'Slack', text: 'x', requirementId: 'NOPE-99' });
    assert.equal(bad.status, 404);
  });

  it('a Conflict that drops a requirement waits for a PM; once Dropped, later signals are stored but change nothing', async () => {
    const req = await h.addRequirement('Confirmed');
    h.ai.label = 'Conflict'; h.ai.confidence = 0.99; h.ai.matchTo = req.reqId;
    const r = await post({ source: 'Email', text: 'Management postponed the loyalty module to next year.' });
    assert.equal(r.data.proposedStatus, 'Dropped');
    assert.equal(r.data.reviewStatus, 'pending');
    assert.equal(r.data.reviewReason, 'proposes-drop');
    assert.equal((await h.models('Requirement').findOne({ reqId: req.reqId })).liveStatus, 'Confirmed');

    const acc = await h.api('POST', `/projects/${h.projectId}/signals/${r.data.signal.id}/review`, { body: { action: 'accept' } });
    assert.equal(acc.status, 200);
    assert.deepEqual(acc.data.statusChange, { from: 'Confirmed', to: 'Dropped' });
    assert.equal((await h.models('Requirement').findOne({ reqId: req.reqId })).liveStatus, 'Dropped');

    h.ai.label = 'Expectation';
    const later = await post({ source: 'Slack', text: 'We should still deliver this one.' });
    assert.equal(later.data.signal.mappedRequirementId, req.reqId);
    assert.equal(later.data.statusChange, null);
    assert.equal(later.data.ledgerEntry, null);
    assert.equal((await h.models('Requirement').findOne({ reqId: req.reqId })).liveStatus, 'Dropped');
  });

  it('preview returns the same answer but saves and applies nothing', async () => {
    const req = await h.addRequirement('At Risk');
    h.ai.matchTo = req.reqId;
    const Signal = h.models('Signal');
    const n = await Signal.countDocuments({ projectId: h.projectId });
    const r = await h.api('POST', `/projects/${h.projectId}/signals/preview`, { body: { source: 'Slack', text: 'This should be live next week.' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.preview, true);
    assert.equal(r.data.signal, null);
    assert.equal(r.data.wouldApply, true);
    assert.equal(r.data.applied, false);
    assert.deepEqual(r.data.statusChange, { from: 'At Risk', to: 'Confirmed' });
    assert.equal(await Signal.countDocuments({ projectId: h.projectId }), n);
    assert.equal((await h.models('Requirement').findOne({ reqId: req.reqId })).liveStatus, 'At Risk');
  });

  it('any project member can post; a non-member cannot', async () => {
    const req = await h.addRequirement();
    h.ai.matchTo = req.reqId;
    const m = await post({ source: 'Standup', text: 'We should add a retry.' }, { token: h.member.token });
    assert.equal(m.status, 201);
    assert.equal(m.data.signal.author, 'QA Engineer');
    const o = await post({ source: 'Standup', text: 'x' }, { token: h.outsider.token });
    assert.equal(o.status, 403);
  });
});

describe('review, feedback and ledger', () => {
  let h;
  const post = (body, opts) => h.api('POST', `/projects/${h.projectId}/signals`, { body, ...opts });
  const review = (id, body, opts) => h.api('POST', `/projects/${h.projectId}/signals/${id}/review`, { body, ...opts });

  before(async () => { h = await start(); });
  after(async () => { await h.close(); });
  beforeEach(() => Object.assign(h.ai, { down: false, matchDown: false, label: 'Expectation', confidence: 0.95, similarity: 0.7, matchTo: null }));

  it('only a PM can review', async () => {
    const req = await h.addRequirement();
    h.ai.confidence = 0.5; h.ai.matchTo = req.reqId;
    const s = await post({ source: 'Slack', text: 'Maybe ready soon.' });
    const r = await review(s.data.signal.id, { action: 'accept' }, { token: h.member.token });
    assert.equal(r.status, 403);
  });

  it('accept applies the pending status change and writes feedback', async () => {
    const req = await h.addRequirement('Confirmed');
    h.ai.label = 'Constraint'; h.ai.confidence = 0.6; h.ai.matchTo = req.reqId;
    const s = await post({ source: 'Slack', text: 'The module must stay within budget.' });
    assert.equal(s.data.reviewStatus, 'pending');
    const r = await review(s.data.signal.id, { action: 'accept', note: 'looks right' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.statusChange, { from: 'Confirmed', to: 'Modified' });
    assert.equal(r.data.ledgerEntry.actor, h.pm.user.email);
    assert.equal(r.data.signal.reviewStatus, 'accepted');
    const fb = await h.models('Feedback').findOne({ projectId: h.projectId, signalId: s.data.signal.id });
    assert.equal(fb.action, 'accept');
    assert.equal(fb.finalLabel, 'Constraint');
    assert.equal(fb.modelLabel, 'Constraint');
    assert.equal(fb.modelVersion, 'test-v1');
    assert.equal(fb.modelConfidence, 60);
    assert.equal(fb.reviewerId, h.pm.user.email);
    const again = await review(s.data.signal.id, { action: 'accept' });
    assert.equal(again.status, 409);
  });

  it('reject has no status effect and stores finalLabel null', async () => {
    const req = await h.addRequirement('Confirmed');
    h.ai.label = 'Conflict'; h.ai.confidence = 0.6; h.ai.matchTo = req.reqId;
    const s = await post({ source: 'Slack', text: 'This is blocked by the vendor.' });
    const r = await review(s.data.signal.id, { action: 'reject' });
    assert.equal(r.data.signal.reviewStatus, 'rejected');
    assert.equal(r.data.statusChange, null);
    assert.equal((await h.models('Requirement').findOne({ reqId: req.reqId })).liveStatus, 'Confirmed');
    const fb = await h.models('Feedback').findOne({ projectId: h.projectId, signalId: s.data.signal.id });
    assert.equal(fb.finalLabel, null);
  });

  it('correct re-runs the status rule with the corrected label and requirement', async () => {
    const wrong = await h.addRequirement('Confirmed');
    const right = await h.addRequirement('At Risk');
    h.ai.label = 'Constraint'; h.ai.confidence = 0.6; h.ai.matchTo = wrong.reqId;
    const s = await post({ source: 'Slack', text: 'Pricing page is live for all users.' });
    const r = await review(s.data.signal.id, { action: 'correct', correctedLabel: 'Completion', correctedRequirementId: right.reqId });
    assert.deepEqual(r.data.statusChange, { from: 'At Risk', to: 'Confirmed' });
    assert.equal(r.data.signal.classification, 'Completion');
    assert.equal(r.data.signal.mappedRequirementId, right.reqId);
    assert.equal((await h.models('Requirement').findOne({ reqId: wrong.reqId })).liveStatus, 'Confirmed');
    const fb = await h.models('Feedback').findOne({ projectId: h.projectId, signalId: s.data.signal.id });
    assert.equal(fb.modelLabel, 'Constraint');
    assert.equal(fb.finalLabel, 'Completion');
    const bad = await review(s.data.signal.id, { action: 'correct' });
    assert.equal(bad.status, 400);
  });

  it('an unclassified signal can only be resolved by a correction', async () => {
    const req = await h.addRequirement('Confirmed');
    h.ai.down = true;
    const s = await post({ source: 'Slack', text: 'Reports must be exportable.' });
    assert.equal(s.status, 202);
    assert.equal((await review(s.data.signal.id, { action: 'accept' })).status, 422);
    const r = await review(s.data.signal.id, { action: 'correct', correctedLabel: 'Constraint', correctedRequirementId: req.reqId });
    assert.equal(r.status, 200);
    assert.equal(r.data.statusChange.to, 'Modified');
  });

  it('rejecting an AUTO-accepted signal is feedback only: statusNotReversed, nothing reversed', async () => {
    const req = await h.addRequirement('At Risk');
    h.ai.matchTo = req.reqId;
    const s = await post({ source: 'Slack', text: 'The export should be ready.' });
    assert.equal(s.data.applied, true);
    const before = await h.models('LedgerEntry').countDocuments({ projectId: h.projectId });
    const r = await review(s.data.signal.id, { action: 'reject' });
    assert.equal(r.status, 200);
    assert.equal(r.data.statusNotReversed, true);
    assert.match(r.data.message, /NOT reversed/);
    assert.equal(r.data.signal.reviewStatus, 'rejected');
    assert.equal(r.data.statusChange, null);
    assert.equal((await h.models('Requirement').findOne({ reqId: req.reqId })).liveStatus, 'Confirmed'); // still changed
    assert.equal(await h.models('LedgerEntry').countDocuments({ projectId: h.projectId }), before); // no ledger entry added or removed
    assert.equal((await review(s.data.signal.id, { action: 'reject' })).status, 409);
    assert.equal((await review((await post({ source: 'Slack', text: 'Another one.' })).data.signal.id, { action: 'accept' })).status, 409);
  });

  it('seeded signals: accept only updates reviewStatus (their effect is already in the data)', async () => {
    const req = await h.addRequirement('Modified');
    const Signal = h.models('Signal');
    await Signal.create({ projectId: h.projectId, signalId: 'SC-9001', source: 'Slack', authorRole: 'QA Engineer', timestamp: new Date(),
      text: 'Seeded pending signal', label: 'Expectation', reqId: req.reqId, seeded: true, split: 'train', reviewStatus: 'pending' });
    const ledgerBefore = await h.models('LedgerEntry').countDocuments({ projectId: h.projectId });
    const r = await review('SC-9001', { action: 'accept' });
    assert.equal(r.status, 200);
    assert.equal(r.data.statusChange, null);
    assert.equal(r.data.signal.reviewStatus, 'accepted');
    assert.equal((await h.models('Requirement').findOne({ reqId: req.reqId })).liveStatus, 'Modified');
    assert.equal(await h.models('LedgerEntry').countDocuments({ projectId: h.projectId }), ledgerBefore);
  });

  it('feedback export: PM only, accept/correct rows, text,label,source,role, de-duplicated, seeded rows excluded', async () => {
    const req = await h.addRequirement('Confirmed');
    h.ai.label = 'Constraint'; h.ai.confidence = 0.6; h.ai.matchTo = req.reqId;
    const text = 'Export feedback, with a comma and "quotes" must work.';
    const a = await post({ source: 'Email', text });
    await review(a.data.signal.id, { action: 'accept' });
    const b = await post({ source: 'Email', text }); // same text again -> only the latest decision is exported
    await review(b.data.signal.id, { action: 'correct', correctedLabel: 'Conflict' });
    const c = await post({ source: 'Slack', text: 'A rejected one.' });
    await review(c.data.signal.id, { action: 'reject' });
    const res = await h.api('GET', `/projects/${h.projectId}/feedback/export`);
    assert.equal(res.status, 200);
    const lines = res.text.trim().split('\n');
    assert.equal(lines[0], 'text,label,source,role');
    const mine = lines.filter((l) => l.includes('Export feedback'));
    assert.equal(mine.length, 1);
    assert.equal(mine[0], '"Export feedback, with a comma and ""quotes"" must work.",Conflict,Email,Project Manager');
    assert.ok(!res.text.includes('A rejected one.'));
    assert.ok(!res.text.includes('Seeded pending signal'));
    assert.equal((await h.api('GET', `/projects/${h.projectId}/feedback/export`, { token: h.member.token })).status, 403);
  });

  it('ledger verify: valid chain, and a tampered entry is detected at its block', async () => {
    const LedgerEntry = h.models('LedgerEntry');
    for (let i = 0; i < 3; i += 1) {
      const req = await h.addRequirement('At Risk');
      h.ai.matchTo = req.reqId; h.ai.label = 'Completion';
      await post({ source: 'Slack', text: `Item ${i} is complete and live.` });
    }
    const ok = await h.api('GET', `/projects/${h.projectId}/ledger/verify`);
    assert.equal(ok.data.valid, true);
    assert.ok(ok.data.entries >= 3);
    const victim = await LedgerEntry.findOne({ projectId: h.projectId, blockNumber: 2 });
    await LedgerEntry.updateOne({ _id: victim._id }, { $set: { newStatus: 'Dropped' } });
    const bad = await h.api('GET', `/projects/${h.projectId}/ledger/verify`);
    assert.equal(bad.data.valid, false);
    assert.equal(bad.data.brokenAt, 2);
  });
});
