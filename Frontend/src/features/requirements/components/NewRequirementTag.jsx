import { Sparkles } from "lucide-react";
import { Badge } from "../../../components/ui/badge";

// "Possible new requirement" with the reason ("no close requirement" / "new terms: koko").
// nr = the newRequirement block of an API answer, or a signal's newRequirement.
export function NewRequirementTag({ nr, className }) {
  if (!nr?.isCandidate) return null;
  return (
    <span className={className} title={`Needs a PM decision before it changes any requirement${nr.joinsCandidateId ? `. Would join ${nr.joinsCandidateId}.` : ""}`}>
      <Badge variant="outline" className="gap-1 border-primary/40 text-[10px] text-primary">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        Possible new requirement{nr.reason ? `: ${nr.reason}` : ""}
      </Badge>
    </span>
  );
}
