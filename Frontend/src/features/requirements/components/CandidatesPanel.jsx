import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, CheckCircle2, Flag, GitMerge, Loader2, Network, Sparkles, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { Badge } from "../../../components/ui/badge";
import { Skeleton } from "../../../components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { reviewCandidate } from "../../../services/signalsService";
import { createBaseline } from "../../../services/alignmentService";
import { formatRelativeTime } from "../../../lib/utils";

const PRIORITIES = ["High", "Medium", "Low"];

// After approving: the new requirement id, the alignment note, a link to the Network Map and the Freeze baseline button.
function ApprovedNotice({ info, projectId, onDismiss }) {
  const [freezing, setFreezing] = useState(false);
  const [name, setName] = useState(`With ${info.requirementId}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [frozen, setFrozen] = useState(null);

  const freeze = async () => {
    setBusy(true);
    setError(null);
    try {
      const b = await createBaseline(projectId, name.trim());
      setFrozen(b.name ?? name.trim());
      setFreezing(false);
    } catch (err) {
      setError(err.message || "Could not freeze the baseline.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="space-y-2 rounded-xl border border-status-confirmed-fg/30 bg-status-confirmed-bg px-4 py-3 text-sm text-status-confirmed-fg">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <p className="font-medium">
            Requirement <span className="font-mono">{info.requirementId}</span> was created from {info.candidateId}.
          </p>
          <p className="text-xs">The alignment score will drop until you freeze a new baseline.</p>
        </div>
        <button onClick={onDismiss} className="shrink-0 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Link to={`/projects/${projectId}/requirements/network-map`} className="inline-flex items-center gap-1 text-xs font-medium underline">
          <Network className="h-3.5 w-3.5" /> Open the Network Map
        </Link>
        {info.isPM && !frozen && !freezing && (
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setFreezing(true)}>
            <Flag className="h-3.5 w-3.5" /> Freeze baseline
          </Button>
        )}
        {frozen && <span className="text-xs font-medium">Baseline "{frozen}" frozen.</span>}
      </div>
      {freezing && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-8 w-56 text-xs" aria-label="Baseline name" />
          <Button size="sm" className="h-7 text-xs" onClick={freeze} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Freeze
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFreezing(false)} disabled={busy}>
            Cancel
          </Button>
          {error && <span className="text-xs text-status-dropped-fg">{error}</span>}
        </div>
      )}
    </div>
  );
}

function CandidateCard({ candidate, requirements, projectId, isPM, onDecided, onError }) {
  const [title, setTitle] = useState(candidate.title);
  const [description, setDescription] = useState(candidate.description);
  const [type, setType] = useState(candidate.type);
  const [priority, setPriority] = useState("Medium");
  const [mergeInto, setMergeInto] = useState("");
  const [busy, setBusy] = useState(null); // "approve" | "merge" | "reject"
  const closest = candidate.closestRequirementId ? requirements.find((r) => r.id === candidate.closestRequirementId) : null;

  const act = async (action) => {
    setBusy(action);
    onError(null);
    try {
      const body = { action };
      if (action === "approve") Object.assign(body, { title: title.trim(), description: description.trim(), type, priority });
      if (action === "merge") body.mergeIntoRequirementId = mergeInto;
      const res = await reviewCandidate(projectId, candidate.id, body);
      onDecided(action, candidate, res);
    } catch (err) {
      onError(`${candidate.id}: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="space-y-3 rounded-xl border border-primary/30 bg-primary/[0.03] p-4" aria-label={`Candidate ${candidate.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="gap-1 border-primary/40 font-mono text-[10px] text-primary">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {candidate.id}
        </Badge>
        <span>
          Mentioned {candidate.mentions} {candidate.mentions === 1 ? "time" : "times"}
        </span>
        {candidate.novelTokens?.length > 0 && <span>· new terms: {candidate.novelTokens.join(", ")}</span>}
        <span>· found {formatRelativeTime(candidate.createdAt)}</span>
      </div>

      {isPM ? (
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label="Title" className="font-medium" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={2} aria-label="Description" />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Type
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="h-8 w-24 text-xs" aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FR">FR</SelectItem>
                  <SelectItem value="NFR">NFR</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Priority
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="h-8 w-28 text-xs" aria-label="Priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">{candidate.title}</h3>
          <p className="text-sm text-foreground/80">{candidate.description}</p>
          <p className="text-xs text-muted-foreground">Type {candidate.type}</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {candidate.closestRequirementId ? (
          <>
            Closest existing requirement: <span className="font-mono font-medium text-foreground">{candidate.closestRequirementId}</span>
            {closest && ` · ${closest.title}`}
            {candidate.closestSimilarity != null && ` (similarity ${candidate.closestSimilarity.toFixed(2)})`}
          </>
        ) : (
          "No existing requirement is close."
        )}
      </p>

      <div>
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Evidence</p>
        <ul className="space-y-1.5">
          {candidate.evidence.map((e) => (
            <li key={e.signalId} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <span className="text-foreground/90">"{e.text}"</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {e.authorRole} · {e.source} · {formatRelativeTime(e.timestamp)} · <span className="font-mono">{e.signalId}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {isPM ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="sm" disabled={busy !== null || title.trim().length < 3} onClick={() => act("approve")} className="gap-1">
            {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve and create
          </Button>
          <div className="flex items-center gap-1.5">
            <Select value={mergeInto || undefined} onValueChange={setMergeInto}>
              <SelectTrigger className="h-8 w-56 text-xs" aria-label="Merge into requirement">
                <SelectValue placeholder="Merge into…" />
              </SelectTrigger>
              <SelectContent>
                {requirements.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.id} · {r.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={busy !== null || !mergeInto} onClick={() => act("merge")} className="gap-1">
              {busy === "merge" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
              Merge
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => act("reject")}
            className="ml-auto gap-1 border-status-dropped-fg/40 text-status-dropped-fg hover:bg-status-dropped-bg"
          >
            {busy === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Reject
          </Button>
        </div>
      ) : (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">Only a project manager can approve, merge or reject a candidate.</p>
      )}
    </article>
  );
}

// "New requirement candidates": signals no existing requirement covers. Nothing changes until a PM decides.
export function CandidatesPanel({ candidates, loading, error, onRetry, requirements = [], projectId, isPM, onChanged }) {
  const [notice, setNotice] = useState(null); // approved: { candidateId, requirementId } | other: { text }
  const [actionError, setActionError] = useState(null);

  const decided = (action, candidate, res) => {
    if (action === "approve") setNotice({ kind: "approved", candidateId: candidate.id, requirementId: res.requirement?.id ?? res.candidate.createdRequirementId, isPM });
    else setNotice({ kind: "text", text: `${candidate.id}: ${res.message}` });
    onChanged?.(); // reloads candidates, signals, requirements (the ledger and network reload when opened)
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Confident Expectations that no existing requirement covers. Repeated mentions are grouped into one candidate. Nothing changes in the
        requirements until a project manager approves, merges or rejects it.
      </p>

      {notice?.kind === "approved" && <ApprovedNotice info={notice} projectId={projectId} onDismiss={() => setNotice(null)} />}
      {notice?.kind === "text" && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-status-confirmed-fg/30 bg-status-confirmed-bg px-3 py-2 text-sm text-status-confirmed-fg">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {actionError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {loading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-8 w-full" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        ))}

      {!loading && error && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
          <AlertCircle className="h-5 w-5 text-status-dropped-fg" />
          <p className="text-sm text-foreground">Could not load the requirement candidates.</p>
          <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
          {onRetry && <button onClick={onRetry} className="text-sm font-medium text-primary hover:underline">Try again</button>}
        </div>
      )}

      {!loading && !error && candidates.length === 0 && (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No new requirement candidates are waiting.
        </div>
      )}

      {!loading && !error && candidates.map((c) => (
        <CandidateCard key={c.id} candidate={c} requirements={requirements} projectId={projectId} isPM={isPM} onDecided={decided} onError={setActionError} />
      ))}
    </div>
  );
}
