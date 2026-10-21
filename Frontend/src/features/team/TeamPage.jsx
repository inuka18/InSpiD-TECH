import { useState } from "react";
import { X, Users, AlertCircle } from "lucide-react";
import { PageHeader } from "../../components/common/PageHeader";
import { EmptyState } from "../../components/common/EmptyState";
import { Card, CardContent } from "../../components/ui/card";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { InviteMemberDialog } from "./components/InviteMemberDialog";
import { TeamMemberDetailDialog } from "./components/TeamMemberDetailDialog";
import { useTeam } from "../../hooks/useTeam";
import { useSchedule } from "../../hooks/useSchedule";
import { useActiveProject } from "../../hooks/useActiveProject";
import { useMemberProfile } from "../../hooks/useMemberProfile";
import { useProject } from "../../context/ProjectContext";
import { useRole, ROLES } from "../../context/RoleContext";
import { cn } from "../../lib/utils";

function capacityColor(pct) {
  if (pct > 100) return "bg-status-dropped-fg";
  if (pct >= 80) return "bg-status-atrisk-fg";
  return "bg-status-confirmed-fg";
}

export function TeamPage() {
  const { activeProjectId, activeProject } = useActiveProject();
  const { allProjects, extraTeamForProject, inviteMember, removeMember } = useProject();
  const { role, currentUser } = useRole();
  const { data: fetchedTeam, loading, error, reload } = useTeam(activeProjectId);
  const [actionError, setActionError] = useState("");
  const { data: tasks } = useSchedule(activeProjectId);
  const [selectedMember, setSelectedMember] = useState(null);
  const { data: profile, loading: profileLoading } = useMemberProfile(selectedMember, {
    allProjects,
    extraTeamForProject,
  });

  const members = fetchedTeam;

  // Invite = add an already-registered user (by email) to the selected projects. Errors reach the dialog.
  const handleInvite = async ({ email, projectIds }) => {
    await inviteMember({ email, projectIds });
    reload();
  };

  // Remove = take the person off THIS project (PM only; the server refuses removing yourself).
  const handleRemove = async (id) => {
    setActionError("");
    try {
      await removeMember(activeProjectId, id);
      reload();
    } catch (err) {
      setActionError(err.message || "Could not remove this person.");
    }
  };

  const isPM = role === ROLES.PM;
  const memberTasks = selectedMember ? tasks.filter((t) => t.assigneeId === selectedMember.id) : [];
  const isSelf = selectedMember?.id === currentUser?.id;
  const canSeeTasks = isPM || isSelf;

  return (
    <div>
      <PageHeader
        title="Team"
        description={activeProject ? `Everyone staffed on ${activeProject.name}.` : "Project team roster."}
        actions={
          isPM ? (
            <InviteMemberDialog projects={allProjects} defaultProjectId={activeProjectId} onInvite={handleInvite} />
          ) : null
        }
      />

      {error && !loading && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">Could not load the team: {error.message}</span>
          <button onClick={reload} className="font-medium underline">
            Try again
          </button>
        </div>
      )}
      {actionError && (
        <div role="alert" className="mb-4 rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg">
          {actionError}
        </div>
      )}

      {!loading && !error && members.length === 0 && (
        <EmptyState
          icon={Users}
          title="No team members yet"
          description={
            isPM
              ? "Invite people to staff this project. They'll show up here with their workload and assigned tasks."
              : "No one has been added to this project's roster yet."
          }
          action={
            isPM ? (
              <InviteMemberDialog projects={allProjects} defaultProjectId={activeProjectId} onInvite={handleInvite} />
            ) : null
          }
        />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="flex items-center gap-3 p-4">
                <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </CardContent>
            </Card>
          ))}

        {!loading &&
          members.map((member) => (
            <Card key={member.id} className="group relative">
              {isPM && member.appRole !== "pm" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(member.id);
                  }}
                  aria-label={`Remove ${member.name}`}
                  className="absolute right-3 top-3 z-10 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => setSelectedMember(member)} className="w-full text-left">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-11 w-11 text-sm">
                      <AvatarFallback>{member.initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{member.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{member.jobTitle}</p>
                    </div>
                    {member.appRole === "pm" && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        PM
                      </Badge>
                    )}
                  </div>

                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Workload</span>
                      <span className="font-medium text-muted-foreground">Not connected yet</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", capacityColor(0))} style={{ width: "0%" }} />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <span>Tasks: schedule not connected</span>
                    {member.email && <span className="truncate">{member.email}</span>}
                  </div>
                </CardContent>
              </button>
            </Card>
          ))}
      </div>

      <TeamMemberDetailDialog
        member={selectedMember}
        tasks={memberTasks}
        canSeeTasks={canSeeTasks}
        profile={profile}
        profileLoading={profileLoading}
        open={Boolean(selectedMember)}
        onOpenChange={(open) => !open && setSelectedMember(null)}
      />
    </div>
  );
}
