import { useMemo, useState } from "react";
import { Link2, ArrowRight, Unlink, Network, Flag } from "lucide-react";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { Skeleton } from "../../../components/ui/skeleton";
import { StatusBadge } from "./StatusBadge";
import { LedgerTransactionDetailModal } from "./LedgerTransactionDetailModal";
import { formatDateTime, truncateHash } from "../../../lib/utils";

// "Network Updated" entries carry the link ids they added and removed in `details`.
export function NetworkUpdateSummary({ details }) {
  const added = details?.added ?? [];
  const removed = details?.removed ?? [];
  const idList = (ids) => ids.map((id) => id.replace(/~semantic$/, "").replace("~", " ↔ "));
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <details className="group">
        <summary className="cursor-pointer list-none text-sm text-muted-foreground hover:text-foreground">
          <span className="font-medium text-foreground">
            {added.length} link{added.length === 1 ? "" : "s"} added, {removed.length} removed
          </span>{" "}
          <span className="text-xs text-primary group-open:hidden">Show link ids</span>
          <span className="hidden text-xs text-primary group-open:inline">Hide</span>
        </summary>
        <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed scrollbar-thin">
          {added.length > 0 && (
            <p>
              <span className="font-semibold text-status-confirmed-fg">+ added: </span>
              {idList(added).join(" · ")}
            </p>
          )}
          {removed.length > 0 && (
            <p>
              <span className="font-semibold text-status-dropped-fg">− removed: </span>
              {idList(removed).join(" · ")}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

export function LedgerTable({ entries, loading, onSelectRequirement }) {
  const [search, setSearch] = useState("");
  const [selectedEntry, setSelectedEntry] = useState(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        (e.requirementId ?? "").toLowerCase().includes(q) ||
        (e.relatedRequirementId ?? "").toLowerCase().includes(q) ||
        (e.txHash ?? "").toLowerCase().includes(q) ||
        (e.triggeringSignal ?? "").toLowerCase().includes(q) ||
        (e.eventType ?? "").toLowerCase().includes(q) ||
        (e.actor ?? "").toLowerCase().includes(q)
    );
  }, [entries, search]);

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by requirement ID, hash, event, signal, or actor…"
        className="max-w-md"
      />

      <div className="overflow-hidden rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hash (block)</TableHead>
              <TableHead>Requirement</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Triggering Signal / Reason</TableHead>
              <TableHead>Timestamp</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full max-w-[10rem]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  {entries.length === 0 ? "No ledger entries yet." : "No ledger entries match your search."}
                </TableCell>
              </TableRow>
            )}

            {!loading &&
              filtered.map((entry) => {
                const isManual = entry.eventCode === "MANUAL_LINK";
                const isNetwork = entry.eventCode === "NETWORK_UPDATE";
                const isBaseline = entry.eventCode === "BASELINE_CREATED";

                return (
                  <TableRow key={entry.txHash} onClick={() => setSelectedEntry(entry)} className="cursor-pointer">
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-mono text-xs text-foreground/80">
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {truncateHash(entry.txHash)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {entry.onChain ? "On-chain" : "Local hash chain"} · block #{entry.blockNumber}
                      </div>
                    </TableCell>
                    <TableCell>
                      {isBaseline ? (
                        <div className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                          <Flag className="h-3.5 w-3.5" />
                          Requirement network
                        </div>
                      ) : isNetwork ? (
                        <div className="flex flex-wrap items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
                          <Network className="h-3.5 w-3.5" />
                          Requirement network
                          {entry.requirementId && (
                            <>
                              <span>·</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectRequirement(entry.requirementId);
                                }}
                                className="font-mono font-medium text-primary hover:underline"
                              >
                                {entry.requirementId}
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1 whitespace-nowrap">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectRequirement(entry.requirementId);
                            }}
                            className="font-mono text-xs font-medium text-primary hover:underline"
                          >
                            {entry.requirementId}
                          </button>
                          {entry.relatedRequirementId && (
                            <>
                              <span className="text-muted-foreground">↔</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectRequirement(entry.relatedRequirementId);
                                }}
                                className="font-mono text-xs font-medium text-primary hover:underline"
                              >
                                {entry.relatedRequirementId}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {isBaseline ? (
                        <div className="flex flex-col gap-1">
                          <Badge variant="info" className="w-fit gap-1 text-[10px]">
                            <Flag className="h-3 w-3" />
                            {entry.eventType}
                          </Badge>
                          {entry.actor && <span className="text-[11px] text-muted-foreground">by {entry.actor}</span>}
                        </div>
                      ) : isNetwork ? (
                        <div className="flex flex-col gap-1">
                          <Badge variant="info" className="w-fit gap-1 text-[10px]">
                            <Network className="h-3 w-3" />
                            {entry.eventType}
                          </Badge>
                          {entry.actor && <span className="text-[11px] text-muted-foreground">by {entry.actor}</span>}
                        </div>
                      ) : isManual ? (
                        <div className="flex flex-col gap-1">
                          <Badge variant="ripple" className="w-fit gap-1 text-[10px]">
                            {entry.eventType === "Manual Link Added" ? <Link2 className="h-3 w-3" /> : <Unlink className="h-3 w-3" />}
                            {entry.eventType}
                          </Badge>
                          {entry.actor && <span className="text-[11px] text-muted-foreground">by {entry.actor}</span>}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          {entry.previousStatus ? (
                            <StatusBadge status={entry.previousStatus} />
                          ) : (
                            <span className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                              Created
                            </span>
                          )}
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <StatusBadge status={entry.newStatus} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-sm">
                      {isBaseline ? (
                        <span className="text-sm text-foreground">
                          Baseline <span className="font-semibold">{entry.details?.name ?? "(unnamed)"}</span> frozen
                        </span>
                      ) : isNetwork ? (
                        <NetworkUpdateSummary details={entry.details} />
                      ) : (
                        <span className="line-clamp-2 text-sm text-muted-foreground">{entry.triggeringSignal}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {formatDateTime(entry.timestamp)}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      {!loading && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {entries.length} ledger entries
        </p>
      )}

      <LedgerTransactionDetailModal
        entry={selectedEntry}
        open={Boolean(selectedEntry)}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
        onSelectRequirement={onSelectRequirement}
      />
    </div>
  );
}
