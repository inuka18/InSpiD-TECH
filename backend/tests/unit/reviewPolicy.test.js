'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideReview, toConfidencePct } = require('../../src/modules/signals/reviewPolicy');

const base = { label: 'Expectation', confidence: 95, matched: true, dropProposed: false, threshold: 90 };

test('confidence is converted to an integer 0-100', () => {
  assert.equal(toConfidencePct(0.9), 90);
  assert.equal(toConfidencePct(0.894), 89);
  assert.equal(toConfidencePct(0.895), 90);
  assert.equal(toConfidencePct(1.4), 100);
  assert.equal(toConfidencePct(-1), 0);
});

test('auto-accepts when every condition holds, at exactly the threshold', () => {
  assert.equal(decideReview({ ...base, confidence: 90 }).reviewStatus, 'accepted');
  assert.equal(decideReview({ ...base, confidence: 100 }).autoAccepted, true);
});

test('89 is below the default threshold of 90 -> pending', () => {
  const r = decideReview({ ...base, confidence: 89 });
  assert.equal(r.reviewStatus, 'pending');
  assert.equal(r.reason, 'low-confidence');
});

test('the threshold is a parameter', () => {
  assert.equal(decideReview({ ...base, confidence: 70, threshold: 70 }).reviewStatus, 'accepted');
  assert.equal(decideReview({ ...base, confidence: 70, threshold: 71 }).reviewStatus, 'pending');
});

test('unmapped, or a proposed drop, always waits for a PM', () => {
  assert.equal(decideReview({ ...base, matched: false }).reason, 'unmapped');
  assert.equal(decideReview({ ...base, dropProposed: true }).reason, 'proposes-drop');
  assert.equal(decideReview({ ...base, dropProposed: true }).reviewStatus, 'pending');
});

test('None: auto-accepted (nothing to apply) only when confident', () => {
  assert.equal(decideReview({ label: 'None', confidence: 92, matched: false, dropProposed: false, threshold: 90 }).reviewStatus, 'accepted');
  assert.equal(decideReview({ label: 'None', confidence: 60, matched: false, dropProposed: false, threshold: 90 }).reviewStatus, 'pending');
});

test('an unclassified signal (AI down) is pending', () => {
  const r = decideReview({ label: null, threshold: 90 });
  assert.equal(r.reviewStatus, 'pending');
  assert.equal(r.reason, 'unclassified');
});

test('AUTO_APPLY_MIN_SIMILARITY: a similarity-matched signal below the floor stays pending', () => {
  const auto = { ...base, matchMethod: 'auto', autoApplyMinSimilarity: 0.4 };
  assert.equal(decideReview({ ...auto, similarity: 0.4 }).reviewStatus, 'accepted'); // exactly at the floor
  const low = decideReview({ ...auto, similarity: 0.399 });
  assert.equal(low.reviewStatus, 'pending');
  assert.equal(low.reason, 'low-similarity');
  assert.equal(decideReview({ ...auto, similarity: 0.7 }).reviewStatus, 'accepted');
});

test('an explicit requirementId (manual match) ignores the similarity floor', () => {
  const r = decideReview({ ...base, matchMethod: 'manual', similarity: null, autoApplyMinSimilarity: 0.4 });
  assert.equal(r.reviewStatus, 'accepted');
});

test('the similarity floor does not hide other reasons, and does not apply to None', () => {
  assert.equal(decideReview({ ...base, matchMethod: 'auto', similarity: 0.1, autoApplyMinSimilarity: 0.4, confidence: 50 }).reason, 'low-confidence');
  assert.equal(decideReview({ label: 'None', confidence: 95, matched: false, threshold: 90, matchMethod: 'auto', similarity: 0, autoApplyMinSimilarity: 0.4 }).reviewStatus, 'accepted');
});
