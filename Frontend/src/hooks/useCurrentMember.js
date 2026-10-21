import { useMemo } from "react";
import { useProject } from "../context/ProjectContext";
import { useRole } from "../context/RoleContext";

// Resolves the signed-in user's own team row for a given project: the thing every "is this MY task / MY action
// item" role check needs, since team rows (not the login) are the unit of project membership.
// Team rows come from the API and are matched by user id.
export function useCurrentMember(projectId) {
  const { currentUser } = useRole();
  const { teamRows } = useProject();

  return useMemo(() => {
    if (!currentUser || !projectId) return null;
    return teamRows.find((t) => t.projectId === projectId && t.id === currentUser.id) ?? null;
  }, [currentUser, projectId, teamRows]);
}
