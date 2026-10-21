// Projects from the real API. The backend project has only { id, name, domain, description }, so the fields the
// UI cards also use (colour, short description, sprint, health) are derived here.
import { api, ApiError } from "../lib/apiClient";

const PROJECT_COLORS = ["#6366f1", "#0ea5e9", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6"];

function colorFor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PROJECT_COLORS[h % PROJECT_COLORS.length];
}

export function toProject(p) {
  const description = p.description || "";
  return {
    id: p.id ?? p.projectId,
    name: p.name,
    domain: p.domain || "",
    colorTag: colorFor(p.id ?? p.projectId),
    shortDescription: description ? description.slice(0, 140) : p.domain || "No description yet.",
    description: description || "No description yet.",
    startDate: null, // not stored by the backend
    // Sprint data belongs to the schedule component, which is not connected yet.
    activeSprint: { name: "Sprint data not connected yet", number: 0, startDate: null, endDate: null },
    health: "on-track",
  };
}

export async function fetchProjects() {
  return (await api("/projects")).map(toProject);
}

export async function fetchProjectById(id) {
  try {
    return toProject(await api(`/projects/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
}

// PM only. projectId must be 3-20 characters of A-Z, 0-9 and "-".
export async function createProject({ projectId, name, domain, description }) {
  return toProject(await api("/projects", { method: "POST", body: { projectId, name, domain, description } }));
}
