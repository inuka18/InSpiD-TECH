import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare,
  Mail,
  StickyNote,
  MessagesSquare,
  Users,
  Check,
  X,
  Upload,
  Filter,
  Pencil,
  Loader2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Skeleton } from "../../../components/ui/skeleton";
import { Badge } from "../../../components/ui/badge";
import { ClassificationBadge } from "./ClassificationBadge";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { NewRequirementTag } from "./NewRequirementTag";
import { SignalSubmitPanel } from "./SignalSubmitPanel";
import { UploadDocumentDialog } from "./UploadDocumentDialog";
import { CLASSIFICATIONS } from "../../../data/mockSignals";
import { reviewSignal } from "../../../services/signalsService";
import { formatRelativeTime, cn } from "../../../lib/utils";

const SOURCE_ICONS = {
  Standup: Users,
  Slack: MessagesSquare,
  Email: Mail,
  "Jira Comment": StickyNote,
  Teams: MessageSquare,
  "Document Upload": Upload,
};

const SOURCE_ORDER = ["Standup", "Slack", "Email", "Jira Comment", "Teams", "Document Upload"];

// IST (+05:30) calendar day, so Signal Analytics' date-range params (from/to) resolve to the same day as the feed.
function dateKey(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
}

// Formats a "YYYY-MM-DD" key for display, anchored to UTC so the host's own timezone cannot shift the day.
function formatDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const REVIEW_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending review" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
];

