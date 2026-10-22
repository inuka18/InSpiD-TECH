import { useMemo, useState } from "react";
import { AlertTriangle, BriefcaseBusiness, CalendarDays, ChevronRight, Clock3, Import, Search, UserPlus, Users2, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Input } from "../../components/ui/input";
import { Skeleton } from "../../components/ui/skeleton";
import { useScheduleView } from "../../hooks/useScheduleView";
import { useResourceCapacity } from "../../hooks/useResourceCapacity";
import { useSchedulePhases } from "../../hooks/useSchedulePhases";
import { flattenTasks, formatShortDate, taskAssigneeIds } from "./lib/scheduleUtils";
import { ResourceProfileModal } from "./components/ResourceProfileModal";
import { applyLeavePlan, getLeaveLabel } from "./lib/leaveAutomation";
import { useScheduleHistory } from "./context/ScheduleHistoryContext";
import { useRole, ROLES } from "../../context/RoleContext";
import { useActiveProject } from "../../hooks/useActiveProject";
import { useWorkCalendar } from "./context/WorkCalendarContext";

const SKILLS = {
  "Backend Developer": ["Node.js", "Express", "MongoDB", "AWS"], "Frontend Developer": ["React", "TypeScript", "JavaScript", "Accessibility"],
  "QA Engineer": ["Testing", "Automation", "Selenium", "API Testing"], "DevOps Engineer": ["AWS", "Docker", "CI/CD", "Terraform"],
  "Security Engineer": ["OWASP", "Threat Modelling", "Penetration Testing"], "Data Analyst": ["SQL", "Python", "Power BI"], "UX/UI Designer": ["Figma", "UX Research", "Design Systems"],
};
const badgeFor = (resource) => resource.offToday ? "outline" : resource.status === "Over-allocated" ? "danger" : resource.status === "Near Capacity" ? "warning" : "success";
const statusFor = (resource) => resource.offToday ? "On Leave" : resource.status === "Under-utilized" ? "Available" : resource.status === "Balanced" ? "Optimal" : resource.status;
const initials = (name) => name.split(" ").map((part) => part[0]).join("").toUpperCase();

