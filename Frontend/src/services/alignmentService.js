// Alignment and baselines from the API (/projects/:projectId/alignment and /baselines).
// Alignment = how far the current computed network has drifted from a frozen baseline.
// GET /alignment -> { baseline: { id, name, createdAt },
//                     current: { score, band, connectionsAdded, connectionsRemoved, changedConnections },
//                     history: [{ date, alignmentScore, connectionsAdded, connectionsRemoved, changedConnections, driverSignalId }] }
import { api, ApiError } from "../lib/apiClient";

const root = (projectId) => `/projects/${encodeURIComponent(projectId)}`;

// Resolves with null when the project has no baseline yet (the API answers 404 NO_BASELINE).
export async function fetchAlignment(projectId, baselineId) {
  if (!projectId) return null;
  const query = baselineId ? `?baselineId=${encodeURIComponent(baselineId)}` : "";
  try {
    return await api(`${root(projectId)}/alignment${query}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && err.code === "NO_BASELINE") return null;
    throw err;
  }
}

// PM only. Freezes the CURRENT network and requirement states. -> { id, name, createdAt, createdBy, linkCount, ... }
export async function createBaseline(projectId, name) {
  return api(`${root(projectId)}/baselines`, { method: "POST", body: { name } });
}
