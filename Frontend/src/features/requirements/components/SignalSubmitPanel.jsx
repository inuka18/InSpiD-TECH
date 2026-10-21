import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, Loader2, Send, AlertCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { SignalResultCard } from "./SignalResultCard";
import { previewSignal, submitSignal } from "../../../services/signalsService";
import { useRole } from "../../../context/RoleContext";

const SOURCES = ["Standup", "Slack", "Email", "Teams", "Jira Comment"];

// "Submit a message": any project member can try a message. Preview classifies and matches it without saving anything;
// Submit saves it, applies the status change if it is safe to, and asks the parent to refresh feed, requirements and ledger.
export function SignalSubmitPanel({ projectId, requirements, onSubmitted }) {
  const { currentUser } = useRole();
  const [open, setOpen] = useState(true);
  const [source, setSource] = useState("Slack");
  const [authorRole, setAuthorRole] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(null); // "preview" | "submit"
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const body = () => ({ source, text: text.trim(), authorRole: authorRole.trim() });
  const canSend = text.trim().length > 0 && !busy;

  const run = async (kind) => {
    setBusy(kind);
    setError("");
    try {
      const res = kind === "preview" ? await previewSignal(projectId, body()) : await submitSignal(projectId, body());
      setResult(res);
      if (kind === "submit") {
        setText("");
        onSubmitted?.(res);
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Send className="h-4 w-4 text-primary" />
          Submit a message
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-4">
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="signal-source">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger id="signal-source">
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
              <Label htmlFor="signal-role">Sender role (optional)</Label>
              <Input
                id="signal-role"
                value={authorRole}
                onChange={(e) => setAuthorRole(e.target.value)}
                placeholder={currentUser?.title ? `Defaults to ${currentUser.title}` : "Defaults to your job title"}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="signal-text">Message</Label>
            <Textarea
              id="signal-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. The order tracking page went live this morning."
              rows={3}
              maxLength={5000}
            />
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={!canSend} onClick={() => run("preview")}>
              {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview
            </Button>
            <Button type="button" disabled={!canSend} onClick={() => run("submit")}>
              {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit
            </Button>
            <span className="text-xs text-muted-foreground">Preview saves nothing. Submit saves the message and may change a requirement status.</span>
          </div>

          {result && <SignalResultCard result={result} requirements={requirements} onClose={() => setResult(null)} />}
        </div>
      )}
    </div>
  );
}
