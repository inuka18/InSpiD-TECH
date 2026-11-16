import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Eye, Info } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { ClassificationBadge } from "./ClassificationBadge";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { StatusBadge } from "./StatusBadge";
import { cn } from "../../../lib/utils";

// Plain-English reason a signal goes to a PM instead of being applied automatically.
function reasonText(r) {
  switch (r.reviewReason) {
    case "low-confidence":
      return `the classifier's confidence is below the auto-accept threshold of ${r.autoAcceptThreshold}%`;
    case "unmapped":
      return `no requirement matched with similarity of at least ${r.matchMinSimilarity}`;
    case "low-similarity":
      return `the match similarity is below ${r.autoApplyMinSimilarity} (the minimum for applying a match automatically)`;
    case "proposes-drop":
      return "it would drop a requirement, which always needs a PM decision";
    case "unclassified":
      return "the classifier was unavailable";
    case "concurrent-update":
      return "the requirement changed at the same moment";
    default:
      return "it needs a PM decision";
  }
}

// The answer for one message, from POST .../signals/preview (nothing saved) or POST .../signals (saved).
export function SignalResultCard({ result, requirements = [], onClose }) {
  if (!result) return null;
  const { classification, match, preview, applied, wouldApply, statusChange, ledgerEntry, signal } = result;
  const matchedReq = match?.requirementId ? requirements.find((q) => q.id === match.requirementId) : null;
  const toReview = result.reviewStatus === "pending";
  const unclassified = classification?.label == null;

  let outcome;
  if (preview) {
    outcome = wouldApply
      ? { icon: CheckCircle2, tone: "text-status-confirmed-fg", text: "Would be applied automatically." }
      : result.reviewStatus === "accepted"
        ? { icon: CheckCircle2, tone: "text-status-confirmed-fg", text: "Would be accepted automatically (nothing to apply)." }
        : { icon: Clock3, tone: "text-status-atrisk-fg", text: `Would go to PM review: ${reasonText(result)}.` };
  } else if (applied) {
    outcome = { icon: CheckCircle2, tone: "text-status-confirmed-fg", text: "Applied automatically." };
  } else if (toReview) {
    outcome = { icon: Clock3, tone: "text-status-atrisk-fg", text: `Waiting for PM review: ${reasonText(result)}.` };
  } else {
    outcome = { icon: CheckCircle2, tone: "text-status-confirmed-fg", text: "Accepted automatically. Nothing to apply." };
  }
  const OutcomeIcon = outcome.icon;

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
          {preview ? <Eye className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {preview ? "Preview (nothing saved)" : `Submitted${signal ? ` as ${signal.id}` : ""}`}
        </span>
        {onClose && (
          <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        )}
      </div>

      {result.message && (
        <div className="flex items-start gap-2 rounded-lg border border-status-atrisk-fg/30 bg-status-atrisk-bg px-3 py-2 text-sm text-status-atrisk-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{result.message}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Classification</p>
          <div className="flex flex-wrap items-center gap-3">
            {unclassified ? (
              <Badge variant="secondary">Unclassified</Badge>
            ) : (
              <ClassificationBadge classification={classification.label} />
            )}
            {classification?.confidence != null && <ConfidenceMeter value={classification.confidence} />}
          </div>
          {classification?.modelVersion && (
            <p className="text-[11px] text-muted-foreground">Model {classification.modelVersion}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Matched requirement</p>
          {match?.requirementId ? (
            <p className="text-sm text-foreground">
              <span className="font-mono text-xs font-medium text-primary">{match.requirementId}</span>
              {matchedReq && <span className="text-muted-foreground"> · {matchedReq.title}</span>}
              <span className="ml-2 text-xs text-muted-foreground">
                {match.similarity != null ? `similarity ${match.similarity.toFixed(2)}` : "chosen by you"}
              </span>
            </p>
          ) : classification?.label === "None" ? (
            <p className="text-sm text-muted-foreground">Not needed (not a requirement signal).</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No requirement matched
              {match?.similarity != null ? ` (best similarity ${match.similarity.toFixed(2)})` : ""}.
            </p>
          )}
          {match?.alternatives?.length > 1 && (
            <p className="text-[11px] text-muted-foreground">
              Next best: {match.alternatives.slice(1).map((a) => `${a.requirementId} (${a.similarity.toFixed(2)})`).join(", ")}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-border pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Proposed status</p>
        {result.proposedStatus ? (
          <div className="flex flex-wrap items-center gap-2">
            {matchedReq && <StatusBadge status={matchedReq.liveStatus} />}
            {matchedReq && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <StatusBadge status={result.proposedStatus} />
            {statusChange ? (
              <span className="text-xs text-muted-foreground">
                {applied || preview ? `${statusChange.from} → ${statusChange.to}` : ""}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">no change to the current status</span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">None (this message does not change a status).</p>
        )}
        <p className={cn("flex items-center gap-1.5 text-sm font-medium", outcome.tone)}>
          <OutcomeIcon className="h-4 w-4 shrink-0" />
          {outcome.text}
        </p>
        {ledgerEntry && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Ledger block #{ledgerEntry.blockNumber} written (local hash chain).
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          Auto-accept needs confidence ≥ {result.autoAcceptThreshold}% and, for a similarity match, similarity ≥ {result.autoApplyMinSimilarity}.
        </p>
      </div>
    </div>
  );
}
