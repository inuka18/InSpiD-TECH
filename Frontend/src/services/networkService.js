// The requirements network from the API: GET /projects/:projectId/network.
// { projectId, nodes: [{ id, title, liveStatus, cluster, clusterLabel, type, resourceRole }],
//   links: [{ id, source, target, kind: "pathfinder" | "manual", relationType, weight?, reason? }],
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
