'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diffLinks, linkKey } = require('../../src/modules/network/diff');

const L = (reqA, reqB, weight) => ({ reqA, reqB, weight });

test('link ids are canonical regardless of the order of the pair', () => {
  assert.equal(linkKey('R2', 'R1'), 'R1~R2~semantic');
  assert.equal(linkKey('R1', 'R2'), 'R1~R2~semantic');
});

test('diff finds added and removed links and ignores the order of a pair', () => {
  const stored = [L('R1', 'R2', 0.8), L('R2', 'R3', 0.7), L('R3', 'R4', 0.6)];
  const computed = [L('R2', 'R1', 0.8), L('R3', 'R2', 0.7), L('R4', 'R5', 0.5)];
  const d = diffLinks(stored, computed);
  assert.deepEqual(d.added.map((l) => l.id), ['R4~R5~semantic']);
  assert.deepEqual(d.removed.map((l) => l.id), ['R3~R4~semantic']);
  assert.deepEqual(d.kept.map((l) => l.id), ['R1~R2~semantic', 'R2~R3~semantic']);
  assert.equal(d.reweighted.length, 0);
});

test('nothing changed -> nothing added or removed', () => {
  const same = [L('R1', 'R2', 0.8), L('R1', 'R3', 0.5)];
  const d = diffLinks(same, [...same].reverse());
  assert.equal(d.added.length + d.removed.length + d.reweighted.length, 0);
});

test('a changed weight on a kept link is reported separately (not as added/removed)', () => {
  const d = diffLinks([L('R1', 'R2', 0.8)], [L('R1', 'R2', 0.75)]);
  assert.equal(d.added.length + d.removed.length, 0);
  assert.deepEqual(d.reweighted.map((l) => l.id), ['R1~R2~semantic']);
  assert.equal(diffLinks([L('R1', 'R2', 0.8)], [L('R1', 'R2', 0.8000001)]).reweighted.length, 0); // below tolerance
});
