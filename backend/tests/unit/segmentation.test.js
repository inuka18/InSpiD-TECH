'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { segmentDocument, SegmentLimitError } = require('../../src/modules/signals/segmentation');

const texts = (doc, opts) => segmentDocument(doc, opts).map((s) => s.text);

test('email headers, greetings and sign-offs (with the signature block) are ignored', () => {
  const doc = [
    'From: Sam Perera <sam@example.com>',
    'To: team@example.com',
    'Cc: pm@example.com',
    'Subject: Checkout status and open questions',
    'Date: Mon, 3 Aug 2026 09:00',
    '',
    'Hi team,',
    '',
    'The checkout redesign went live this morning and customers are using it.',
    '',
    'Thanks,',
    'Sam Perera | Product Manager | Retail Co',
    '',
    'Another paragraph after the signature that should be kept as a statement.',
  ].join('\n');
  assert.deepEqual(texts(doc), [
    'The checkout redesign went live this morning and customers are using it.',
    'Another paragraph after the signature that should be kept as a statement.',
  ]);
});

test('quoted replies and original-message separators are ignored', () => {
  const doc = '> The delivery slots are blocked by the courier integration, we need a decision.\n-----Original Message-----\nWe still need the refund rules confirmed by finance this week.';
  assert.deepEqual(texts(doc), ['We still need the refund rules confirmed by finance this week.']);
});

test('a leading speaker prefix is removed from the text and kept as speakerLabel', () => {
  const segs = segmentDocument('Developer: The wishlist API is complete and merged into main.\nSam Perera: We must keep card data out of our own database.');
  assert.equal(segs[0].text, 'The wishlist API is complete and merged into main.');
  assert.equal(segs[0].speakerLabel, 'Developer');
  assert.equal(segs[1].text, 'We must keep card data out of our own database.');
  assert.equal(segs[1].speakerLabel, 'Sam Perera');
});

test('labels that belong to the sentence, and URLs, are not treated as speakers', () => {
  const segs = segmentDocument('Blocker: the rates vendor has not delivered the tax tables yet.\nSee http://example.com/spec for the full payment requirements document.');
  assert.equal(segs[0].speakerLabel, null);
  assert.equal(segs[0].text, 'Blocker: the rates vendor has not delivered the tax tables yet.');
  assert.equal(segs[1].speakerLabel, null);
});

test('list markers, numbering, checkboxes and markdown marks are stripped', () => {
  const doc = [
    '- The gift card feature is blocked by the legal review.',
    '* Search response time must stay under two seconds.',
    '• Order tracking page is complete and live for customers.',
    '1. Finance wants approval before any refund is issued.',
    '2) Mobile pages should load in under three seconds.',
    '[ ] Confirm the delivery slot rules with the client team.',
    '[x] Deploy the discount code fix to production today.',
    '## **Retailer feedback** on the sale event uptime target',
  ].join('\n');
  const t = texts(doc);
  assert.equal(t.length, 8);
  assert.equal(t[0], 'The gift card feature is blocked by the legal review.');
  assert.equal(t[3], 'Finance wants approval before any refund is issued.');
  assert.equal(t[4], 'Mobile pages should load in under three seconds.');
  assert.equal(t[6], 'Deploy the discount code fix to production today.');
  assert.equal(t[7], 'Retailer feedback on the sale event uptime target');
});

test('a leading time stamp is removed', () => {
  const segs = segmentDocument('[09:12] QA Engineer: The refund flow fails when the order has two items.\n10:35 - The regional tax calculation is blocked by the vendor.');
  assert.equal(segs[0].text, 'The refund flow fails when the order has two items.');
  assert.equal(segs[0].speakerLabel, 'QA Engineer');
  assert.equal(segs[1].text, 'The regional tax calculation is blocked by the vendor.');
});

test('short lines, empty lines and lead-ins ending in a colon are dropped', () => {
  const doc = 'Action items:\n\nDone.\nOK thanks everyone\nThis one is long enough to count as a statement.\nWhat went well in this sprint:';
  assert.deepEqual(texts(doc), ['This one is long enough to count as a statement.']);
  assert.deepEqual(texts('Twenty-four characters!!', { minLength: 25 }), []);
  assert.deepEqual(texts('Exactly twenty-five chars.', { minLength: 25 }).length, 1);
});

test('a long paragraph is split into sentences, but common abbreviations do not split', () => {
  const long = 'The checkout must support cards and wallets, e.g. local wallets used in the region. ' +
    'Payments should be confirmed within two seconds of the customer pressing pay. ' +
    'Dr. Silva from the finance team asked for a daily reconciliation report of every payment taken. ' +
    'The warehouse team reported that stock reservation fails during sale events when traffic doubles.';
  assert.ok(long.length > 200);
  const t = texts(long);
  assert.equal(t.length, 4);
  assert.ok(t[0].includes('e.g. local wallets'));
  assert.ok(t[2].startsWith('Dr. Silva'));
});

test('a short line with several sentences stays one segment', () => {
  assert.equal(segmentDocument('Delivery slots are done. Refunds are still blocked by finance.').length, 1);
});

test('hard-wrapped lines of one paragraph are joined; a new bullet or sentence starts a new segment', () => {
  const doc = 'The client asked that the seller onboarding flow must be approved by the\noperations team before any seller is verified and shown on the site.\nA second statement starts here and is long enough to be kept.';
  const segs = segmentDocument(doc);
  assert.equal(segs.length, 2);
  assert.ok(segs[0].text.endsWith('shown on the site.'));
  assert.equal(segs[0].line, 1);
  assert.equal(segs[1].line, 3);
});

test('duplicates are removed (case and whitespace insensitive), keeping the first, with order and original line numbers', () => {
  const doc = 'The gift card rollout is blocked by legal review.\n\nSomething else that is long enough to be kept as a segment.\nthe gift card  rollout is blocked by legal review.';
  const segs = segmentDocument(doc);
  assert.deepEqual(segs.map((s) => [s.index, s.line]), [[0, 1], [1, 3]]);
});

test('more than the maximum number of segments is rejected with a SegmentLimitError', () => {
  const doc = Array.from({ length: 12 }, (_, i) => `Statement number ${i} about the checkout flow is long enough.`).join('\n');
  assert.equal(segmentDocument(doc, { maxSegments: 12 }).length, 12);
  assert.throws(() => segmentDocument(doc, { maxSegments: 11 }), (e) => e instanceof SegmentLimitError && e.count === 12 && /limit is 11/.test(e.message) && /Split the document/.test(e.message));
});

test('windows line endings, a BOM and empty input are handled', () => {
  assert.deepEqual(texts('﻿The order history page should list every past order.\r\nA second long enough statement for the test.\r\n'), [
    'The order history page should list every past order.', 'A second long enough statement for the test.']);
  assert.deepEqual(segmentDocument(''), []);
  assert.deepEqual(segmentDocument(null), []);
});