export function SignalFeed({
  signals,
  loading,
  error,
  onRetry,
  requirements = [],
  projectId,
  onSelectRequirement,
  onChanged,
  isPM,
  highlightSignalId,
  presetFilters,
  onClearPresetFilters,
  presetReview,
}) {
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [reviewFilter, setReviewFilter] = useState(presetReview ?? "all");
  const [dateRange, setDateRange] = useState(null); // { from, to } as "YYYY-MM-DD", or null
  const [showSuppressed, setShowSuppressed] = useState(false); // repeats of a rejected requirement candidate
  const [busyId, setBusyId] = useState(null);
  const [correcting, setCorrecting] = useState(null); // { id, label, requirementId }
  const [notice, setNotice] = useState(null); // { tone: "ok" | "warn" | "error", text }
  const highlightRef = useRef(null);

  // A "?review=pending" deep link (for example from a notification) opens the feed on the pending filter.
  useEffect(() => {
    if (presetReview) setReviewFilter(presetReview);
  }, [presetReview]);

  // A deep link from Signal Analytics or the Alignment page lands here with a signal to surface, or a
  // classification/source/date-range to pre-apply: the same filters a user could set by hand.
  useEffect(() => {
    if (highlightSignalId) {
      setSearch("");
      setClassFilter("all");
      setSourceFilter("all");
      setReviewFilter("all");
      setDateRange(null);
      return;
    }
    if (presetFilters) {
      setSearch("");
      setClassFilter(presetFilters.classification ?? "all");
      setSourceFilter(presetFilters.source ?? "all");
      setDateRange(presetFilters.from ? { from: presetFilters.from, to: presetFilters.to ?? presetFilters.from } : null);
    }
    // Depends on the individual fields: the caller rebuilds `presetFilters` on every render, so keying off its
    // reference would re-apply (and wipe a manual edit) on each unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightSignalId, presetFilters?.classification, presetFilters?.source, presetFilters?.from, presetFilters?.to]);

  useEffect(() => {
    if (!highlightSignalId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightSignalId, loading]);

  const requirementById = useMemo(() => new Map(requirements.map((r) => [r.id, r])), [requirements]);
  const suppressedCount = useMemo(() => signals.filter((s) => s.suppressed).length, [signals]);
  // Suppressed repeats are not counted as pending and are hidden unless the toggle is on.
  const pendingCount = useMemo(() => signals.filter((s) => s.reviewStatus === "pending" && !s.suppressed).length, [signals]);

  const clearFilters = () => {
    setClassFilter("all");
    setSourceFilter("all");
    setDateRange(null);
    onClearPresetFilters?.();
  };

  const filtered = useMemo(() => {
    return signals
      .filter((s) => showSuppressed || !s.suppressed)
      .filter((s) => (reviewFilter === "all" ? true : s.reviewStatus === reviewFilter))
      .filter((s) => (classFilter === "all" ? true : s.classification === classFilter))
      .filter((s) => (sourceFilter === "all" ? true : s.source === sourceFilter))
      .filter((s) => (dateRange ? dateKey(s.timestamp) >= dateRange.from && dateKey(s.timestamp) <= dateRange.to : true))
      .filter((s) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return s.text.toLowerCase().includes(q) || (s.channel ?? "").toLowerCase().includes(q);
      });
  }, [signals, search, classFilter, sourceFilter, reviewFilter, dateRange, showSuppressed]);

  const presetActive = classFilter !== "all" || sourceFilter !== "all" || Boolean(dateRange);
  const availableSources = useMemo(() => SOURCE_ORDER.filter((src) => signals.some((s) => s.source === src)), [signals]);

  // One review call. The API answer says what happened (including statusNotReversed for feedback on auto-applied signals).
  const review = async (signal, body) => {
    setBusyId(signal.id);
    setNotice(null);
    try {
      const res = await reviewSignal(projectId, signal.id, body);
      setNotice({ tone: res.statusNotReversed ? "warn" : "ok", text: `${signal.id}: ${res.message}` });
      setCorrecting(null);
      onChanged?.();
    } catch (err) {
      setNotice({ tone: "error", text: `${signal.id}: ${err.message}` });
    } finally {
      setBusyId(null);
    }
  };

  const startCorrect = (signal) =>
    setCorrecting({ id: signal.id, label: signal.classification ?? "", requirementId: signal.mappedRequirementId ?? "" });

  const applyCorrect = (signal) => {
    const body = { action: "correct" };
    if (correcting.label && correcting.label !== signal.classification) body.correctedLabel = correcting.label;
    if (correcting.requirementId && correcting.requirementId !== signal.mappedRequirementId) body.correctedRequirementId = correcting.requirementId;
    if (!signal.classification && correcting.label) body.correctedLabel = correcting.label;
    if (!body.correctedLabel && !body.correctedRequirementId) {
      setNotice({ tone: "error", text: `${signal.id}: choose a different label or requirement to correct it.` });
      return;
    }
    review(signal, body);
  };

  return (
    <div className="space-y-4">
      <SignalSubmitPanel
        projectId={projectId}
        requirements={requirements}
        onSubmitted={() => onChanged?.()}
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search signal text or channel…"
          className="sm:flex-1"
        />
        <Select value={classFilter} onValueChange={setClassFilter}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Classification" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All classifications</SelectItem>
            {CLASSIFICATIONS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {availableSources.map((src) => (
              <SelectItem key={src} value={src}>
                {src}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex shrink-0 gap-2">
          {/* Any project member can upload: it finds signals, lets you review them, then saves the approved ones. */}
          <UploadDocumentDialog projectId={projectId} requirements={requirements} onDone={onChanged} />
        </div>
      </div>

      {/* Easy review-status filter: "Pending review" is one click away, with a live count. */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Review status filter">
        {REVIEW_FILTERS.map((f) => {
          const active = reviewFilter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setReviewFilter(f.key)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {f.label}
              {f.key === "pending" && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-semibold",
                    active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-status-atrisk-bg text-status-atrisk-fg"
                  )}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {suppressedCount > 0 && (
        <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showSuppressed} onChange={(e) => setShowSuppressed(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
          Show suppressed ({suppressedCount}): repeats of a rejected requirement candidate
        </label>
      )}

      {presetActive && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          <Filter className="h-3.5 w-3.5 shrink-0" />
          <span>
            Filtered from Signal Analytics
            {classFilter !== "all" && `, ${classFilter}`}
            {sourceFilter !== "all" && `, ${sourceFilter}`}
            {dateRange && `, ${formatDateKey(dateRange.from)}${dateRange.to !== dateRange.from ? ` – ${formatDateKey(dateRange.to)}` : ""}`}
          </span>
          <button onClick={clearFilters} className="ml-auto shrink-0 font-medium hover:underline">
            Clear
          </button>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            notice.tone === "error" && "border-status-dropped-fg/30 bg-status-dropped-bg text-status-dropped-fg",
            notice.tone === "warn" && "border-status-atrisk-fg/30 bg-status-atrisk-bg text-status-atrisk-fg",
            notice.tone === "ok" && "border-status-confirmed-fg/30 bg-status-confirmed-bg text-status-confirmed-fg"
          )}
        >
          {notice.tone === "ok" ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="space-y-3">
        {loading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </div>
          ))}

        {!loading && error && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
            <AlertCircle className="h-5 w-5 text-status-dropped-fg" />
            <p className="text-sm text-foreground">Could not load the signal feed.</p>
            <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
            {onRetry && (
              <button onClick={onRetry} className="text-sm font-medium text-primary hover:underline">
                Try again
              </button>
            )}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            {reviewFilter === "pending" && signals.length > 0 ? "Nothing is waiting for review." : "No signals match the current filters."}
          </div>
        )}

        {!loading &&
          !error &&
          filtered.map((signal) => {
            const SourceIcon = SOURCE_ICONS[signal.source] ?? MessageSquare;
            const mapped = signal.mappedRequirementId ? requirementById.get(signal.mappedRequirementId) : null;
            const isPending = signal.reviewStatus === "pending";
            const isRejected = signal.reviewStatus === "rejected";
            const isHighlighted = signal.id === highlightSignalId;
            // Auto-accepted signals created through the API can still be rejected/corrected, as feedback only.
            const feedbackOnly = !isPending && !signal.seeded && signal.reviewStatus === "accepted" && !signal.reviewAction;
            const busy = busyId === signal.id;
            const isCorrecting = correcting?.id === signal.id;

            return (
              <div
                key={signal.id}
                ref={isHighlighted ? highlightRef : undefined}
                className={cn(
                  "rounded-xl border bg-card p-4 transition-shadow hover:shadow-sm animate-slide-up",
                  isPending ? "border-primary/30 bg-primary/[0.03]" : "border-border",
                  isRejected && "opacity-60",
                  isHighlighted && "ring-2 ring-primary border-primary/40"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
                      <SourceIcon className="h-3.5 w-3.5" />
                    </span>
                    <span className="font-medium text-foreground">{signal.author}</span>
                    <span className="hidden sm:inline">· {signal.channel}</span>
                    <span>· {formatRelativeTime(signal.timestamp)}</span>
                    <span className="hidden font-mono text-[11px] sm:inline">· {signal.id}</span>
                    {signal.sourceDocument?.name && (
                      <span
                        className="hidden max-w-[11rem] truncate rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground sm:inline"
                        title={`From the document "${signal.sourceDocument.name}"`}
                      >
                        from {signal.sourceDocument.name}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isPending && (
                      <Badge variant="warning" className="text-[10px]">
                        Pending Review
                      </Badge>
                    )}
                    {isRejected && (
                      <Badge variant="danger" className="text-[10px]">
                        Rejected
                      </Badge>
                    )}
                    {signal.suppressed ? (
                      <Badge variant="secondary" className="text-[10px]" title="Very similar to a requirement candidate a PM rejected, so no candidate was created">
                        Suppressed: similar to a rejected candidate
                      </Badge>
                    ) : (
                      <NewRequirementTag nr={signal.newRequirement} />
                    )}
                    {signal.candidateId && !signal.suppressed && (
                      <Badge variant="outline" className="font-mono text-[10px]" title="Evidence for this requirement candidate">
                        {signal.candidateId}
                      </Badge>
                    )}
                    {signal.applied && (
                      <Badge variant="success" className="text-[10px]">
                        Applied{signal.proposedStatus ? `: ${signal.proposedStatus}` : ""}
                      </Badge>
                    )}
                    {signal.classification ? (
                      <ClassificationBadge classification={signal.classification} />
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        Unclassified
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-foreground/90">"{signal.text}"</p>

                {signal.statusNotReversed && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-status-atrisk-fg/30 bg-status-atrisk-bg px-3 py-2 text-xs text-status-atrisk-fg">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    This signal was auto-applied before a PM {signal.reviewAction === "reject" ? "rejected" : "corrected"} it. The status change and
                    ledger entry were NOT reversed; the review is recorded as feedback only.
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  {signal.confidence != null ? (
                    <ConfidenceMeter value={signal.confidence} />
                  ) : (
                    <span className="text-xs text-muted-foreground">Confidence: – (dataset signal)</span>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {mapped ? (
                      <button
                        onClick={() => onSelectRequirement(mapped.id)}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                      >
                        <span className="font-mono">{mapped.id}</span>
                        <span className="hidden sm:inline">· {mapped.title}</span>
                        {signal.matchSimilarity != null && <span className="text-[10px] opacity-70">· {signal.matchSimilarity.toFixed(2)}</span>}
                      </button>
                    ) : signal.mappedRequirementId ? (
                      <button
                        onClick={() => onSelectRequirement(signal.mappedRequirementId)}
                        className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 font-mono text-xs font-medium text-primary hover:bg-primary/20"
                      >
                        {signal.mappedRequirementId}
                      </button>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        Unmatched
                      </span>
                    )}

                    {isPM && (isPending || feedbackOnly) && !isCorrecting && (
                      <div className="flex items-center gap-1.5">
                        {isPending && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            className="h-7 gap-1 border-status-confirmed-fg/40 px-2 text-status-confirmed-fg hover:bg-status-confirmed-bg"
                            onClick={() => review(signal, { action: "accept" })}
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Accept
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          className="h-7 gap-1 border-status-dropped-fg/40 px-2 text-status-dropped-fg hover:bg-status-dropped-bg"
                          onClick={() => review(signal, { action: "reject" })}
                        >
                          <X className="h-3.5 w-3.5" />
                          Reject{feedbackOnly ? " (feedback only)" : ""}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} className="h-7 gap-1 px-2" onClick={() => startCorrect(signal)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Correct{feedbackOnly ? " (feedback only)" : ""}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {isCorrecting && (
                  <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-xs font-medium text-foreground">
                      Correct this signal
                      {feedbackOnly && " (it was already auto-applied: the status change will NOT be reversed)"}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Label</label>
                        <Select value={correcting.label || undefined} onValueChange={(v) => setCorrecting((c) => ({ ...c, label: v }))}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Choose a label" />
                          </SelectTrigger>
                          <SelectContent>
                            {CLASSIFICATIONS.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          Requirement{!signal.mappedRequirementId ? " (needed: this signal is unmapped)" : ""}
                        </label>
                        <Select value={correcting.requirementId || undefined} onValueChange={(v) => setCorrecting((c) => ({ ...c, requirementId: v }))}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Choose a requirement" />
                          </SelectTrigger>
                          <SelectContent>
                            {requirements.map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.id} · {r.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" className="h-7" onClick={() => setCorrecting(null)} disabled={busy}>
                        Cancel
                      </Button>
                      <Button size="sm" className="h-7" onClick={() => applyCorrect(signal)} disabled={busy}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Apply correction
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} of {signals.length} signals
        </p>
      )}
    </div>
  );
}
