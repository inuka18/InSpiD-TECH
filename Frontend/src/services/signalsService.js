// Signals from the real API (/projects/:projectId/signals).
// Feed row shape (already what the UI expects): { id, projectId, reviewStatus, source, channel, author, timestamp, text,
//   classification (null = never classified), confidence (0-100, null for seeded rows), mappedRequirementId, seeded,
//   modelVersion, autoAcceptThreshold, matchSimilarity, proposedStatus, applied, reviewAction, statusNotReversed }
import { api } from "../lib/apiClient";

const base = (projectId) => `/projects/${encodeURIComponent(projectId)}/signals`;

export async function fetchSignals(projectId) {
  let signals;
  if (projectId) {
    signals = await api(base(projectId));
  } else {
    const projects = await api("/projects");
    signals = (await Promise.all(projects.map((p) => api(base(p.id))))).flat();
  }
  // Newest first, like a real live feed.
  return [...signals].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// body: { source, text, authorRole? , requirementId? }. Empty values are left out so the backend defaults apply.
const clean = (body) => Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== ""));

// Same answer as submitSignal, but nothing is saved or applied.
export async function previewSignal(projectId, body) {
  return api(`${base(projectId)}/preview`, { method: "POST", body: clean(body) });
}

// Classifies, maps to a requirement and (if safe) applies the status change and writes the ledger entry.
// Resolves with the API answer; `degraded: true` means the AI service was unavailable (HTTP 202).
export async function submitSignal(projectId, body) {
  return api(base(projectId), { method: "POST", body: clean(body) });
}

// PM only. action: "accept" | "reject" | "correct" (+ correctedLabel / correctedRequirementId / note).
export async function reviewSignal(projectId, signalId, body) {
  return api(`${base(projectId)}/${encodeURIComponent(signalId)}/review`, { method: "POST", body: clean(body) });
}
