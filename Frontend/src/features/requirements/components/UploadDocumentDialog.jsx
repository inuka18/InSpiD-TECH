import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock3, Loader2, MinusCircle, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { ClassificationBadge } from "./ClassificationBadge";
import { StatusBadge } from "./StatusBadge";
import { bulkSubmitSignals, extractSignals } from "../../../services/signalsService";
import { cn } from "../../../lib/utils";

const SOURCES = ["Standup", "Slack", "Email", "Teams", "Jira Comment"];
const NO_MATCH = "__none__"; // Radix Select cannot hold an empty value
const MAX_ITEMS = 100;
const ACCEPT = ".txt,.md,.markdown,.docx,.pdf";

const reasonText = {
  "low-confidence": "confidence below the auto-accept threshold",
  unmapped: "no requirement matched",
  "low-similarity": "match similarity too low to apply automatically",
  "proposes-drop": "it would drop a requirement",
  "none-confident": "no signal",
};

// Upload a document, find the signals in it, review them, and save the approved ones through the normal signal flow.
// Stages: input -> finding -> results -> submitting -> done.  Labels are NOT editable here: a PM corrects them afterwards.
export function UploadDocumentDialog({ projectId, requirements = [], onDone }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState("input");
  const [tab, setTab] = useState("file");
  const [file, setFile] = useState(null);
  const [pasted, setPasted] = useState("");
  const [source, setSource] = useState("Standup");
  const [authorRole, setAuthorRole] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [error, setError] = useState("");
  const [extracted, setExtracted] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [matchChoice, setMatchChoice] = useState({}); // segment index -> requirement id or NO_MATCH
  const [showNone, setShowNone] = useState(false);
  const [forceConfirmed, setForceConfirmed] = useState(false);
  const [outcome, setOutcome] = useState(null);

  const titleOf = useMemo(() => new Map(requirements.map((r) => [r.id, r.title])), [requirements]);

  const reset = () => {
    setStage("input");
    setFile(null);
    setPasted("");
    setError("");
    setExtracted(null);
    setSelected(new Set());
    setMatchChoice({});
    setShowNone(false);
    setForceConfirmed(false);
    setOutcome(null);
  };

  const handleOpenChange = (next) => {
    if (!next && stage === "submitting") return; // do not close in the middle of saving
    if (!next && stage === "done") onDone?.();
    setOpen(next);
    if (!next) reset();
  };

  const canFind = tab === "file" ? Boolean(file) : pasted.trim().length > 0;

  const handleFind = async () => {
    setStage("finding");
    setError("");
    try {
      const res = await extractSignals(projectId, {
        file: tab === "file" ? file : null,
        text: tab === "paste" ? pasted : undefined,
        name: tab === "paste" ? "Pasted text" : undefined,
        source,
        authorRole,
        documentDate: documentDate || undefined,
      });
      setExtracted(res);
      // Signals are checked by default, segments with no signal are not.
      setSelected(new Set(res.segments.filter((s) => s.label !== "None").map((s) => s.index)));
      setMatchChoice(Object.fromEntries(res.segments.map((s) => [s.index, s.match?.requirementId ?? NO_MATCH])));
      setForceConfirmed(false);
      setStage("results");
    } catch (err) {
      setError(err.message || "Could not read the document.");
      setStage("input");
    }
  };

  const toggle = (index) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const visible = extracted ? extracted.segments.filter((s) => showNone || s.label !== "None") : [];
  const chosenItems = extracted ? extracted.segments.filter((s) => selected.has(s.index)) : [];
  const tooMany = chosenItems.length > MAX_ITEMS;
  const needsForce = Boolean(extracted?.alreadySubmitted);
  const canSubmit = chosenItems.length > 0 && !tooMany && (!needsForce || forceConfirmed);

  const handleSubmit = async () => {
    setStage("submitting");
    setError("");
    try {
      const items = chosenItems.map((s) => {
        const choice = matchChoice[s.index];
        const original = s.match?.requirementId ?? NO_MATCH;
        // Only a CHANGED match is sent: it then counts as the user's own choice. Unchanged rows go through normal matching.
        return choice && choice !== NO_MATCH && choice !== original ? { text: s.text, requirementId: choice } : { text: s.text };
      });
      const res = await bulkSubmitSignals(projectId, {
        documentId: extracted.documentId,
        name: extracted.name,
        source,
        authorRole: authorRole.trim() || undefined,
        timestamp: documentDate ? new Date(`${documentDate}T09:00:00`).toISOString() : undefined,
        items,
        force: needsForce ? true : undefined,
      });
      setOutcome(res);
      setStage("done");
      onDone?.(); // refresh the feed and the requirement statuses
    } catch (err) {
      setError(err.message || "Could not save the signals.");
      setStage("results");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4" />
          Upload Document
        </Button>
      </DialogTrigger>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto", stage === "results" || stage === "done" ? "sm:max-w-5xl" : "sm:max-w-xl")}>
        <DialogHeader>
          <DialogTitle>
            {stage === "done" ? "Signals saved" : stage === "results" || stage === "submitting" ? "Review the signals found" : "Find signals in a document"}
          </DialogTitle>
          <DialogDescription>
            Meeting notes, standup notes, an email or retrospective notes. Nothing is saved until you submit the ones you approve.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md border border-dashed border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary">
          Signals are suggestions. Review before relying on them.
        </p>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ---------------------------------------------------------------- input */}
        {(stage === "input" || stage === "finding") && (
          <div className="space-y-4">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="file">File</TabsTrigger>
                <TabsTrigger value="paste">Paste text</TabsTrigger>
              </TabsList>
              <TabsContent value="file" className="mt-3 space-y-1.5">
                <Label htmlFor="doc-file">File (.txt, .md, .docx or .pdf, up to 2 MB)</Label>
                <Input id="doc-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                <p className="text-xs text-muted-foreground">The file is read once to find statements; it is not stored.</p>
              </TabsContent>
              <TabsContent value="paste" className="mt-3 space-y-1.5">
                <Label htmlFor="doc-text">Text</Label>
                <Textarea id="doc-text" rows={8} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the notes or the email here" />
              </TabsContent>
            </Tabs>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="doc-source">Source</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger id="doc-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-role">Author role (optional)</Label>
                <Input id="doc-role" value={authorRole} onChange={(e) => setAuthorRole(e.target.value)} placeholder="Defaults to your job title" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-date">Document date (optional)</Label>
                <Input id="doc-date" type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="button" disabled={!canFind || stage === "finding"} onClick={handleFind}>
                {stage === "finding" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {stage === "finding" ? "Finding signals…" : "Find signals"}
              </Button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- results */}
        {(stage === "results" || stage === "submitting") && extracted && (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              <span className="font-medium">{extracted.name}</span>: {extracted.counts.total} segment{extracted.counts.total === 1 ? "" : "s"},{" "}
              {extracted.counts.signals} signal{extracted.counts.signals === 1 ? "" : "s"} found, {extracted.counts.none} with no signal.
            </p>

            {needsForce && (
              <div className="flex items-start gap-2 rounded-lg border border-status-atrisk-fg/30 bg-status-atrisk-bg px-3 py-2 text-sm text-status-atrisk-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1.5">
                  <p className="font-medium">Already submitted before</p>
                  <p>This exact document was already submitted to this project. Submitting it again creates the signals a second time.</p>
                  <label className="flex items-center gap-2 text-foreground">
                    <input type="checkbox" checked={forceConfirmed} onChange={(e) => setForceConfirmed(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                    Submit it again anyway
                  </label>
                </div>
              </div>
            )}

            {extracted.counts.total === 0 ? (
              <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                No statements were found in this document (short lines, headers, greetings and sign-offs are ignored).
              </div>
            ) : (
              <>
                <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={showNone} onChange={(e) => setShowNone(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
                  Show segments with no signal ({extracted.counts.none})
                </label>

                <div className="max-h-[48vh] overflow-auto rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="w-9 px-3 py-2" />
                        <th className="w-10 px-2 py-2">Line</th>
                        <th className="px-2 py-2">Segment</th>
                        <th className="px-2 py-2">Label</th>
                        <th className="px-2 py-2">Match</th>
                        <th className="px-2 py-2">Proposed</th>
                        <th className="px-2 py-2">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                            No signals here. Tick "Show segments with no signal" to see everything that was found.
                          </td>
                        </tr>
                      )}
                      {visible.map((s) => {
                        const isSignal = s.label !== "None";
                        const choice = matchChoice[s.index];
                        const original = s.match?.requirementId ?? NO_MATCH;
                        const changed = isSignal && choice !== original;
                        const options = s.match?.alternatives ?? [];
                        return (
                          <tr key={s.index} className={cn("border-t border-border align-top", !selected.has(s.index) && "opacity-60")}>
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selected.has(s.index)}
                                onChange={() => toggle(s.index)}
                                disabled={stage === "submitting"}
                                aria-label={`Include line ${s.line}`}
                                className="h-3.5 w-3.5 accent-primary"
                              />
                            </td>
                            <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{s.line}</td>
                            <td className="max-w-md px-2 py-2">
                              {s.speakerLabel && <span className="mr-1.5 text-[11px] font-medium text-muted-foreground">{s.speakerLabel}:</span>}
                              <span className="text-foreground/90">{s.text}</span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-2">
                              <ClassificationBadge classification={s.label} />
                              <span className="ml-1.5 text-xs text-muted-foreground">{s.confidence}%</span>
                            </td>
                            <td className="min-w-[11rem] px-2 py-2">
                              {isSignal ? (
                                <Select
                                  value={choice ?? NO_MATCH}
                                  onValueChange={(v) => setMatchChoice((m) => ({ ...m, [s.index]: v }))}
                                  disabled={stage === "submitting"}
                                >
                                  <SelectTrigger className="h-8 text-xs" aria-label={`Matched requirement for line ${s.line}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NO_MATCH}>No match</SelectItem>
                                    {options.map((a) => (
                                      <SelectItem key={a.requirementId} value={a.requirementId}>
                                        {a.requirementId} · {titleOf.get(a.requirementId) ?? ""} ({a.similarity.toFixed(2)})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2">
                              {isSignal && s.proposedStatus && !changed ? <StatusBadge status={s.proposedStatus} /> : <span className="text-xs text-muted-foreground">{changed ? "set on submit" : "-"}</span>}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2">
                              {!isSignal ? (
                                <span className="text-xs text-muted-foreground">No signal</span>
                              ) : changed ? (
                                <Badge variant="outline" className="text-[10px]">Match changed</Badge>
                              ) : s.wouldAutoApply ? (
                                <Badge variant="success" className="text-[10px]">Auto-apply</Badge>
                              ) : (
                                <span title={reasonText[s.reviewReason] ?? ""}>
                                  <Badge variant="warning" className="text-[10px]">Needs review</Badge>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {tooMany && (
                  <p className="text-sm text-status-dropped-fg">
                    {chosenItems.length} selected: at most {MAX_ITEMS} can be submitted at once. Untick some, or split the document.
                  </p>
                )}
              </>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <Button type="button" variant="outline" onClick={reset} disabled={stage === "submitting"}>
                Start over
              </Button>
              <Button type="button" disabled={!canSubmit || stage === "submitting"} onClick={handleSubmit}>
                {stage === "submitting" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit {chosenItems.length} selected
              </Button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- done */}
        {stage === "done" && outcome && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { key: "applied", label: "Applied", icon: CheckCircle2, tone: "text-status-confirmed-fg" },
                { key: "pending", label: "Pending review", icon: Clock3, tone: "text-status-atrisk-fg" },
                { key: "noChange", label: "No change", icon: MinusCircle, tone: "text-muted-foreground" },
                { key: "failed", label: "Failed", icon: AlertCircle, tone: "text-status-dropped-fg" },
              ].map(({ key, label, icon: Icon, tone }) => (
                <div key={key} className="rounded-xl border border-border p-3">
                  <p className={cn("flex items-center gap-1.5 text-xs font-medium", tone)}>
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{outcome.summary[key]}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              The feed and the requirement statuses have been refreshed. Signals waiting for review are under "Pending review" in the Signal Feed, where a PM can accept, reject or correct them.
            </p>
            {outcome.summary.failed > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-status-dropped-fg">Could not save {outcome.summary.failed}:</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {outcome.results.filter((r) => r.status === "failed").map((r) => (
                    <li key={r.index} className="rounded-md border border-status-dropped-fg/30 bg-status-dropped-bg px-2.5 py-1.5 text-status-dropped-fg">
                      <span className="font-medium">{r.error}</span>
                      <span className="block truncate text-xs opacity-80">{r.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
