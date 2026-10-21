// The requirements network from the API: GET /projects/:projectId/network.
// { projectId, nodes: [{ id, title, liveStatus, cluster, clusterLabel, type, resourceRole }],
//   links: [{ id, source, target, kind: "pathfinder" | "manual", relationType, weight? (combined similarity), evidenceCount?, contributions? { text, profile, boost }, reason? }],
//   clusters: [{ id, label, size }], warning? }
// The backend computes it on first request (it embeds the requirement texts), so the first call can take a few seconds.
import { api } from "../lib/apiClient";

export async function fetchNetwork(projectId) {
  const net = await api(`/projects/${encodeURIComponent(projectId)}/network`);
  return {
    projectId: net.projectId,
    // Same fields the requirement rows have, so the map can reuse the requirement components.
    nodes: net.nodes.map((n) => ({ ...n, projectId: net.projectId })),
    links: net.links,
    clusters: net.clusters ?? [],
    warning: net.warning ?? null,
  };
}

// Where one computed link comes from: GET /projects/:projectId/network/links/:linkId/evidence
// -> { linkId, weight, contributions: { text, profile, boost }, evidenceCount, evidenceByKind: { idmention, coref },
//      signals: [{ signalId, text, source, authorRole, timestamp, label, kind: "idmention" | "coref", similarityA, similarityB }] }
export async function fetchLinkEvidence(projectId, linkId) {
  return api(`/projects/${encodeURIComponent(projectId)}/network/links/${encodeURIComponent(linkId)}/evidence`);
}
