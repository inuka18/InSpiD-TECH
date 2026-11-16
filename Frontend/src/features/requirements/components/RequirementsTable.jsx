import { useMemo, useState } from "react";
import { Search, ListChecks, AlertCircle } from "lucide-react";
import { EmptyState } from "../../../components/common/EmptyState";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { Skeleton } from "../../../components/ui/skeleton";
import { StatusBadge } from "./StatusBadge";
import { DetectRequirementsDialog } from "./DetectRequirementsDialog";
import { STATUSES } from "../../../data/mockRequirements";
import { clusterMeta, clustersOf } from "../../../lib/clusters";
import { formatRelativeTime } from "../../../lib/utils";

// Most requirements have no status change yet, so the history can be empty: "Last updated" is then unknown.
function lastUpdatedOf(req) {
  const history = req.statusHistory ?? [];
  return history.length ? history[history.length - 1].timestamp : null;
}

export function RequirementsTable({ requirements, loading, error, onRetry, onSelectRequirement, projectId, isPM, onRequirementsCreated }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [clusterFilter, setClusterFilter] = useState("all");

  // Filter options come from the data (the real roles and computed clusters), not fixed lists.
  const roles = useMemo(() => [...new Set(requirements.map((r) => r.resourceRole).filter(Boolean))].sort(), [requirements]);
  const clusters = useMemo(() => clustersOf(requirements), [requirements]);

  const filtered = useMemo(() => {
    return requirements
      .filter((r) => (statusFilter === "all" ? true : r.liveStatus === statusFilter))
      .filter((r) => (roleFilter === "all" ? true : r.resourceRole === roleFilter))
      .filter((r) => (clusterFilter === "all" ? true : clusterMeta(r).id === clusterFilter))
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          r.id.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q)
        );
      })
      // Most recently changed first; requirements never changed go last, in id order.
      .sort((a, b) => {
        const ta = lastUpdatedOf(a);
        const tb = lastUpdatedOf(b);
        if (ta && tb) return new Date(tb) - new Date(ta);
        if (ta) return -1;
        if (tb) return 1;
        return a.id.localeCompare(b.id);
      });
  }, [requirements, search, statusFilter, roleFilter, clusterFilter]);

  if (error && !loading) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
        <AlertCircle className="h-6 w-6 text-status-dropped-fg" />
        <p className="text-sm font-medium text-foreground">Could not load the requirements.</p>
        <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
        {onRetry && (
          <button onClick={onRetry} className="text-sm font-medium text-primary hover:underline">
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!loading && requirements.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No requirements yet for this project."
        description="Upload a Software Requirements Specification (SRS) document to detect the requirements themselves and establish this project's baseline. This is separate from the Signal Feed, which only tracks changes against requirements that already exist."
        action={isPM ? <DetectRequirementsDialog projectId={projectId} onCreated={onRequirementsCreated} /> : null}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, title, or description…"
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clusterFilter} onValueChange={setClusterFilter}>
          <SelectTrigger className="w-full sm:w-60">
            <SelectValue placeholder="Cluster" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clusters</SelectItem>
            {clusters.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label} ({c.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Resource role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All resource roles</SelectItem>
            {roles.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requirement ID</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Cluster</TableHead>
              <TableHead>Live Status</TableHead>
              <TableHead>Affected Resource Role</TableHead>
              <TableHead>Granularity Level</TableHead>
              <TableHead>Last Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full max-w-[10rem]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No requirements match the current filters.
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              filtered.map((req) => {
                const cluster = clusterMeta(req);
                const updated = lastUpdatedOf(req);
                return (
                  <TableRow key={req.id} onClick={() => onSelectRequirement(req.id)} className="cursor-pointer">
                    <TableCell className="font-mono text-xs font-medium text-primary">{req.id}</TableCell>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-1 font-medium text-foreground">{req.title}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cluster.color }} />
                        {cluster.label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={req.liveStatus} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{req.resourceRole}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{req.granularity}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {updated ? formatRelativeTime(updated) : "No changes yet"}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      {!loading && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {requirements.length} requirements
        </p>
      )}
    </div>
  );
}
