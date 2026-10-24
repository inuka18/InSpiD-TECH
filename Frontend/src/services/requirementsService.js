// Data-access layer for requirements, backed by the real API (/projects/:projectId/requirements).
// Every consumer (hooks, components) talks to this module. API shape per requirement:
// { id, projectId, title, description, liveStatus, resourceRole, granularity, cluster, clusterLabel, type,
//   relatedIds, statusHistory: [{ status, timestamp, signal, signalId }] }
import { api } from "../lib/apiClient";
import { clusterColor } from "../lib/clusters";

// reqId -> projectId, learned from lists, so fetchRequirementById(id) keeps its one-argument form.
const projectOf = new Map();
const remember = (list) => {
  list.forEach((r) => projectOf.set(r.id, r.projectId));
  return list;
};

async function allProjectIds() {
  return (await api("/projects")).map((p) => p.id);
}

export async function fetchRequirements(projectId) {
  if (projectId) return remember(await api(`/projects/${encodeURIComponent(projectId)}/requirements`));
  const lists = await Promise.all((await allProjectIds()).map((id) => api(`/projects/${encodeURIComponent(id)}/requirements`)));
  return remember(lists.flat());
}

export async function fetchRequirementById(id, projectId) {
  const pid = projectId ?? projectOf.get(id);
  if (!pid) throw new Error(`Requirement ${id}: open it from a project so its project is known.`);
  return api(`/projects/${encodeURIComponent(pid)}/requirements/${encodeURIComponent(id)}`);
}

// The computed clusters of a project, with a colour for each.
export async function fetchClusters(projectId) {
  if (!projectId) return [];
  const list = await api(`/projects/${encodeURIComponent(projectId)}/requirements/clusters`);
  return list.map((c) => ({ ...c, color: clusterColor(c.id) }));
}

// Resource roles that actually occur on this project's requirements.
export async function fetchResourceRoles(projectId) {
  const reqs = await fetchRequirements(projectId);
  return [...new Set(reqs.map((r) => r.resourceRole).filter(Boolean))].sort();
}

// ---- SRS import (PM only). The preview saves nothing; the confirm creates the requirements, builds the network and the Initial baseline.
// previewSrs -> { documentName, documentId, method: "template" | "heuristic", methodNote, warnings, existingRequirements, duplicates,
//   candidates: [{ sourceId, title, description, type: "FR" | "NFR", featureArea, priority, verification, confidence: null | "medium" | "low",
//                  warnings, placeholders, duplicateOf, selected }] }
export async function previewSrs(projectId, file) {
  const form = new FormData();
  form.append("file", file, file.name);
  return api(`/projects/${encodeURIComponent(projectId)}/requirements/import-srs/preview`, { method: "POST", body: form });
}

// body: { documentId, documentName, items: [{ sourceId, title, description, type, featureArea, priority }], force? }
// -> { created, skipped, failed, ids, firstError, skippedItems, network: { updated, links, clusters } | { updated: false, message }, baselineCreated, alreadyImported? }
export async function confirmSrsImport(projectId, body) {
  return api(`/projects/${encodeURIComponent(projectId)}/requirements/import-srs/confirm`, { method: "POST", body });
}
