'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { proposeStatus, hasDropPhrase, STATUS_BY_LABEL } = require('../../src/modules/signals/statusEngine');

test('status rule table', () => {
  assert.deepEqual(STATUS_BY_LABEL, { Expectation: 'Confirmed', Constraint: 'Modified', Conflict: 'At Risk', Completion: 'Confirmed' });
  const cases = [['Expectation', 'Confirmed'], ['Constraint', 'Modified'], ['Conflict', 'At Risk'], ['Completion', 'Confirmed']];
  for (const [label, to] of cases) {
    const r = proposeStatus({ label, text: 'plain text', currentStatus: to === 'Confirmed' ? 'At Risk' : 'Confirmed' });
    assert.equal(r.proposedStatus, to, label);
    assert.equal(r.changed, true, label);
    assert.equal(r.dropProposed, false, label);
  }
});

test('None (and unknown labels) never change a status', () => {
  for (const label of ['None', null, undefined, 'Whatever']) {
    const r = proposeStatus({ label, text: 'x', currentStatus: 'Modified' });
    assert.deepEqual(r, { proposedStatus: null, changed: false, dropProposed: false, terminal: false });
  }
});

test('the same status proposed again is not a change', () => {
  const r = proposeStatus({ label: 'Expectation', text: 'x', currentStatus: 'Confirmed' });
  assert.equal(r.proposedStatus, 'Confirmed');
  assert.equal(r.changed, false);
});

test('a Conflict with a drop phrase proposes Dropped', () => {
  for (const phrase of ['dropped', 'removed from scope', 'descoped', 'out of scope', 'postponed', 'cancelled', 'deferred', 'taken out']) {
    const r = proposeStatus({ label: 'Conflict', text: `The client says this is ${phrase} for now.`, currentStatus: 'Confirmed' });
    assert.equal(r.proposedStatus, 'Dropped', phrase);
    assert.equal(r.dropProposed, true, phrase);
  }
  assert.equal(proposeStatus({ label: 'Conflict', text: 'It was REMOVED  FROM SCOPE', currentStatus: 'Modified' }).proposedStatus, 'Dropped');
});

test('drop phrases only matter for Conflict, and only as whole phrases', () => {
  assert.equal(proposeStatus({ label: 'Constraint', text: 'this was postponed', currentStatus: 'Confirmed' }).proposedStatus, 'Modified');
  assert.equal(proposeStatus({ label: 'Expectation', text: 'out of scope', currentStatus: 'At Risk' }).proposedStatus, 'Confirmed');
  assert.equal(hasDropPhrase('unpostponed'), false);
  assert.equal(proposeStatus({ label: 'Conflict', text: 'blocked by the legacy system', currentStatus: 'Confirmed' }).proposedStatus, 'At Risk');
});

test('Dropped is terminal: nothing changes it, and it is not "proposing a drop" again', () => {
  for (const label of ['Expectation', 'Constraint', 'Conflict', 'Completion']) {
    const r = proposeStatus({ label, text: 'removed from scope', currentStatus: 'Dropped' });
    assert.deepEqual(r, { proposedStatus: 'Dropped', changed: false, dropProposed: false, terminal: true }, label);
  }
});
