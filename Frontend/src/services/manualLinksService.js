// PM-authored links, from the API (/projects/:projectId/network/manual-links). The backend writes the ledger entry
// for every add/remove itself. The API returns { id, projectId, source, target, kind, reason, createdBy, createdAt };
// the UI uses sourceId / targetId, so they are mapped here.
import { api } from "../lib/apiClient";

const toLink = (l) => ({
  id: l.id,
  projectId: l.projectId,
  sourceId: l.source,
  targetId: l.target,
  reason: l.reason,
  createdBy: l.createdBy,
  createdAt: l.createdAt,
});

const base = (projectId) => `/projects/${encodeURIComponent(projectId)}/network/manual-links`;

export async function fetchManualLinks(projectId) {
  if (!projectId) return [];
  return (await api(base(projectId))).map(toLink);
}

// PM only. (`createdBy` is taken from the login on the server.)
export async function createManualLink({ projectId, sourceId, targetId, reason }) {
  return toLink(await api(base(projectId), { method: "POST", body: { sourceId, targetId, reason } }));
}

// PM only. Resolves with the removed link.
export async function deleteManualLink(link) {
  await api(`${base(link.projectId)}/${encodeURIComponent(link.id)}`, { method: "DELETE" });
  return link;
}
