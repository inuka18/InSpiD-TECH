import { FileDown } from "lucide-react";
import { cn } from "../../../lib/utils";

// Download link for the SRS template (Frontend/public/templates/SRS_Template.docx). Filling in its two requirement tables
// lets the platform read the requirements exactly (see "Import requirements from an SRS").
export function SrsTemplateLink({ className, children = "Download SRS template" }) {
  return (
    <a
      href="/templates/SRS_Template.docx"
      download="SRS_Template.docx"
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", className)}
    >
      <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </a>
  );
}
