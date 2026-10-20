// Team rosters from the real API. The backend returns { id, projectId, name, email, jobTitle, appRole }.
// Initials are derived here; workload and task counts belong to the schedule component and are 0 until it is connected.
import { api } from "../lib/apiClient";
import { initialsFor } from "../lib/utils";

export function toMember(m) {
  return {
    id: m.id,
    projectId: m.projectId,
    name: m.name,
    initials: initialsFor(m.name),
    email: m.email || "",
    jobTitle: m.jobTitle || "Team Member",
    appRole: m.appRole,
    workloadPercent: 0,
    assignedTasksCount: 0,
  };
}

export async function fetchTeam(projectId) {
  if (projectId) return (await api(`/projects/${encodeURIComponent(projectId)}/team`)).map(toMember);
  // No project given: every project the user belongs to.
  const projects = await api("/projects");
  const rosters = await Promise.all(projects.map((p) => api(`/projects/${encodeURIComponent(p.id)}/team`)));
  return rosters.flat().map(toMember);
}

// PM only. The backend can only add a user who is already registered (by email).
export async function addTeamMember(projectId, email) {
  return toMember(await api(`/projects/${encodeURIComponent(projectId)}/team`, { method: "POST", body: { email } }));
}

// PM only.
export async function removeTeamMember(projectId, userId) {
  return api(`/projects/${encodeURIComponent(projectId)}/team/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
