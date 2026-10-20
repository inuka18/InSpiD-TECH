import { useNavigate } from "react-router-dom";
import { AlertCircle, Network } from "lucide-react";
import { NetworkMap } from "./components/NetworkMap";
import { EmptyState } from "../../components/common/EmptyState";
import { Skeleton } from "../../components/ui/skeleton";
import { useNetwork } from "../../hooks/useNetwork";
import { useManualLinks } from "../../hooks/useManualLinks";
import { useSignals } from "../../hooks/useSignals";
import { useActiveProject } from "../../hooks/useActiveProject";
import { useRole, ROLES } from "../../context/RoleContext";
import { createManualLink, deleteManualLink } from "../../services/manualLinksService";

export function NetworkMapPage() {
  const { activeProjectId } = useActiveProject();
  const { role, currentUser } = useRole();
  const isPM = role === ROLES.PM;
  // The first request computes the network on the server (it embeds the requirement texts), so it can take a few seconds.
  const { data: network, loading, error, reload } = useNetwork(activeProjectId);
  const { data: manualLinks, setData: setManualLinks, loading: linksLoading } = useManualLinks(activeProjectId);
  // Signals are only used for the per-requirement signal counts in the link details panel.
  const { data: signals } = useSignals(activeProjectId);
  const navigate = useNavigate();

  const handleCreateManualLink = async ({ sourceId, targetId, reason }) => {
    const link = await createManualLink({
      projectId: activeProjectId,
      sourceId,
      targetId,
      reason,
      createdBy: currentUser?.name ?? "Unknown",
    });
    setManualLinks((prev) => [...prev, link]);
    return link;
  };

  const handleRemoveManualLink = async (link) => {
    await deleteManualLink(link, currentUser?.name ?? "Unknown");
    setManualLinks((prev) => prev.filter((l) => l.id !== link.id));
  };

  if (loading || linksLoading) {
    return (
      <div>
        <Skeleton className="h-[calc(100vh-14rem)] min-h-[520px] w-full rounded-xl" />
        <p className="mt-2 text-xs text-muted-foreground">Loading the network (the first time it is computed from the requirement texts).</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
        <AlertCircle className="h-6 w-6 text-status-dropped-fg" />
        <p className="text-sm font-medium text-foreground">Could not load the network.</p>
        <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
        <button onClick={reload} className="text-sm font-medium text-primary hover:underline">
          Try again
        </button>
      </div>
    );
  }

  if (network.nodes.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No requirements to map yet."
        description="The network is computed from the requirement texts. Add requirements first."
      />
    );
  }

  return (
    <NetworkMap
      // Remount when the computed network changes so the layout is rebuilt.
      key={`${network.nodes.length}-${network.links.length}-${network.clusters.length}`}
      projectId={activeProjectId}
      signals={signals}
      requirements={network.nodes}
      links={network.links}
      warning={network.warning}
      onOpenRequirement={(id) => navigate(`/projects/${activeProjectId}/requirements/list?req=${id}`)}
      isPM={isPM}
      manualLinks={manualLinks}
      onCreateManualLink={handleCreateManualLink}
      onRemoveManualLink={handleRemoveManualLink}
    />
  );
}
