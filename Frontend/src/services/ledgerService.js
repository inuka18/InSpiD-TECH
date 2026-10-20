import { getLedgerEntriesForRequirement } from "../data/mockLedger";
import { mockCrossValidation, getCrossValidationById } from "../data/mockCrossValidation";
import { getActionById } from "../data/mockActions";
import { delay } from "./simulatedLatency";
import { api } from "../lib/apiClient";

// Ledger entries come from the API (/projects/:projectId/ledger). It is a LOCAL hash chain in the database
// (onChain: false), not a blockchain. Entry shape: { txHash, eventType (display string), eventCode, requirementId,
// requirementTitle, relatedRequirementId, previousStatus, newStatus, triggeringSignal, triggeringSignalId, actor, timestamp,
// blockNumber, previousBlockHash, onChain, details (NETWORK_UPDATE only: { added: [...], removed: [...] }) }
export async function fetchLedgerEntries(projectId) {
  let entries;
  if (projectId) {
    entries = await api(`/projects/${encodeURIComponent(projectId)}/ledger`);
  } else {
    const projects = await api("/projects");
    entries = (await Promise.all(projects.map((p) => api(`/projects/${encodeURIComponent(p.id)}/ledger`)))).flat();
  }
  // Newest block first.
  return [...entries].sort((x, y) => (x.projectId === y.projectId ? y.blockNumber - x.blockNumber : new Date(y.timestamp) - new Date(x.timestamp)));
}

// With a projectId this uses the API; without one (the Retrospectives evidence lookup) it still uses the mock data.
export async function fetchLedgerEntriesForRequirement(requirementId, projectId) {
  if (projectId) {
    return api(`/projects/${encodeURIComponent(projectId)}/ledger/requirements/${encodeURIComponent(requirementId)}`);
  }
  await delay(250);
  return getLedgerEntriesForRequirement(requirementId);
}

// Recomputes the hash chain on the server: { valid, entries, brokenAt, reason }.
export async function verifyLedger(projectId) {
  return api(`/projects/${encodeURIComponent(projectId)}/ledger/verify`);
}

// The Evidence Ledger's lookup panel takes a requirement ID, an action ID,
// or a delay-log ID, but the ledger itself (mockLedger.js) only keys off
// requirementId. Action IDs and delay-log IDs aren't ledger keys, they're
// pointers into mockCrossValidation, which is where linkedRequirementId
// actually lives (see mockCrossValidation.js's header comment). This is
// the one place that three-way resolution happens, kept synchronous and
// exported on its own so a caller that already knows it has an action ID
// (e.g. the Claim Comparison for one evidence row) can resolve without a
// fake network round trip.
export function resolveLedgerQuery(query) {
  const q = (query ?? "").trim();
  if (!q) return null;

  if (/^req-/i.test(q)) {
    return { query: q, via: "requirement", requirementId: q.toUpperCase(), cv: null, action: null };
  }

  if (/^action-/i.test(q)) {
    const action = getActionById(q);
    if (!action) return { query: q, via: "action", requirementId: null, cv: null, action: null };
    const cv = getCrossValidationById(action.reconciledCauseId);
    return { query: q, via: "action", requirementId: cv?.linkedRequirementId ?? null, cv, action };
  }

  // Delay-log ID: find the cross-validation entry that cites it as its
  // delayLogId (the same field the Cross-Validation tab reads).
  const cv = mockCrossValidation.find((entry) => entry.delayLogId === q);
  if (cv) return { query: q, via: "delay-log", requirementId: cv.linkedRequirementId, cv, action: null };

  return { query: q, via: "unknown", requirementId: null, cv: null, action: null };
}

// Async wrapper for the lookup panel's search box, same simulated-latency
// shape as every other service call in this app.
export async function fetchLedgerLookup(query) {
  await delay(350);
  const resolved = resolveLedgerQuery(query);
  const entries = resolved?.requirementId ? getLedgerEntriesForRequirement(resolved.requirementId) : [];
  return { resolved, entries };
}
