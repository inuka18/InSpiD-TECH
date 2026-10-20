import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createProject, fetchProjects } from "../services/projectsService";
import { addTeamMember, fetchTeam, removeTeamMember } from "../services/teamService";
import { useRole } from "./RoleContext";

const ProjectContext = createContext(null);

// Backend project ids are 3-20 characters of A-Z, 0-9 and "-" (for example "SYS-RET").
function projectIdFromName(name, taken) {
  const base =
    String(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 16) || "PROJECT";
  const padded = base.length >= 3 ? base : `${base}-PRJ`.slice(0, 20);
  let id = padded;
  for (let n = 2; taken.has(id); n += 1) id = `${padded.slice(0, 20 - String(n).length - 1)}-${n}`;
  return id;
}

export function ProjectProvider({ children }) {
  const { currentUser } = useRole();
  const userId = currentUser?.id ?? null;
  // The API only returns projects the signed-in user belongs to, so "visible" and "all" are the same list.
  const [projects, setProjects] = useState([]);
  const [teamRows, setTeamRows] = useState([]);
  const [loadedFor, setLoadedFor] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await fetchProjects();
      const teams = await Promise.all(list.map((p) => fetchTeam(p.id).catch(() => [])));
      setProjects(list);
      setTeamRows(teams.flat());
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setProjects([]);
      setTeamRows([]);
      setLoadedFor(null);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    load().finally(() => {
      if (!cancelled) setLoadedFor(userId);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, load]);

  const loading = Boolean(userId) && loadedFor !== userId;

  // PM only. Creates the project on the server (the creator becomes a member) and reloads the list.
  // The backend has no invitee list, so those names are not stored.
  const addProject = useCallback(
    async ({ name, description }) => {
      const taken = new Set(projects.map((p) => p.id));
      const created = await createProject({ projectId: projectIdFromName(name, taken), name: name.trim(), description: description?.trim() || undefined });
      await load();
      return created;
    },
    [projects, load]
  );

  // Team rows now come from the API (teamRows), so there is no separate local "extra" roster any more.
  const extraTeamForProject = useCallback(() => [], []);

  const teamForProject = useCallback((projectId) => teamRows.filter((t) => t.projectId === projectId), [teamRows]);

  // PM only. The backend adds an ALREADY REGISTERED user, by email, to each selected project.
  const inviteMember = useCallback(
    async ({ email, projectIds }) => {
      for (const projectId of projectIds || []) await addTeamMember(projectId, email);
      await load();
    },
    [load]
  );

  const removeMember = useCallback(
    async (projectId, userIdToRemove) => {
      await removeTeamMember(projectId, userIdToRemove);
      await load();
    },
    [load]
  );

  const value = useMemo(
    () => ({
      projects,
      allProjects: projects,
      loading,
      error,
      reload: load,
      addProject,
      teamRows,
      teamForProject,
      extraTeamForProject,
      inviteMember,
      removeMember,
      // kept so older call sites keep working; removal goes through removeMember(projectId, userId)
      removeExtraTeamMember: () => {},
    }),
    [projects, loading, error, load, addProject, teamRows, teamForProject, extraTeamForProject, inviteMember, removeMember]
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within a ProjectProvider");
  return ctx;
}
