import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, ShieldAlert, Info, Loader2, Link2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { LedgerTable } from "./components/LedgerTable";
import { useLedger } from "../../hooks/useLedger";
import { useActiveProject } from "../../hooks/useActiveProject";
import { verifyLedger } from "../../services/ledgerService";
import { cn } from "../../lib/utils";

export function LedgerPage() {
  const { activeProjectId } = useActiveProject();
  const { data: entries, loading, error } = useLedger(activeProjectId);
  const navigate = useNavigate();
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState(null); // { valid, entries, brokenAt, reason } | { error }

  const handleVerify = async () => {
    setVerifying(true);
    setVerification(null);
    try {
      setVerification(await verifyLedger(activeProjectId));
    } catch (err) {
      setVerification({ error: err.message });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed text-foreground/90">
          <span className="font-semibold">Local hash chain.</span> Every requirement status change, new requirement, manual
          link and network update is recorded as a ledger entry whose hash covers its contents and the previous entry. Changing
          an old entry breaks the chain, and <span className="font-medium">Verify chain</span> recomputes it to check. This is a{" "}
          <span className="font-medium">database record, not a blockchain</span>: nothing is written on-chain yet.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link2 className="h-4 w-4 text-primary" />
          <span>{loading ? "Loading…" : `${entries.length} entries in the local hash chain`}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {verification && !verification.error && (
            <span
              role="status"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                verification.valid ? "bg-status-confirmed-bg text-status-confirmed-fg" : "bg-status-dropped-bg text-status-dropped-fg"
              )}
            >
              {verification.valid ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              {verification.valid
                ? `Chain valid (${verification.entries} entries checked)`
                : `Chain BROKEN at block #${verification.brokenAt}${verification.reason ? `: ${verification.reason}` : ""}`}
            </span>
          )}
          {verification?.error && <span className="text-xs text-status-dropped-fg">Could not verify: {verification.error}</span>}
          <Button size="sm" variant="outline" onClick={handleVerify} disabled={verifying || loading}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Verify chain
          </Button>
        </div>
      </div>

      {error && !loading ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-status-dropped-fg">
          Could not load the ledger: {error.message}
        </div>
      ) : (
        <LedgerTable
          entries={entries}
          loading={loading}
          onSelectRequirement={(id) => id && navigate(`/projects/${activeProjectId}/requirements/list?req=${id}`)}
        />
      )}
    </div>
  );
}
