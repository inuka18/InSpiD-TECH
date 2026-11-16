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

// PM-only: DetectRequirementsDialog's confirm step. One POST /requirements per approved item (sequentially, so the
// network recomputation on the server never overlaps). The backend writes the "Requirement Created" and
// network-update ledger entries itself. The detected `cluster` is NOT sent: the backend would store it as the
// CSV group_id, and clusters are computed from the texts instead.
export async function createRequirementsFromSRS({ projectId, items }) {
  const created = [];
  for (const item of items) {
    const body = {
      title: item.title,
      description: item.description,
      type: item.category === "Non-Functional" ? "NFR" : "FR",
      granularity: "Sprint Commitment",
    };
    if (item.resourceRole && item.resourceRole !== "Unassigned") body.resourceRole = item.resourceRole;
    created.push(await api(`/projects/${encodeURIComponent(projectId)}/requirements`, { method: "POST", body }));
  }
  return created;
}
