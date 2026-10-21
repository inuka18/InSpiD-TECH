import { useState } from "react";
import { UserPlus, Check, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DialogClose,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { cn } from "../../../lib/utils";

// `projects` is the full list of projects the inviting PM can see:
// multi-project support means an invite isn't limited to whichever
// project the Team page happens to be scoped to right now.
export function InviteMemberDialog({ projects, defaultProjectId, onInvite, trigger }) {
  const [open, setOpen] = useState(false);
  const emptyForm = () => ({
    name: "",
    email: "",
    jobTitle: "",
    projectIds: defaultProjectId ? [defaultProjectId] : [],
  });
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleOpenChange = (next) => {
    setOpen(next);
    if (next) {
      setForm(emptyForm());
      setError("");
    }
  };

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const toggleProject = (id) =>
    setForm((prev) => ({
      ...prev,
      projectIds: prev.projectIds.includes(id)
        ? prev.projectIds.filter((p) => p !== id)
        : [...prev.projectIds, id],
    }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email.trim() || form.projectIds.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      await onInvite({
        name: form.name,
        email: form.email.trim(),
        jobTitle: form.jobTitle || "Team Member",
        projectIds: form.projectIds,
      });
      setOpen(false);
    } catch (err) {
      setError(err.message || "Could not add this person.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <UserPlus className="h-4 w-4" />
            Invite Member
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            Add someone who already has an account, by email, to the project(s) you select below. Their name and job title come from their account.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="inv-email">Email of an existing account</Label>
            <Input
              id="inv-email"
              type="email"
              placeholder="developer.hms@inspid.test"
              value={form.email}
              onChange={set("email")}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Project(s)</Label>
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-border p-2.5">
              {projects.length === 0 && (
                <span className="px-1 py-1 text-xs text-muted-foreground">No projects found.</span>
              )}
              {projects.map((p) => {
                const selected = form.projectIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProject(p.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      selected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    )}
                  >
                    {selected ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.colorTag }} />
                    )}
                    {p.name}
                  </button>
                );
              })}
            </div>
            {form.projectIds.length === 0 && (
              <p className="text-xs text-status-atrisk-fg">Select at least one project.</p>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-status-dropped-fg/30 bg-status-dropped-bg px-3 py-2 text-sm text-status-dropped-fg">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={form.projectIds.length === 0 || !form.email.trim() || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Add to project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
