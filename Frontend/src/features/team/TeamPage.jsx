import { useState } from "react";
import { X, Users, AlertCircle, BriefcaseBusiness, ListTodo, Mail, UserRound, Gauge, CalendarDays } from "lucide-react";
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
import { useResourceCapacity } from "../../hooks/useResourceCapacity";
import { useActiveProject } from "../../hooks/useActiveProject";
import { useMemberProfile } from "../../hooks/useMemberProfile";
import { useProject } from "../../context/ProjectContext";
import { useRole, ROLES } from "../../context/RoleContext";
import { ResourceManagementPage } from "../schedule/ResourceManagementPage";
import { taskAssigneeIds } from "../schedule/lib/scheduleUtils";
import { RENT_EASE_PROJECT_ID } from "../../data/mockRentEase";

export function TeamPage() {
  const { activeProjectId, activeProject } = useActiveProject();
  const { allProjects, extraTeamForProject, inviteMember, removeMember } = useProject();
  const { role, currentUser } = useRole();
  const { data: fetchedTeam, loading, error, reload } = useTeam(activeProjectId);
  const [actionError, setActionError] = useState("");
  const { data: tasks, loading: tasksLoading } = useSchedule(activeProjectId);
  const { data: capacity, loading: capacityLoading } = useResourceCapacity(activeProjectId);
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
  const isRentEaseDemo = activeProjectId === RENT_EASE_PROJECT_ID;
  const memberTasks = selectedMember ? tasks.filter((task) => taskAssigneeIds(task).includes(selectedMember.id)) : [];
  const isSelf = selectedMember?.id === currentUser?.id;
  const canSeeTasks = isPM || isSelf;
  const projectManagers = members.filter((member) => member.appRole === "pm").length;
  const capacityByMemberId = new Map(capacity.map((record) => [record.memberId, record]));
  const averageUtilization = capacity.length
    ? Math.round(capacity.reduce((sum, record) => sum + (record.availableHours ? record.plannedHours / record.availableHours * 100 : 0), 0) / capacity.length)
    : 0;
  const onLeaveToday = capacity.filter((record) => record.offToday).length;

  return (
    <div>
      <PageHeader
        title="Team"
        description={activeProject ? `People, capacity, and leave planning for ${activeProject.name}.` : "Project team roster and capacity planning."}
        actions={
          isPM && !isRentEaseDemo ? (
            <InviteMemberDialog projects={allProjects} defaultProjectId={activeProjectId} onInvite={handleInvite} />
          ) : null
        }
      />

      <div className="mb-7 grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-border">
        {[
          { label: "Team members", value: loading ? "..." : members.length, icon: Users, detail: "People on this project" },
          { label: "Project managers", value: loading ? "..." : projectManagers, icon: BriefcaseBusiness, detail: "Planning and coordination" },
          { label: "Average utilization", value: capacityLoading ? "..." : capacity.length ? `${averageUtilization}%` : "—", icon: Gauge, detail: `${capacityLoading ? "..." : onLeaveToday} on leave today` },
        ].map(({ label, value, icon: Icon, detail }) => (
          <div key={label} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 last:border-b-0 sm:border-b-0">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="text-sm font-semibold">{label}</p><p className="truncate text-xs text-muted-foreground">{detail}</p></div>
            </div>
            <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{value}</span>
          </div>
        ))}
      </div>

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

      {!loading && !error && members.length > 0 && <div className="mb-3 flex items-end justify-between gap-3">
        <div><h3 className="text-lg font-semibold tracking-tight">Project roster</h3><p className="mt-1 text-sm text-muted-foreground">Select a person to view their profile and assigned work.</p></div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{members.length} people</span>
      </div>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
            <Card key={member.id} className="group relative overflow-hidden border-border/80 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
              {isPM && !isRentEaseDemo && member.appRole !== "pm" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(member.id);
                  }}
                  aria-label={`Remove ${member.name}`}
                  className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => setSelectedMember(member)} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-12 w-12 border border-border text-sm shadow-sm">
                      <AvatarFallback>{member.initials}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{member.name}</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"><UserRound className="h-3 w-3 shrink-0" />{member.jobTitle || "Team member"}</p>
                    </div>
                    {member.appRole === "pm" && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        PM
                      </Badge>
                    )}
                  </div>

                  {(() => {
                    const record = capacityByMemberId.get(member.id);
                    const utilization = record && record.availableHours ? Math.round(record.plannedHours / record.availableHours * 100) : null;
                    const assignedCount = tasks.filter((task) => taskAssigneeIds(task).includes(member.id)).length;
                    return <div className="mt-4 space-y-3 border-t border-border pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ListTodo className="h-3.5 w-3.5" />{tasksLoading ? "Loading tasks" : `${assignedCount} assigned tasks`}</span>
                        {record?.offToday ? <Badge variant="outline" className="gap-1 text-[10px]"><CalendarDays className="h-3 w-3" />On leave</Badge> : record && <Badge variant={record.status === "Over-allocated" ? "danger" : record.status === "Near Capacity" ? "warning" : "success"} className="text-[10px]">{record.status}</Badge>}
                      </div>
                      {capacityLoading ? <p className="text-xs text-muted-foreground">Loading capacity...</p> : record ? <>
                        <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Capacity used</span><span className="font-medium">{utilization}% · {record.plannedHours}h / {record.availableHours}h</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${utilization > 100 ? "bg-destructive" : utilization >= 85 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(utilization, 100)}%` }} /></div>
                      </> : <p className="text-xs text-muted-foreground">Capacity not available</p>}
                      {member.email && <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{member.email}</span></p>}
                    </div>;
                  })()}
                </CardContent>
              </button>
            </Card>
          ))}
      </div>

      <div className="mt-10 border-t border-border pt-8">
        <ResourceManagementPage project={activeProject} embedded leaveOnly />
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
