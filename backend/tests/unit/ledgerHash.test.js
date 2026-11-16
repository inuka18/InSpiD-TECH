'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTxHash, GENESIS_HASH } = require('../../src/modules/ledger/service');

const entry = {
  projectId: 'SYS-X', eventType: 'STATUS_CHANGE', reqId: 'R1', previousStatus: 'Confirmed', newStatus: 'At Risk',
  triggeringSignal: 'text', triggeringSignalId: 'SC-1', actor: 'auto-accept', timestamp: new Date('2026-01-01T00:00:00Z'), blockNumber: 1,
};

test('txHash is deterministic and covers previousBlockHash and the contents', () => {
  const h = computeTxHash(entry, GENESIS_HASH);
  assert.match(h, /^0x[0-9a-f]{64}$/);
  assert.equal(h, computeTxHash({ ...entry }, GENESIS_HASH));
  assert.notEqual(h, computeTxHash(entry, '0x' + '1'.repeat(64)));
  assert.notEqual(h, computeTxHash({ ...entry, newStatus: 'Confirmed' }, GENESIS_HASH));
  assert.notEqual(h, computeTxHash({ ...entry, blockNumber: 2 }, GENESIS_HASH));
});

test('legacy display event types hash the same as the codes', () => {
  assert.equal(computeTxHash({ ...entry, eventType: 'Status Change' }, GENESIS_HASH), computeTxHash(entry, GENESIS_HASH));
});
