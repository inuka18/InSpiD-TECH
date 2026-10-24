import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, AlertTriangle, CheckCircle2, FileText, Loader2, Network, UploadCloud } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Textarea } from "../../../components/ui/textarea";
import { Badge } from "../../../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { SrsTemplateLink } from "./SrsTemplateLink";
import { previewSrs, confirmSrsImport } from "../../../services/requirementsService";
import { cn } from "../../../lib/utils";

const ACCEPT = ".docx,.md,.markdown,.txt,.pdf";
const MAX_BYTES = 2 * 1024 * 1024;
const NONE = "none";
const PRIORITIES = ["Must", "Should", "Could", "Won't"];

// Import a project's initial requirements from an SRS. Stages: input -> reading -> review -> creating -> done.
// Template (.docx made from our SRS template): the requirement tables are read exactly. Anything else (pdf, md, txt, a free-form
// docx) goes through RULE-BASED detection (simple keyword and numbering rules, not a trained model), so every row must be reviewed.
// Controlled by the Requirements page (open / onOpenChange), so ?import=1 and the empty state can both open it.
export function DetectRequirementsDialog({ projectId, existingCount = 0, open, onOpenChange, onImported }) {
  const [stage, setStage] = useState("input");
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [outcome, setOutcome] = useState(null);
  const inputRef = useRef(null);

  const reset = () => {
    setStage("input");
    setFile(null);
    setError("");
    setPreview(null);
    setRows([]);
    setSelected(new Set());
    setOutcome(null);
  };
  const handleOpenChange = (next) => {
    if (!next && stage === "creating") return; // do not close while the import runs
    onOpenChange(next);
    if (!next) reset();
  };

  const pick = (f) => {
    if (!f) return;
    setError("");
    if (f.size > MAX_BYTES) { setError("The file is larger than 2 MB."); return; }
    if (!/\.(docx|md|markdown|txt|pdf)$/i.test(f.name)) { setError("Use a .docx, .md, .txt or .pdf file."); return; }
    setFile(f);
  };

  const analyse = async () => {
    if (!file) return;
    setStage("reading");
    setError("");
    try {
      const res = await previewSrs(projectId, file);
      setPreview(res);
      setRows(res.candidates.map((c, i) => ({ ...c, key: i, priority: c.priority || "" })));
      setSelected(new Set(res.candidates.map((c, i) => (c.selected ? i : -1)).filter((i) => i >= 0)));
      setStage("review");
    } catch (err) {
      setError(err.message || "Could not read the document.");
      setStage("input");
    }
  };

  const edit = (key, field, value) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const toggle = (key) => setSelected((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.key)), [rows, selected]);
  const invalid = chosen.filter((r) => r.title.trim().length < 3);
  const stats = useMemo(() => ({
    fr: chosen.filter((r) => r.type === "FR").length,
    nfr: chosen.filter((r) => r.type === "NFR").length,
    duplicates: rows.filter((r) => r.duplicateOf).length,
    attention: rows.filter((r) => r.placeholders || r.confidence === "low").length,
  }), [rows, chosen]);
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const create = async () => {
    if (!chosen.length || invalid.length) return;
    setStage("creating");
    setError("");
    try {
      const res = await confirmSrsImport(projectId, {
        documentId: preview.documentId,
        documentName: preview.documentName,
        items: chosen.map((r) => ({ sourceId: r.sourceId, title: r.title.trim(), description: r.description.trim(), type: r.type, featureArea: r.featureArea.trim(), priority: r.priority })),
      });
      setOutcome(res);
      setStage("done");
      onImported?.(res);
    } catch (err) {
      setError(err.message || "Could not create the requirements.");
      setStage("review");
    }
  };

  const wide = stage === "review";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", wide && "sm:max-w-6xl")}>
        {stage === "input" && (
          <>
            <DialogHeader>
              <DialogTitle>Import requirements from an SRS</DialogTitle>
              <DialogDescription>
                Upload a filled-in SRS template (read exactly) or another SRS document (.docx, .md, .txt, .pdf; rule-based detection).
              </DialogDescription>
            </DialogHeader>

            {existingCount > 0 && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-status-atrisk-fg/30 bg-status-atrisk-bg px-3 py-2 text-sm text-status-atrisk-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This project already has {existingCount} requirement{existingCount === 1 ? "" : "s"}. Imported requirements are added to them; rows that look like existing ones are left unselected.
              </p>
            )}

            <label
              htmlFor="srs-file"
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-primary",
                dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
              )}
            >
              <UploadCloud className="h-8 w-8 text-primary" aria-hidden="true" />
              <span className="text-sm font-medium text-foreground">{file ? file.name : "Drop a file here, or click to choose one"}</span>
              <span className="text-xs text-muted-foreground">{file ? `${(file.size / 1024).toFixed(0)} KB` : ".docx, .md, .txt, .pdf, up to 2 MB. The file is read in memory and not stored."}</span>
              <input ref={inputRef} id="srs-file" type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
            </label>

            <SrsTemplateLink>Start from our SRS template</SrsTemplateLink>

            {error && (
              <p role="alert" className="rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg">{error}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="button" disabled={!file} onClick={analyse}>Read document</Button>
            </div>
          </>
        )}

        {stage === "reading" && (
          <>
            <DialogHeader><DialogTitle>Reading the document…</DialogTitle></DialogHeader>
            <div className="flex flex-col items-center gap-3 py-10" role="status">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Looking for requirements in "{file?.name}"…</p>
            </div>
          </>
        )}

        {stage === "review" && preview && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {rows.length} requirement{rows.length === 1 ? "" : "s"} found
                {preview.method === "template" ? (
                  <Badge variant="success" className="text-[10px]">Template: read exactly</Badge>
                ) : (
                  <Badge variant="warning" className="text-[10px]">Rule-based detection: review carefully</Badge>
                )}
              </DialogTitle>
              <DialogDescription>
                From "{preview.documentName}". {preview.method === "template"
                  ? "The requirement tables were read as written."
                  : "Rows were picked by simple keyword and numbering rules (not a trained model). Check every row, and the type, before importing."}
              </DialogDescription>
            </DialogHeader>

            {preview.existingRequirements > 0 && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-status-atrisk-fg/30 bg-status-atrisk-bg px-3 py-2 text-sm text-status-atrisk-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This project already has {preview.existingRequirements} requirement{preview.existingRequirements === 1 ? "" : "s"}. {stats.duplicates > 0 ? `${stats.duplicates} row${stats.duplicates === 1 ? "" : "s"} look like existing ones and are unselected.` : "Imported requirements are added to them."}
              </p>
            )}
            {preview.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {preview.warnings.map((w, i) => <li key={i} className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</li>)}
              </ul>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.key)))}
                className="font-medium text-primary hover:underline"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
              <span className="text-muted-foreground" aria-live="polite">
                {chosen.length} of {rows.length} selected · {stats.fr} FR · {stats.nfr} NFR
                {stats.duplicates > 0 && ` · ${stats.duplicates} duplicate${stats.duplicates === 1 ? "" : "s"}`}
                {stats.attention > 0 && ` · ${stats.attention} need${stats.attention === 1 ? "s" : ""} attention`}
              </span>
            </div>

            <div className="max-h-[52vh] overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[60rem] text-sm">
                <thead className="sticky top-0 z-10 bg-muted/80 text-left text-xs uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="w-9 px-3 py-2"><span className="sr-only">Include</span></th>
                    <th className="w-20 px-2 py-2">Source</th>
                    <th className="w-56 px-2 py-2">Title</th>
                    <th className="px-2 py-2">Description</th>
                    <th className="w-24 px-2 py-2">Type</th>
                    <th className="w-28 px-2 py-2">Priority</th>
                    <th className="w-36 px-2 py-2">Feature area</th>
                    <th className="w-56 px-2 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={cn("border-t border-border align-top", !selected.has(r.key) && "opacity-60")}>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Include ${r.title}`} className="h-3.5 w-3.5 accent-primary" />
                      </td>
                      <td className="px-2 py-2 font-mono text-[11px] text-muted-foreground">{r.sourceId || "-"}</td>
                      <td className="px-2 py-2"><Input value={r.title} onChange={(e) => edit(r.key, "title", e.target.value)} maxLength={200} aria-label={`Title of ${r.sourceId || "row"}`} className={cn("h-8 text-xs", selected.has(r.key) && r.title.trim().length < 3 && "border-status-dropped-fg")} /></td>
                      <td className="px-2 py-2"><Textarea value={r.description} onChange={(e) => edit(r.key, "description", e.target.value)} maxLength={2000} rows={2} aria-label={`Description of ${r.sourceId || "row"}`} className="min-h-0 text-xs" /></td>
                      <td className="px-2 py-2">
                        <Select value={r.type} onValueChange={(v) => edit(r.key, "type", v)}>
                          <SelectTrigger className="h-8 text-xs" aria-label={`Type of ${r.sourceId || "row"}`}><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="FR">FR</SelectItem><SelectItem value="NFR">NFR</SelectItem></SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2">
                        <Select value={r.priority || NONE} onValueChange={(v) => edit(r.key, "priority", v === NONE ? "" : v)}>
                          <SelectTrigger className="h-8 text-xs" aria-label={`Priority of ${r.sourceId || "row"}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>None</SelectItem>
                            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-2"><Input value={r.featureArea} onChange={(e) => edit(r.key, "featureArea", e.target.value)} maxLength={120} aria-label={`Feature area of ${r.sourceId || "row"}`} className="h-8 text-xs" /></td>
                      <td className="space-y-1 px-2 py-2 text-[11px] text-muted-foreground">
                        {r.confidence && <Badge variant={r.confidence === "medium" ? "secondary" : "warning"} className="text-[10px]">{r.confidence} confidence</Badge>}
                        {r.warnings.map((w, i) => <p key={i}>{w}</p>)}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No requirements were found in this document.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {error && <p role="alert" className="rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg">{error}</p>}
            {invalid.length > 0 && <p className="text-xs text-status-dropped-fg">{invalid.length} selected row{invalid.length === 1 ? " needs" : "s need"} a title of at least 3 characters.</p>}
            <p className="text-[11px] text-muted-foreground">Feature area is kept as a label only. Clusters are computed from the requirement texts.</p>

            <div className="flex justify-between gap-2 pt-1">
              <Button type="button" variant="outline" onClick={reset}>Choose another file</Button>
              <div className="flex gap-2">
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                <Button type="button" onClick={create} disabled={!chosen.length || invalid.length > 0}>
                  Create {chosen.length} requirement{chosen.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          </>
        )}

        {stage === "creating" && (
          <>
            <DialogHeader><DialogTitle>Creating {chosen.length} requirement{chosen.length === 1 ? "" : "s"}…</DialogTitle></DialogHeader>
            <div className="flex flex-col items-center gap-3 py-10" role="status" aria-live="polite">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-center text-sm text-muted-foreground">Saving the requirements, then building the requirement network, its clusters and the Initial baseline. This can take several seconds for a long document. Please keep this window open.</p>
            </div>
          </>
        )}

        {stage === "done" && outcome && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-status-confirmed-fg" />Import finished</DialogTitle>
              <DialogDescription>
                {outcome.alreadyImported ? "This exact import had already been done; nothing was added twice. " : ""}
                {outcome.created} requirement{outcome.created === 1 ? "" : "s"} created{outcome.skipped ? `, ${outcome.skipped} skipped as duplicates` : ""}{outcome.failed ? `, ${outcome.failed} failed` : ""}.
              </DialogDescription>
            </DialogHeader>
            {outcome.firstError && <p role="alert" className="rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg">First error: {outcome.firstError}</p>}
            {outcome.network?.updated ? (
              <p className="text-sm text-muted-foreground">
                The network was built: {outcome.network.links} links in {outcome.network.clusters} clusters{outcome.baselineCreated ? ", and the Initial baseline was frozen" : ""}.
              </p>
            ) : outcome.network ? (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-status-atrisk-fg/30 bg-status-atrisk-bg px-3 py-2 text-sm text-status-atrisk-fg"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{outcome.network.message}</p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button asChild variant="outline" onClick={() => handleOpenChange(false)}>
                <Link to={`/projects/${projectId}/requirements/network-map`}><Network className="mr-1.5 h-4 w-4" />Open the Network Map</Link>
              </Button>
              <Button asChild onClick={() => handleOpenChange(false)}>
                <Link to={`/projects/${projectId}/requirements/list`}><FileText className="mr-1.5 h-4 w-4" />View the requirements</Link>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
