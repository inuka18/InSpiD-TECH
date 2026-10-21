import { useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { bandStyle, formatBaselineDate } from "../../../lib/alignment";
import { cn } from "../../../lib/utils";

// Name dialog for "Freeze new baseline". The dialog is a portal on <body>, which stays visible in fullscreen
// (the Fullscreen API is on <html>), and it closes on Esc before the map leaves fullscreen.
function FreezeBaselineDialog({ open, onOpenChange, onConfirm, submitting, error }) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  const canSubmit = name.trim().length > 0 && name.trim().length <= 80;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-primary" />
            Freeze new baseline
          </DialogTitle>
          <DialogDescription>
            Saves the current requirement network and requirement statuses. Alignment is measured against the latest baseline from then
            on, so the score returns to 100%. This is recorded in the ledger.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onConfirm(name.trim());
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="baseline-name">Baseline name</Label>
            <Input id="baseline-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Sprint 3 freeze" autoFocus />
          </div>
          {error && <p className="text-sm text-status-dropped-fg">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSubmit || submitting}>
              <Flag className="h-4 w-4" />
              {submitting ? "Freezing…" : "Freeze baseline"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The strip at the TOP of the Network Map: "Baseline: <name>, frozen <date> | Alignment <score>% (<band>)",
// plus the PM-only "Freeze new baseline" button. It is part of the map element, so it is also there in fullscreen.
// alignment: GET /alignment answer, or null when there is no baseline yet.
export function BaselineStrip({ alignment, loading, isPM, onFreeze }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const confirm = async (name) => {
    setSubmitting(true);
    setError(null);
    try {
      await onFreeze(name);
      setOpen(false);
    } catch (err) {
      setError(err.message || "Could not freeze the baseline.");
    } finally {
      setSubmitting(false);
    }
  };

  const style = alignment ? bandStyle(alignment.current.band) : null;

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card px-4 py-2 text-xs"
      role="status"
      aria-label="Baseline and alignment"
    >
      <Flag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {loading ? (
        <span className="text-muted-foreground">Loading the baseline…</span>
      ) : alignment ? (
        <>
          <span className="text-muted-foreground">
            Baseline: <span className="font-semibold text-foreground">{alignment.baseline.name}</span>, frozen{" "}
            {formatBaselineDate(alignment.baseline.createdAt)}
          </span>
          <span className="text-border" aria-hidden="true">
            |
          </span>
          <span className="text-muted-foreground">
            Alignment <span className={cn("font-semibold", style.tone)}>{alignment.current.score}%</span>{" "}
            <span className={cn("font-medium", style.tone)}>({alignment.current.band})</span>
          </span>
        </>
      ) : (
        <span className="text-muted-foreground">No baseline yet.</span>
      )}
      <div className="flex-1" />
      {isPM && (
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => setOpen(true)}>
          <Flag className="h-3.5 w-3.5" />
          Freeze new baseline
        </Button>
      )}
      <FreezeBaselineDialog open={open} onOpenChange={setOpen} onConfirm={confirm} submitting={submitting} error={error} />
    </div>
  );
}
