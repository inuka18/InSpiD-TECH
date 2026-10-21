'use strict';
// THE one place where a signal's effect is finalised. Preview, create, bulk and review all go through
// finalizeSignal(), so a later feature (notifications, a real blockchain, analytics...) can hook in here once.
//
// What "finalising" covers, in this order:
//   1. the status effect: conditional requirement update -> status_history row -> ledger entry
//      (dryRun: only PROJECTS the change, nothing is written)
//   2. the signal document's `applied` / `resultingStatus` / `proposedStatus`
//   3. the network: an applied, non-seeded signal gives evidence and updates the signal profile, and the requirement
//      network is refreshed (network/service.js onSignalApplied; one NETWORK_UPDATE ledger entry only if a link changed)
//   4. the feedback document (PM review actions), when `feedback` is given
//
// No multi-document transactions on standalone Mongo, so the order matters: the conditional update (liveStatus must
// still be `from`) stops two concurrent signals from both applying, and feedback is only written after the effect.
const AppError = require('../../shared/AppError');
const ledger = require('../ledger/service');
const { Requirement, StatusHistory } = require('../requirements/model');
const { Signal, Feedback } = require('./model');
const { proposeStatus } = require('./statusEngine');
const { createWithSeqId } = require('./ids');
const network = require('../network/service');

async function applyToRequirement({ projectId, reqId, signal, label, actor }) {
  const current = await Requirement.findOne({ projectId, reqId }).lean();
  if (!current) throw new AppError(404, 'NOT_FOUND', `Requirement ${reqId} not found in this project`);
  const eng = proposeStatus({ label, text: signal.text, currentStatus: current.liveStatus });
  const from = current.liveStatus;
  const to = eng.proposedStatus ?? from;
  if (eng.changed) {
    const updated = await Requirement.findOneAndUpdate({ projectId, reqId, liveStatus: from }, { $set: { liveStatus: to } }, { new: true }).lean();
    if (!updated) throw new AppError(409, 'CONCURRENT_UPDATE', `Requirement ${reqId} changed status while this signal was processed`);
  }
  await createWithSeqId(StatusHistory, 'historyId', 'SH-', (historyId) => ({
    projectId, historyId, reqId, signalId: signal.signalId, timestamp: signal.timestamp, label, fromStatus: from, toStatus: to,
    statusChanged: eng.changed, source: signal.source, authorRole: signal.authorRole,
    resourceRole: signal.authorRole, granularity: current.granularity,
  }));
  let ledgerEntry = null;
  if (eng.changed) {
    ledgerEntry = await ledger.appendLedgerEntry({
      projectId, eventType: 'STATUS_CHANGE', reqId, requirementTitle: current.title, previousStatus: from, newStatus: to,
      triggeringSignal: signal.text, triggeringSignalId: signal.signalId, actor,
    });
  }
  return { statusChange: eng.changed ? { from, to } : null, ledgerEntry, proposedStatus: eng.proposedStatus, resultingStatus: to };
}

// What the status rule WOULD do, without writing anything (used by preview).
async function projectEffect({ projectId, reqId, signal, label }) {
  const current = await Requirement.findOne({ projectId, reqId }).lean();
  if (!current) throw new AppError(404, 'NOT_FOUND', `Requirement ${reqId} not found in this project`);
  const eng = proposeStatus({ label, text: signal.text, currentStatus: current.liveStatus });
  return {
    statusChange: eng.changed ? { from: current.liveStatus, to: eng.proposedStatus } : null,
    ledgerEntry: null,
    proposedStatus: eng.proposedStatus,
    resultingStatus: eng.proposedStatus ?? current.liveStatus,
  };
}

/**
 * @param {object}  p
 * @param {string}  p.projectId
 * @param {object}  p.signal       { text, signalId?, timestamp?, source?, authorRole?, _id? } (a saved signal, or just { text } for a preview)
 * @param {string}  p.label        the label the effect is based on (Constraint | Expectation | Completion | Conflict | None | null)
 * @param {string}  p.requirementId  requirement the effect applies to (null = no effect)
 * @param {string}  p.actor        who the ledger entry is attributed to ("auto-accept" or a user's email)
 * @param {boolean} p.dryRun       preview: project the effect, write nothing
 * @param {object}  p.feedback     feedback document to store after the effect (PM review actions); ignored on dryRun
 * @returns {Promise<{ applied: boolean, statusChange, ledgerEntry, proposedStatus, resultingStatus, feedbackSaved: boolean }>}
 */
async function finalizeSignal({ projectId, signal, label, requirementId, actor, dryRun = false, feedback = null }) {
  const out = { applied: false, statusChange: null, ledgerEntry: null, proposedStatus: null, resultingStatus: null, feedbackSaved: false };

  if (label && label !== 'None' && requirementId) {
    if (dryRun) {
      Object.assign(out, await projectEffect({ projectId, reqId: requirementId, signal, label }));
    } else {
      Object.assign(out, await applyToRequirement({ projectId, reqId: requirementId, signal, label, actor }));
      out.applied = true;
      if (signal._id) {
        await Signal.updateOne({ _id: signal._id }, { $set: { applied: true, resultingStatus: out.resultingStatus, proposedStatus: out.proposedStatus } });
      }
      // Never fails the signal (onSignalApplied catches everything); seeded signals are skipped inside.
      await network.onSignalApplied({ projectId, signal, requirementId, actor });
    }
  }

  if (feedback && !dryRun) {
    await Feedback.create(feedback);
    out.feedbackSaved = true;
  }
  return out;
}

module.exports = { finalizeSignal };
