'use strict';
// Pure review policy: does a classified signal change anything on its own, or wait for a PM?

// Model probability (0-1) -> integer 0-100.
const toConfidencePct = (p) => Math.max(0, Math.min(100, Math.round(Number(p) * 100)));

/**
 * Auto-accept only when ALL hold: confidence >= threshold, label is not None, a requirement was matched (and, when it
 * was matched by similarity rather than given explicitly, similarity >= autoApplyMinSimilarity), and the proposed
 * status is not a move into Dropped. A "None" signal has nothing to apply, so it is accepted
 * (as "no effect") when confidence >= threshold; a low-confidence None stays pending for a PM.
 * A possible new requirement (signals/newRequirement.js) is always pending, reason 'new-requirement'.
 * Everything else is pending and changes nothing until a PM accepts it.
 * @returns {{ reviewStatus: 'accepted'|'pending', autoAccepted: boolean, reason: string }}
 */
function decideReview({ label, confidence, matched, dropProposed, threshold, matchMethod, similarity, autoApplyMinSimilarity, newRequirement = false }) {
  const accepted = (reason) => ({ reviewStatus: 'accepted', autoAccepted: true, reason });
  const pending = (reason) => ({ reviewStatus: 'pending', autoAccepted: false, reason });
  if (!label) return pending('unclassified');
  // A possible NEW requirement is never auto-accepted and never changes anything until a PM acts on its candidate.
  if (newRequirement) return pending('new-requirement');
  const confident = confidence >= threshold;
  if (label === 'None') return confident ? accepted('none-confident') : pending('low-confidence');
  if (!confident) return pending('low-confidence');
  if (!matched) return pending('unmapped');
  // An explicit requirementId (method 'manual') is exempt: a person chose the requirement.
  if (matchMethod === 'auto' && autoApplyMinSimilarity != null && !(similarity >= autoApplyMinSimilarity)) return pending('low-similarity');
  if (dropProposed) return pending('proposes-drop');
  return accepted('confident-and-mapped');
}

module.exports = { decideReview, toConfidencePct };