export function ResourceManagementPage({ project: projectOverride, embedded = false, initialView = "resources", leaveOnly = false }) {
  const scheduleProject = useScheduleView().activeProject;
  const contextProject = useActiveProject().activeProject;
  const activeProject = projectOverride ?? scheduleProject ?? contextProject;
  const activeProjectId = activeProject?.id;
  const { role } = useRole();
  const isPM = role === ROLES.PM;
  const { data: capacity, loading } = useResourceCapacity(activeProjectId);
  const { data: phases } = useSchedulePhases(activeProjectId);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState(null);
  const [cards, setCards] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useState(initialView);
  const [selectedLeave, setSelectedLeave] = useState(null);
  const [, bump] = useState(0);
  const { pushHistory } = useScheduleHistory();
  const { settings } = useWorkCalendar();
  const allTasks = useMemo(() => flattenTasks(phases), [phases]);
  const resources = useMemo(() => capacity.map((resource) => {
    const utilization = Math.round((resource.plannedHours / resource.availableHours) * 100);
    const tasks = allTasks.filter((task) => taskAssigneeIds(task).includes(resource.memberId));
    return { ...resource, utilization, tasks, skills: SKILLS[resource.role] ?? ["Project Delivery", "Collaboration"] };
  }), [capacity, allTasks]);
  const filtered = resources.filter((resource) => (status === "all" || statusFor(resource) === status) && `${resource.name} ${resource.role} ${resource.skills.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const average = resources.length ? Math.round(resources.reduce((sum, resource) => sum + resource.utilization, 0) / resources.length) : 0;
  const metrics = [["Total resources", resources.length, Users2], ["Available", resources.filter((r) => statusFor(r) === "Available").length, Users2], ["Near capacity", resources.filter((r) => statusFor(r) === "Near Capacity").length, AlertTriangle], ["Overallocated", resources.filter((r) => statusFor(r) === "Over-allocated").length, AlertTriangle], ["On leave", resources.filter((r) => r.offToday).length, CalendarDays], ["Average utilization", `${average}%`, BriefcaseBusiness]];

  const applyLeave = (payload) => {
    if (!selectedLeave) return;
    const previousCapacity = Object.fromEntries(["offToday", "leaveType", "leaveHours", "leaveDate", "returnDate", "availableHours", "status"].map((key) => [key, selectedLeave[key]]));
    const result = applyLeavePlan({ capacity: selectedLeave, phases, capacityRecords: capacity, settings, ...payload });
    pushHistory(`Applied ${getLeaveLabel(payload.leaveType, payload.customHours)} leave for ${selectedLeave.name}`, () => {
      Object.assign(selectedLeave, previousCapacity);
      result.snapshots.forEach((snapshot) => {
        Object.assign(snapshot.task, {
          assigneeId: snapshot.prevAssigneeId,
          assigneeIds: snapshot.prevAssigneeIds,
          start: snapshot.prevStart,
          end: snapshot.prevEnd,
          durationMinutes: snapshot.prevDurationMinutes,
          originalAssigneeId: snapshot.prevOriginalAssigneeId,
          resourceReplacement: snapshot.prevReplacement,
          reallocatedFrom: snapshot.prevReallocatedFrom,
          leaveImpactHours: snapshot.prevLeaveImpactHours,
          leaveType: snapshot.prevLeaveType,
          leaveDate: snapshot.prevLeaveDate,
          changeDate: snapshot.prevChangeDate,
        });
      });
    });
    bump((revision) => revision + 1);
    return result;
  };

  return <div className="space-y-5">
    {embedded && !leaveOnly && <div><h2 className="text-xl font-semibold">Resources</h2><p className="mt-1 text-sm text-muted-foreground">Capacity, workload and leave planning for this project team.</p></div>}
    {!embedded && <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-bold tracking-tight">Resource Management</h2><p className="mt-1 text-sm text-muted-foreground">Manage project resources, skills, availability and workload{activeProject ? ` for ${activeProject.name}` : ""}.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setAddOpen(true)}><Import className="h-4 w-4" />Import resources</Button><Button onClick={() => setAddOpen(true)}><UserPlus className="h-4 w-4" />Add resource</Button></div></div>}
    {!embedded && <div className="flex gap-2 border-b border-border"><Button variant={view === "resources" ? "default" : "ghost"} onClick={() => setView("resources")}>Resources</Button><Button variant={view === "leave" ? "default" : "ghost"} onClick={() => setView("leave")}>Leave Planner</Button></div>}
    {((embedded && !leaveOnly) || (!embedded && view === "resources")) ? <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{metrics.map(([label, value, Icon]) => <Card key={label}><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div><Icon className="h-5 w-5 text-primary" /></CardContent></Card>)}</div>
    <Card><CardContent className="flex flex-wrap gap-2 p-3"><div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search resources, roles or skills..." /></div><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-input bg-background px-3 text-sm"><option value="all">All availability</option><option>Available</option><option>Optimal</option><option>Near Capacity</option><option>Over-allocated</option><option>On Leave</option></select><Button variant="outline" size="sm" onClick={() => { setQuery(""); setStatus("all"); }}>Reset filters</Button><Button variant="outline" size="sm" onClick={() => setCards((value) => !value)}>{cards ? "Table" : "Cards"}</Button></CardContent></Card>
    {loading ? <Skeleton className="h-96 w-full" /> : cards ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((resource) => <ResourceCard key={resource.id} resource={resource} onView={() => setSelected(resource)} />)}</div> : <ResourceTable resources={filtered} onView={setSelected} />}
    <div className="grid gap-4 xl:grid-cols-2"><Utilization resources={resources} average={average} /><Conflicts resources={resources} /></div>
    </> : null}
    {((embedded && leaveOnly) || (!embedded && view === "leave")) && <LeavePlanner resources={resources} loading={loading} onPlan={setSelectedLeave} />}
    {selected && <ResourceDrawer resource={selected} onClose={() => setSelected(null)} />}
    {addOpen && <AddResourceModal onClose={() => setAddOpen(false)} />}
    <ResourceProfileModal capacity={selectedLeave} phases={phases} capacityRecords={capacity} open={Boolean(selectedLeave)} onOpenChange={(open) => !open && setSelectedLeave(null)} onApplyLeave={isPM ? applyLeave : undefined} />
  </div>;
}

function LeavePlanner({ resources, loading, onPlan }) {
  const scheduled = resources.filter((resource) => resource.leaveDate);
  const onLeaveToday = resources.filter((resource) => resource.offToday).length;
  const orderedResources = [...resources].sort((a, b) => {
    if (a.offToday !== b.offToday) return a.offToday ? -1 : 1;
    if (Boolean(a.leaveDate) !== Boolean(b.leaveDate)) return a.leaveDate ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">Leave planner</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Schedule team time off and review how it affects assigned work.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {["Full day", "Half day", "Custom hours"].map((type) => <span key={type} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 text-muted-foreground"><Clock3 className="h-3 w-3" />{type}</span>)}
        </div>
      </div>

      <div className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-border">
        {[
          ["Team members", resources.length],
          ["On leave today", onLeaveToday],
          ["Leave entries", scheduled.length],
        ].map(([label, value], index) => (
          <div key={label} className={`flex items-center justify-between px-4 py-3 ${index < 2 ? "border-b border-border sm:border-b-0" : ""}`}>
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-lg font-semibold tabular-nums">{loading ? "..." : value}</span>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden shadow-none">
        <CardHeader className="border-b border-border bg-muted/20 py-4">
          <CardTitle className="text-sm">Team leave schedule</CardTitle>
          <CardDescription>Choose a team member to plan or update leave.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="space-y-3 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
            : orderedResources.length === 0 ? <p className="px-5 py-12 text-center text-sm text-muted-foreground">No team members are available for leave planning.</p>
              : <div className="divide-y divide-border">{orderedResources.map((resource) => {
                const hasLeave = Boolean(resource.leaveDate);
                return <div key={resource.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/20 sm:px-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-10 w-10 border border-border text-xs"><AvatarFallback>{initials(resource.name)}</AvatarFallback></Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{resource.name}</p>
                        {resource.offToday ? <Badge variant="warning" className="text-[10px]">On leave today</Badge> : hasLeave ? <Badge variant="outline" className="text-[10px]">Scheduled</Badge> : <Badge variant="secondary" className="text-[10px]">Available</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{resource.role}{hasLeave ? ` · ${getLeaveLabel(resource.leaveType, resource.leaveHours)} · ${formatShortDate(resource.leaveDate)}` : " · No leave scheduled"}</p>
                    </div>
                  </div>
                  <Button variant={hasLeave ? "outline" : "default"} size="sm" className="min-w-24" onClick={() => onPlan(resource)}>{hasLeave ? "Edit leave" : "Plan leave"}</Button>
                </div>;
              })}</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Utilization({ resources, average }) { return <Card><CardHeader><CardTitle className="text-base">Team utilization</CardTitle><CardDescription>Capacity signals used for task suitability and re-optimization.</CardDescription></CardHeader><CardContent className="space-y-3">{resources.map((r) => <div key={r.id}><div className="flex justify-between text-sm"><span>{r.name}</span><span className="font-semibold">{r.utilization}%</span></div><div className="mt-1.5 h-2 rounded-full bg-muted"><div className={r.utilization > 100 ? "h-full rounded-full bg-destructive" : r.utilization >= 85 ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-primary"} style={{ width: `${Math.min(r.utilization, 100)}%` }} /></div></div>)}<p className="border-t pt-3 text-sm text-muted-foreground">Average utilization: <span className="font-semibold text-foreground">{average}%</span></p></CardContent></Card>; }
function Conflicts({ resources }) { const conflicts = resources.filter((r) => r.utilization > 100 || r.offToday); return <Card><CardHeader><CardTitle className="text-base">Resource conflicts</CardTitle><CardDescription>Availability events that may require schedule re-optimization.</CardDescription></CardHeader><CardContent className="space-y-3">{conflicts.length ? conflicts.map((r) => <div key={r.id} className="rounded-lg border border-border p-3"><div className="flex items-center justify-between gap-2"><p className="font-medium">{r.offToday ? "Leave conflict" : "Overallocated"}</p><Badge variant={r.offToday ? "outline" : "danger"}>{r.name}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{r.offToday ? "Review assigned work before return date." : `${r.utilization}% utilization across ${r.tasks.length} assigned tasks.`}</p><Button variant="outline" size="sm" className="mt-3">Resolve</Button></div>) : <p className="py-6 text-center text-sm text-muted-foreground">No active conflicts.</p>}</CardContent></Card>; }
function ResourceCard({ resource, onView }) { return <Card><CardContent className="p-4"><div className="flex gap-3"><Avatar><AvatarFallback>{initials(resource.name)}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate font-semibold">{resource.name}</p><Badge variant={badgeFor(resource)}>{statusFor(resource)}</Badge></div><p className="text-sm text-muted-foreground">{resource.role}</p></div></div><p className="mt-3 text-xs text-muted-foreground">{resource.skills.join(" · ")}</p><p className="mt-3 text-sm">{resource.utilization}% utilization · {resource.tasks.length} tasks</p><Button variant="outline" className="mt-4 w-full" onClick={onView}>View resource<ChevronRight className="h-4 w-4" /></Button></CardContent></Card>; }
function ResourceTable({ resources, onView }) { return <Card className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-muted/40 text-xs uppercase text-muted-foreground"><tr>{["Resource", "Skills", "Capacity", "Allocated", "Available", "Utilization", "Tasks", "Status", ""].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{resources.map((r) => <tr key={r.id} className="border-t border-border"><td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar className="h-8 w-8 text-xs"><AvatarFallback>{initials(r.name)}</AvatarFallback></Avatar><div><p className="font-medium">{r.name}</p><p className="text-xs text-muted-foreground">{r.role}</p></div></div></td><td className="max-w-48 px-4 py-3 text-xs text-muted-foreground">{r.skills.slice(0, 3).join(" · ")}</td><td className="px-4 py-3">8h/day</td><td className="px-4 py-3">{(r.plannedHours / 10).toFixed(1)}h</td><td className="px-4 py-3">{((r.availableHours - r.plannedHours) / 10).toFixed(1)}h</td><td className="px-4 py-3"><div className="flex items-center gap-2"><span>{r.utilization}%</span><span className="h-1.5 w-12 rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(r.utilization, 100)}%` }} /></span></div></td><td className="px-4 py-3">{r.tasks.length}</td><td className="px-4 py-3"><Badge variant={badgeFor(r)}>{statusFor(r)}</Badge></td><td className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => onView(r)}>View</Button></td></tr>)}</tbody></table></Card>; }
function ResourceDrawer({ resource, onClose }) { return <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20"><aside className="h-full w-full max-w-xl overflow-y-auto bg-background p-5 shadow-2xl"><div className="flex justify-between"><div className="flex gap-3"><Avatar className="h-11 w-11"><AvatarFallback>{initials(resource.name)}</AvatarFallback></Avatar><div><h3 className="font-bold">{resource.name}</h3><p className="text-sm text-muted-foreground">{resource.role}</p><Badge className="mt-1" variant={badgeFor(resource)}>{statusFor(resource)}</Badge></div></div><Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button></div><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Daily capacity", "8h"], ["Allocated", `${(resource.plannedHours / 10).toFixed(1)}h`], ["Available", `${((resource.availableHours-resource.plannedHours)/10).toFixed(1)}h`], ["Utilization", `${resource.utilization}%`]].map(([l,v]) => <div key={l} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 font-bold">{v}</p></div>)}</div><section className="mt-6"><h4 className="font-semibold">Skills</h4><div className="mt-3 flex flex-wrap gap-2">{resource.skills.map((skill, i) => <span key={skill} className="rounded-full bg-muted px-3 py-1 text-sm">{skill} · {i === 0 ? "Expert" : i < 3 ? "Advanced" : "Intermediate"}</span>)}</div></section><section className="mt-6"><h4 className="font-semibold">Schedule suitability</h4><div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-4"><p className="font-bold text-primary">{resource.utilization > 100 ? "LOW" : resource.utilization > 85 ? "MEDIUM" : "HIGH"}</p><p className="mt-1 text-sm text-muted-foreground">Skill match is based on required-task skills and available capacity. {resource.utilization > 85 ? "Suitable for short-duration tasks only." : "Suitable for assignment."}</p></div></section><section className="mt-6"><h4 className="font-semibold">Assigned tasks</h4><div className="mt-3 space-y-2">{resource.tasks.map((task) => <div key={task.id} className="flex justify-between rounded-lg border p-3"><div><p className="font-medium">{task.name}</p><p className="text-xs text-muted-foreground">{task.id}</p></div><span className="text-sm">{task.storyPoints ?? 0} pts</span></div>) || <p className="text-sm text-muted-foreground">No assigned tasks.</p>}</div></section></aside></div>; }
function AddResourceModal({ onClose }) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4"><Card className="w-full max-w-2xl"><CardHeader className="flex-row items-center justify-between"><div><CardTitle>Add Resource</CardTitle><CardDescription>Set skills, capacity, availability and leave information.</CardDescription></div><Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Input placeholder="Resource name" /><Input placeholder="Role" /><Input type="number" defaultValue="8" aria-label="Working hours per day" /><Input type="date" aria-label="Available from" /><div className="sm:col-span-2"><Input placeholder="Skills (for example: React, Node.js, AWS)" /></div><div className="sm:col-span-2 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={onClose}>Add Resource</Button></div></CardContent></Card></div>; }
