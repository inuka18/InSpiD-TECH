import { useMemo } from "react";
import { Link2, Network, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetBody, SheetTitle, SheetDescription } from "../../../components/ui/sheet";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Separator } from "../../../components/ui/separator";
import { StatusBadge } from "./StatusBadge";
import { useRequirement } from "../../../hooks/useRequirements";
import { useLinkEvidence } from "../../../hooks/useLinkEvidence";
import { ClassificationBadge } from "./ClassificationBadge";
import { clusterMeta } from "../../../lib/clusters";
import { linkRank, networkWeightStats, rankPhrase, sharedTerms } from "../../../lib/networkStats";
import { formatDateTime } from "../../../lib/utils";

const pct = (w) => Math.round(w * 100);

// "Where this link comes from": the link strength split into its three parts (they add up to the strength).
function Contributions({ contributions, weight }) {
  const parts = [
    { key: "text", label: "Requirement text", hint: "How alike the two requirement texts are (MiniLM).", value: contributions.text, bar: "bg-primary" },
    { key: "profile", label: "Signal profile", hint: "How alike the messages applied to each requirement are (only once both have signals).", value: contributions.profile, bar: "bg-status-modified-fg" },
    { key: "boost", label: "Co-reference and id mentions", hint: "Signals that name both requirements by id, or matched both about equally well.", value: contributions.boost, bar: "bg-status-confirmed-fg" },
  ];
  return (
    <div className="space-y-2.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Link strength ${pct(weight)} percent`}>
        {parts.map((p) => (p.value > 0 ? <div key={p.key} className={p.bar} style={{ width: `${Math.max(p.value * 100, 0.5)}%` }} /> : null))}
      </div>
      <ul className="space-y-1.5">
        {parts.map((p) => (
          <li key={p.key} className="flex items-start gap-2 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${p.bar}`} />
            <span className="flex-1">
              <span className="font-medium text-foreground">{p.label}</span>
              <span className="block text-xs text-muted-foreground">{p.hint}</span>
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">{p.value > 0 ? `+${pct(p.value)}` : "0"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const KIND_LABEL = { idmention: "Names both requirements", coref: "Matched both about equally" };

// "Signal evidence": the signals that gave evidence for this pair, newest first (up to 20), from the evidence endpoint.
function SignalEvidence({ evidence, loading, error }) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading signal evidence…</p>;
  if (error) return <p className="text-sm text-status-dropped-fg">Could not load the signal evidence: {error.message}</p>;
  if (!evidence || evidence.signals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No signal has given evidence for this link yet. Its strength comes from the requirement texts
        {evidence?.contributions?.profile > 0 ? " and the signal profiles" : ""}.
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {evidence.signals.map((s) => (
        <li key={s.signalId} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-medium text-primary">{s.signalId}</span>
              <Badge variant="outline" className="text-[10px]">
                {KIND_LABEL[s.kind] ?? s.kind}
              </Badge>
            </div>
            {s.label && <ClassificationBadge classification={s.label} />}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground/90">"{s.text}"</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {s.authorRole} · {s.source} · {formatDateTime(s.timestamp)}
            {s.similarityA != null && s.similarityB != null ? ` · match ${pct(s.similarityA)}% / ${pct(s.similarityB)}%` : ""}
          </p>
        </li>
      ))}
      {evidence.evidenceCount > evidence.signals.length && (
        <li className="text-xs text-muted-foreground">Showing the newest {evidence.signals.length} of {evidence.evidenceCount}.</li>
      )}
    </ul>
  );
}

function Endpoint({ node, signalCount, onOpen }) {
  const cluster = clusterMeta(node);
  return (
    <div className="rounded-lg border border-border p-3">
      <button
        type="button"
        onClick={() => onOpen(node.id)}
        className="text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open ${node.id}: ${node.title}`}
      >
        <span className="font-mono text-xs font-medium text-primary hover:underline">{node.id}</span>
        <span className="mt-0.5 block text-sm font-semibold leading-snug text-foreground hover:text-primary">{node.title}</span>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={node.liveStatus} />
        <Badge variant="outline" className="gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cluster.color }} />
          {cluster.label}
        </Badge>
      </div>
      {signalCount != null && (
        <p className="mt-2 text-xs text-muted-foreground">
          {signalCount} signal{signalCount === 1 ? "" : "s"} mapped to this requirement
        </p>
      )}
    </div>
  );
}

// "Link details" for one line on the network map: a computed (Pathfinder) link or a manual link.
// `link`: { id, kind: "pathfinder" | "manual", source, target, weight?, reason?, createdBy?, createdAt?, raw? }
export function LinkDetailsPanel({
  link,
  open,
  onOpenChange,
  onCloseAutoFocus,
  projectId,
  nodes,
  links,
  signals = [],
  isPM,
  onSelectRequirement,
  onRemoveManualLink,
}) {
  const a = link ? nodes.find((n) => n.id === link.source) : null;
  const b = link ? nodes.find((n) => n.id === link.target) : null;
  // Descriptions come through the existing requirement hook (the network nodes only carry titles).
  const { data: reqA, loading: loadingA } = useRequirement(link?.source ?? null, projectId);
  const { data: reqB, loading: loadingB } = useRequirement(link?.target ?? null, projectId);

  const stats = useMemo(() => networkWeightStats(links), [links]);
  const terms = useMemo(
    () => (reqA && reqB ? sharedTerms(`${a?.title ?? ""} ${reqA.description ?? ""}`, `${b?.title ?? ""} ${reqB.description ?? ""}`) : null),
    [reqA, reqB, a, b]
  );
  const signalCount = (id) => signals.filter((s) => s.mappedRequirementId === id).length;

  const isManual = link?.kind === "manual";
  const { data: evidence, loading: evidenceLoading, error: evidenceError } = useLinkEvidence(projectId, link && !isManual && open ? link.id : null);
  const rankA = link && !isManual ? rankPhrase(link.source, linkRank(link, link.source, links)) : null;
  const rankB = link && !isManual ? rankPhrase(link.target, linkRank(link, link.target, links)) : null;
  const sameCluster = a && b ? clusterMeta(a).id === clusterMeta(b).id : false;
  const bothUngrouped = a && b && !a.cluster && !b.cluster;
  const diff = stats && link?.weight != null ? pct(link.weight) - pct(stats.avg) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col p-0" onCloseAutoFocus={onCloseAutoFocus}>
        {link && a && b ? (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>Link details</SheetTitle>
                {isManual ? (
                  <Badge variant="ripple" className="gap-1">
                    <Link2 className="h-3 w-3" />
                    Manual
                  </Badge>
                ) : (
                  <Badge variant="info" className="gap-1">
                    <Network className="h-3 w-3" />
                    Semantic · Pathfinder
                  </Badge>
                )}
              </div>
              <SheetDescription>
                <button type="button" onClick={() => onSelectRequirement(a.id)} className="font-mono font-medium text-primary hover:underline">
                  {a.id}
                </button>
                <span className="text-muted-foreground"> {a.title}</span>
                <span className="mx-1.5 text-muted-foreground">↔</span>
                <button type="button" onClick={() => onSelectRequirement(b.id)} className="font-mono font-medium text-primary hover:underline">
                  {b.id}
                </button>
                <span className="text-muted-foreground"> {b.title}</span>
              </SheetDescription>
            </SheetHeader>

            <SheetBody className="scrollbar-thin">
              <section className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Endpoint node={a} signalCount={signalCount(a.id)} onOpen={onSelectRequirement} />
                  <Endpoint node={b} signalCount={signalCount(b.id)} onOpen={onSelectRequirement} />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {bothUngrouped ? "Both ungrouped" : sameCluster ? "Same cluster" : "Across clusters"}
                </p>
              </section>

              <Separator className="my-5" />

              {isManual ? (
                <section className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">Manual link</h4>
                  <p className="text-sm leading-relaxed text-foreground/90">
                    <span className="text-muted-foreground">Reason: </span>
                    {link.reason}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created by {link.createdBy || "unknown"}
                    {link.createdAt ? ` on ${formatDateTime(link.createdAt)}` : ""}.
                  </p>
                  <p className="text-xs text-muted-foreground">A manual link has no similarity score: a person added it on purpose.</p>
                  {isPM && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 border-status-dropped-fg/40 text-status-dropped-fg hover:bg-status-dropped-bg"
                      onClick={() => onRemoveManualLink(link.raw)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove this manual link
                    </Button>
                  )}
                </section>
              ) : (
                <section className="space-y-3">
                  <h4 className="text-sm font-semibold text-foreground">Link strength</h4>
                  <p className="text-3xl font-bold leading-none text-foreground">{link.weight != null ? `${pct(link.weight)}%` : "–"}</p>
                  {stats && (
                    <p className="text-xs text-muted-foreground">
                      Link strength from the requirement texts and the signals (not a probability). Links in this network range from {pct(stats.min)}% to {pct(stats.max)}%.
                    </p>
                  )}
                  {stats && link.weight != null && (
                    <div>
                      <div className="relative h-2 w-full rounded-full bg-muted" aria-hidden="true">
                        <div
                          className="absolute inset-y-0 rounded-full bg-primary/20"
                          style={{ left: `${pct(stats.min)}%`, width: `${Math.max(pct(stats.max) - pct(stats.min), 1)}%` }}
                        />
                        <div className="absolute -top-0.5 h-3 w-0.5 bg-muted-foreground/70" style={{ left: `${pct(stats.avg)}%` }} title="Network average" />
                        <div className="absolute -top-1 h-4 w-2 -translate-x-1/2 rounded-sm bg-primary" style={{ left: `${pct(link.weight)}%` }} title="This link" />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Network average {pct(stats.avg)}% across {stats.count} links.{" "}
                        {diff === 0 ? "This link is at the average." : `This link is ${Math.abs(diff)} point${Math.abs(diff) === 1 ? "" : "s"} ${diff > 0 ? "above" : "below"} the average.`}
                      </p>
                    </div>
                  )}
                  {(rankA || rankB) && (
                    <ul className="list-inside list-disc space-y-0.5 text-sm text-foreground/90">
                      {rankA && <li>{rankA}</li>}
                      {rankB && <li>{rankB}</li>}
                    </ul>
                  )}
                </section>
              )}

              <Separator className="my-5" />

              <section>
                <h4 className="mb-2 text-sm font-semibold text-foreground">Key shared terms</h4>
                {loadingA || loadingB || terms === null ? (
                  <p className="text-sm text-muted-foreground">Loading descriptions…</p>
                ) : terms.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No clear shared terms.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {terms.map((t) => (
                      <span key={t} className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {!isManual && (
                <>
                  <Separator className="my-5" />
                  <section>
                    <h4 className="mb-2 text-sm font-semibold text-foreground">Where this link comes from</h4>
                    {link.contributions ? (
                      <Contributions contributions={link.contributions} weight={link.weight ?? 0} />
                    ) : (
                      <p className="text-sm text-muted-foreground">No breakdown is available for this link.</p>
                    )}
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      Pathfinder keeps a link only when no indirect path joins the two requirements through stronger links.
                    </p>
                  </section>

                  <Separator className="my-5" />
                  <section>
                    <h4 className="mb-2 text-sm font-semibold text-foreground">
                      Signal evidence{evidence ? ` (${evidence.evidenceCount})` : ""}
                    </h4>
                    <SignalEvidence evidence={evidence} loading={evidenceLoading} error={evidenceError} />
                  </section>
                </>
              )}
            </SheetBody>
          </>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">
            <SheetTitle>Link details</SheetTitle>
            <SheetDescription>This link is no longer on the map.</SheetDescription>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
