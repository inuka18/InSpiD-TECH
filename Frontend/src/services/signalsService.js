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

// ---- documents (meeting notes, standup notes, an email, retrospective notes)

// Finds the signals in a document and saves NOTHING. Give a file (txt, md, docx, pdf) or pasted text.
// -> { documentId, name, source, alreadySubmitted, counts: { total, signals, none }, modelVersion,
//      autoAcceptThreshold, matchMinSimilarity, autoApplyMinSimilarity,
//      segments: [{ index, line, text, speakerLabel, label, confidence, match: { requirementId, similarity, alternatives } | null,
//                   proposedStatus, wouldAutoApply, reviewReason }] }
export async function extractSignals(projectId, { file, text, name, source, authorRole, documentDate }) {
  const path = `${base(projectId)}/extract`;
  if (file) {
    const form = new FormData();
    form.append("file", file, file.name);
    if (source) form.append("source", source);
    if (authorRole?.trim()) form.append("authorRole", authorRole.trim());
    if (documentDate) form.append("documentDate", documentDate);
    return api(path, { method: "POST", body: form });
  }
  return api(path, { method: "POST", body: clean({ text, name, source, authorRole, documentDate }) });
}

// Saves the approved items through the normal signal flow.
// body: { documentId, name, source, authorRole?, timestamp?, items: [{ text, requirementId? }], force? }
// -> { documentId, name, summary: { applied, pending, noChange, failed }, results: [{ index, text, status, signalId, ..., error? }] }
export async function bulkSubmitSignals(projectId, body) {
  return api(`${base(projectId)}/bulk`, { method: "POST", body });
}
