import { useState } from "react";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
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
import { Textarea } from "../../../components/ui/textarea";
import { Label } from "../../../components/ui/label";
import { useProject } from "../../../context/ProjectContext";
import { SrsTemplateLink } from "../../requirements/components/SrsTemplateLink";

const EMPTY_FORM = { name: "", description: "" };

export function CreateProjectDialog() {
  const { addProject } = useProject();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState(null); // set after creating: offers the SRS import

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await addProject(form);
      setForm(EMPTY_FORM);
      if (created) setCreatedId(created.id);
      else setOpen(false);
    } catch (err) {
      setError(err.message || "Could not create the project.");
    } finally {
      setSubmitting(false);
    }
  };

  const close = (next) => {
    setOpen(next);
    if (!next) setCreatedId(null);
  };
  const goTo = (suffix) => {
    const id = createdId;
    close(false);
    navigate(`/projects/${id}${suffix}`);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Create Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        {createdId ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-status-confirmed-fg" />Project created</DialogTitle>
              <DialogDescription>
                Next, give it its first requirements. Import them from an SRS document: a filled-in template is read exactly, and the requirement network and the Initial baseline are built right after.
              </DialogDescription>
            </DialogHeader>
            <SrsTemplateLink>Download the SRS template</SrsTemplateLink>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => goTo("")}>Open the project</Button>
              <Button type="button" onClick={() => goTo("/requirements/list?import=1")}>
                <FileUp className="h-4 w-4" />
                Import requirements from an SRS
              </Button>
            </div>
          </>
        ) : (
          <>
        <DialogHeader>
          <DialogTitle>Create a new project</DialogTitle>
          <DialogDescription>
            Set up a new workspace. You'll be added as its Project Manager automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">Project name</Label>
            <Input
              id="proj-name"
              placeholder="e.g. Horizon Logistics"
              value={form.name}
              onChange={set("name")}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-desc">Description</Label>
            <Textarea
              id="proj-desc"
              placeholder="A short summary of what this project is building…"
              value={form.description}
              onChange={set("description")}
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Start date and initial members are not stored yet. Add people from the project's Team page after creating it.
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            Start from our SRS template to write the requirements:
            <SrsTemplateLink />
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
            <Button type="submit" disabled={submitting || !form.name.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create project
            </Button>
          </div>
        </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
