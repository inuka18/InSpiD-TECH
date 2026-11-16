'use strict';
// Pure status rules (no database). See DATA_README.md "Status rules".
//   Expectation -> Confirmed, Constraint -> Modified, Conflict -> At Risk, Completion -> Confirmed, None -> no change.
//   A Conflict whose text contains a drop phrase proposes Dropped instead.
//   Dropped is terminal: later signals never change a Dropped requirement.

const STATUS_BY_LABEL = Object.freeze({
  Expectation: 'Confirmed',
  Constraint: 'Modified',
  Conflict: 'At Risk',
  Completion: 'Confirmed',
});

const DROP_PHRASES = Object.freeze([
  'dropped', 'removed from scope', 'descoped', 'out of scope', 'postponed', 'cancelled', 'deferred', 'taken out',
]);
const DROP_RE = new RegExp('\\b(?:' + DROP_PHRASES.map((p) => p.replace(/ /g, '\\s+')).join('|') + ')\\b', 'i');

const hasDropPhrase = (text) => DROP_RE.test(String(text || ''));

/**
 * @returns {{ proposedStatus: string|null, changed: boolean, dropProposed: boolean, terminal: boolean }}
 *  proposedStatus null = this label never changes a status (None / unknown).
 *  dropProposed = this signal would move the requirement INTO Dropped (false when it is already Dropped).
 */
function proposeStatus({ label, text, currentStatus }) {
  if (!STATUS_BY_LABEL[label]) return { proposedStatus: null, changed: false, dropProposed: false, terminal: false };
  if (currentStatus === 'Dropped') return { proposedStatus: 'Dropped', changed: false, dropProposed: false, terminal: true };
  const proposedStatus = label === 'Conflict' && hasDropPhrase(text) ? 'Dropped' : STATUS_BY_LABEL[label];
  return { proposedStatus, changed: proposedStatus !== currentStatus, dropProposed: proposedStatus === 'Dropped', terminal: false };
}

module.exports = { proposeStatus, hasDropPhrase, STATUS_BY_LABEL, DROP_PHRASES };
