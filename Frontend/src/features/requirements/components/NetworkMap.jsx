import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { AlertTriangle, ArrowUpRight, Link2, X, MousePointerClick } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { RequirementNode } from "./RequirementNode";
import { ClusterBackgroundNode } from "./ClusterBackgroundNode";
import { ManualLinkEdge } from "./ManualLinkEdge";
import { PathfinderEdge } from "./PathfinderEdge";
import { NetworkMapContext } from "./networkMapContext";
import { LinkDetailsPanel } from "./LinkDetailsPanel";
import { RequirementDetailPanel } from "./RequirementDetailPanel";
import { MapToolbar, MAX_ZOOM, MIN_ZOOM } from "./MapToolbar";
import { ManualLinkDialog } from "./ManualLinkDialog";
import { RestrictedButton } from "./RestrictedButton";
import { StatusBadge } from "./StatusBadge";
import { buildNetworkLayout } from "../../../lib/networkLayout";
import { clusterMeta } from "../../../lib/clusters";
import { manualToDetail } from "../../../lib/networkStats";
import { cn } from "../../../lib/utils";

const nodeTypes = {
  requirementNode: RequirementNode,
  clusterBackground: ClusterBackgroundNode,
};
const edgeTypes = {
  manual: ManualLinkEdge,
  semantic: PathfinderEdge,
};

const STATUS_LEGEND = [
  { status: "Confirmed", swatch: "bg-status-confirmed-fg" },
  { status: "At Risk", swatch: "bg-status-atrisk-fg" },
  { status: "Modified", swatch: "bg-status-modified-fg" },
  { status: "Dropped", swatch: "bg-status-dropped-fg" },
];

// `requirements` are the network nodes from the API, `links` its computed (pathfinder) links with weights.
function NetworkMapInner({ projectId, signals = [], requirements, links = [], warning, onOpenRequirement, isPM, manualLinks, onCreateManualLink, onRemoveManualLink }) {
  const wrapperRef = useRef(null);
  const [popover, setPopover] = useState(null);
  const [linkMode, setLinkMode] = useState(false);
  const [pendingSourceId, setPendingSourceId] = useState(null);
  const [dialogPair, setDialogPair] = useState(null); // { source, target }
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  // The open side panel, shown on this page (the map is never unmounted, so zoom and pan are kept):
  //   { type: "requirement", id, backTo? }  or  { type: "link", link }
  const [panel, setPanel] = useState(null);
  // What to focus when a panel closes: the node or link that was clicked. { kind: "node" | "edge", id }
  const focusTarget = useRef(null);
  const panelRef = useRef(null); // latest panel, readable from the close-focus handler
  useEffect(() => {
    panelRef.current = panel;
  }, [panel]);

  // ---- zoom and fullscreen -----------------------------------------------------------------------------
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  // Has the user moved or zoomed the map? Only then is fit-to-screen NOT re-applied automatically on resize.
  const userMoved = useRef(false);
  const [expanded, setExpanded] = useState(false); // the wrapper fills the viewport (CSS), with or without the Fullscreen API
  const nativeFullscreen = useRef(false); // true while WE own a real browser fullscreen

  const fit = useCallback(() => {
    userMoved.current = false; // after "fit" the view is the fitted one again
    fitView({ padding: 0.15, duration: 200 });
  }, [fitView]);

  const enterFullscreen = useCallback(async () => {
    setExpanded(true); // CSS expansion always happens; it is the whole feature when the Fullscreen API is unavailable
    const root = document.documentElement;
    if (!root.requestFullscreen) return;
    try {
      // The Fullscreen API goes on <html>, not on the map element: the panels, dialogs and toasts are portals on <body>,
      // so a fullscreen on the map element alone would hide them.
      await root.requestFullscreen({ navigationUI: "hide" });
      nativeFullscreen.current = true;
      // Keyboard Lock (Chrome, Edge): the browser then lets Esc reach the page, so Esc can close a panel first.
      // Without it (Firefox, Safari) the browser itself leaves fullscreen on Esc.
      try {
        await navigator.keyboard?.lock?.(["Escape"]);
      } catch {
        /* not supported or refused: fine */
      }
    } catch {
      nativeFullscreen.current = false; // denied (iframe, some phones): stay in the CSS-only expanded mode
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    setExpanded(false);
    nativeFullscreen.current = false;
    try {
      navigator.keyboard?.unlock?.();
    } catch {
      /* ignore */
    }
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const toggleFullscreen = useCallback(() => (expanded ? exitFullscreen() : enterFullscreen()), [expanded, enterFullscreen, exitFullscreen]);

  // The browser's own exit (its fullscreen control, or Esc without Keyboard Lock) must keep our state correct.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && nativeFullscreen.current) {
        nativeFullscreen.current = false;
        setExpanded(false);
        try {
          navigator.keyboard?.unlock?.();
        } catch {
          /* ignore */
        }
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (nativeFullscreen.current && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  // The container changed size: re-fit, but only if the user has not moved or zoomed the map themselves.
  useEffect(() => {
    const timers = [120, 450].map((ms) => setTimeout(() => { if (!userMoved.current) fitView({ padding: 0.15, duration: 200 }); }, ms));
    return () => timers.forEach(clearTimeout);
  }, [expanded, fitView]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // The automatic layout (nodes + Pathfinder-style edges), entirely
  // unchanged from before this feature existed, still memoized on
  // `requirements` alone, so nothing about it reacts to manual links.
  const layout = useMemo(() => buildNetworkLayout(requirements, links), [requirements, links]);

  const requirementById = useMemo(() => new Map(requirements.map((r) => [r.id, r])), [requirements]);

  const isAlreadyLinked = useCallback(
    (aId, bId) => {
      if (links.some((l) => l.kind === "pathfinder" && ((l.source === aId && l.target === bId) || (l.source === bId && l.target === aId)))) return true;
      return manualLinks.some((l) => (l.sourceId === aId && l.targetId === bId) || (l.sourceId === bId && l.targetId === aId));
    },
    [links, manualLinks]
  );

  const handleRemoveLinkRequest = useCallback(
    async (link) => {
      await onRemoveManualLink(link);
      const source = requirementById.get(link.sourceId);
      const target = requirementById.get(link.targetId);
      setToast(`Removed manual link between ${source?.id ?? link.sourceId} and ${target?.id ?? link.targetId}.`);
    },
    [onRemoveManualLink, requirementById]
  );

  // Manual edges are computed separately from the automatic layout and
  // merged in below, kept out of buildNetworkLayout() entirely, so that
  // function's output (and the drag positions derived from it) never
  // changes shape because a manual link was added or removed.
  const manualEdges = useMemo(
    () =>
      manualLinks
        .filter((link) => requirementById.has(link.sourceId) && requirementById.has(link.targetId))
        .map((link) => ({
          id: link.id,
          source: link.sourceId,
          target: link.targetId,
          type: "manual",
          data: { link, canRemove: isPM, onRemove: handleRemoveLinkRequest },
          zIndex: 20,
        })),
    [manualLinks, requirementById, isPM, handleRemoveLinkRequest]
  );

  const [nodes, , onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([...layout.edges, ...manualEdges]);

  // Only the edge list is kept in sync when manual links change, node
  // positions (and the automatic edges themselves) are left alone.
  useEffect(() => {
    setEdges([...layout.edges, ...manualEdges]);
  }, [layout.edges, manualEdges, setEdges]);

  const clusterCount = useMemo(
    () => new Set(requirements.map((r) => clusterMeta(r).id)).size,
    [requirements]
  );
  const legendClusters = layout.clusterBoxes;

  const cancelLinking = useCallback(() => {
    setPendingSourceId(null);
  }, []);

  const handleNodeClick = useCallback(
    (event, node) => {
      if (node.type !== "requirementNode") return;

      if (linkMode) {
        if (pendingSourceId === node.id) {
          cancelLinking();
          return;
        }
        if (!pendingSourceId) {
          setPendingSourceId(node.id);
          return;
        }
        if (isAlreadyLinked(pendingSourceId, node.id)) {
          setToast("These requirements are already linked.");
          cancelLinking();
          return;
        }
        setDialogPair({ source: requirementById.get(pendingSourceId), target: requirementById.get(node.id) });
        return;
      }

      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const x = Math.min(event.clientX - bounds.left, bounds.width - 260);
      const y = Math.min(event.clientY - bounds.top, bounds.height - 200);
      focusTarget.current = { kind: "node", id: node.id };
      setPopover({ requirement: node.data.requirement, x, y });
    },
    [linkMode, pendingSourceId, isAlreadyLinked, requirementById, cancelLinking]
  );

  const handleConfirmLink = async (reason) => {
    if (!dialogPair) return;
    setSubmitting(true);
    try {
      await onCreateManualLink({ sourceId: dialogPair.source.id, targetId: dialogPair.target.id, reason });
      setToast(`Linked ${dialogPair.source.id} and ${dialogPair.target.id}.`);
      setDialogPair(null);
      cancelLinking();
    } catch (err) {
      setToast(err.message || "Couldn't create that link.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleLinkMode = () => {
    setLinkMode((v) => !v);
    cancelLinking();
    setPopover(null);
  };

  // ---- side panels (they open on this page, so the map keeps its zoom and pan)
  const openLink = useCallback((link, edgeId) => {
    focusTarget.current = { kind: "edge", id: edgeId };
    setPopover(null);
    setPanel({ type: "link", link });
  }, []);

  const openRequirementPanel = useCallback((id) => {
    setPopover(null);
    setPanel({ type: "requirement", id });
  }, []);

  // Switching between a link and one of its requirements stays inside the panels; "back" returns to the link.
  const switchToRequirement = useCallback((id) => {
    setPanel((p) => ({ type: "requirement", id, backTo: p?.type === "link" ? p.link : p?.backTo }));
  }, []);

  // When the last panel closes, focus goes back to the node or link that was clicked.
  const restoreFocus = useCallback(() => {
    const t = focusTarget.current;
    if (!t || !wrapperRef.current) return;
    const selector =
      t.kind === "node" ? `.react-flow__node[data-id="${CSS.escape(t.id)}"]` : `.react-flow__edge[data-testid="rf__edge-${CSS.escape(t.id)}"]`;
    wrapperRef.current.querySelector(selector)?.focus({ preventScroll: true });
  }, []);

  const handleCloseAutoFocus = useCallback(
    (e) => {
      e.preventDefault();
      if (!panelRef.current) restoreFocus(); // not when we are only switching to the other panel
    },
    [restoreFocus]
  );

  const mapContext = useMemo(() => ({ linkMode, openLink }), [linkMode, openLink]);

  // Keyboard: Enter/Space on a focused node or link does what a click does; Esc closes the small node popover.
  const handleKeyDown = (e) => {
    // Esc closes things in this order: the node popover, then an open panel / dialog (they close themselves), and only
    // then leaves the expanded / fullscreen view.
    if (e.key === "Escape" && popover) {
      setPopover(null);
      // React Flow blurs a selected node on Esc; put focus back on it once that has happened.
      setTimeout(restoreFocus, 0);
      return;
    }
    const dialogOpen = Boolean(panelRef.current || dialogPair || document.querySelector('[role="dialog"]'));
    if (e.key === "Escape") {
      if (expanded && !dialogOpen) exitFullscreen();
      return;
    }
    // Shortcuts while the map has focus and nothing modal is open: + - 0 F
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable;
    if (!typing && !dialogOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        userMoved.current = true;
        zoomIn({ duration: 150 });
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        userMoved.current = true;
        zoomOut({ duration: 150 });
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        fit();
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    const edgeEl = e.target.closest?.(".react-flow__edge");
    const nodeEl = e.target.closest?.(".react-flow__node");
    if (edgeEl) {
      const id = edgeEl.getAttribute("data-testid")?.replace(/^rf__edge-/, "");
      const edge = edges.find((x) => x.id === id);
      e.preventDefault();
      if (linkMode || !edge?.data?.link) return; // link mode: edges do nothing
      openLink(edge.type === "manual" ? manualToDetail(edge.data.link) : edge.data.link, id);
    } else if (nodeEl) {
      const node = nodes.find((n) => n.id === nodeEl.getAttribute("data-id"));
      if (!node) return;
      e.preventDefault();
      const r = nodeEl.getBoundingClientRect();
      handleNodeClick({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, node);
    }
  };

  const panelLink = panel?.type === "link" ? panel.link : null;
  const backTo = panel?.type === "requirement" ? panel.backTo : null;

  return (
    <NetworkMapContext.Provider value={mapContext}>
    <div
      ref={wrapperRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-fullscreen={expanded ? "true" : "false"}
      className={cn(
        "overflow-hidden bg-card outline-none",
        // z-40: above the app header (z-30), below sheets / dialogs / tooltips / toasts (z-50) that portal onto <body>.
        expanded ? "fixed inset-0 z-40 h-dvh w-screen" : "relative h-[calc(100dvh-20.5rem)] min-h-[380px] w-full rounded-xl border border-border"
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onPaneClick={() => {
          setPopover(null);
          cancelLinking();
          wrapperRef.current?.focus({ preventScroll: true }); // so the +, -, 0 and F shortcuts work after clicking the map
        }}
        onMove={() => setPopover(null)}
        onMoveStart={(event) => {
          if (event) userMoved.current = true; // a drag, wheel or pinch by the user (programmatic fits pass no event)
        }}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(var(--border))" />
        <MapToolbar expanded={expanded} onToggleFullscreen={toggleFullscreen} onFit={fit} onUserZoom={() => { userMoved.current = true; }} />

        <Panel position="top-left">
          <div className="rounded-lg border border-border bg-card/95 px-3.5 py-2.5 text-xs shadow-sm backdrop-blur">
            <span className="font-semibold text-foreground">{requirements.length} requirements</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">{clusterCount} cluster{clusterCount === 1 ? "" : "s"}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span className="text-muted-foreground">{layout.edges.length} computed links</span>
          </div>
        </Panel>

        <Panel position="top-right">
          <div className="flex flex-col items-end gap-2">
            {isPM ? (
              <Button
                size="sm"
                variant={linkMode ? "default" : "outline"}
                className={cn("gap-1.5 bg-card/95 shadow-sm backdrop-blur", linkMode && "bg-primary")}
                onClick={toggleLinkMode}
              >
                <Link2 className="h-3.5 w-3.5" />
                {linkMode ? "Linking Mode: On" : "Link Requirements"}
              </Button>
            ) : (
              <div className="rounded-lg bg-card/95 shadow-sm backdrop-blur">
                <RestrictedButton label="Only Project Managers can add or remove manual links">
                  <Link2 className="h-3.5 w-3.5" />
                  Link Requirements
                </RestrictedButton>
              </div>
            )}

            {linkMode && (
              <div className="flex max-w-[15rem] items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] text-primary shadow-sm backdrop-blur">
                <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
                {pendingSourceId
                  ? `Now click the requirement to link with ${pendingSourceId}.`
                  : "Click a requirement, then click another to link them."}
              </div>
            )}
          </div>
        </Panel>

        <Panel position="bottom-left">
          <div className="rounded-lg border border-border bg-card/95 px-3.5 py-3 text-xs shadow-sm backdrop-blur">
            <p className="mb-2 font-semibold text-foreground">Live Status</p>
            <div className="flex flex-col gap-1.5">
              {STATUS_LEGEND.map((item) => (
                <div key={item.status} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${item.swatch}`} />
                  <span className="text-muted-foreground">{item.status}</span>
                </div>
              ))}
            </div>
            <div className="my-2 border-t border-border" />
            <p className="mb-1.5 font-semibold text-foreground">Clusters</p>
            <div className="flex max-h-32 flex-col gap-1.5 overflow-y-auto pr-1 scrollbar-thin">
              {legendClusters.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="max-w-[12rem] truncate text-muted-foreground">{c.label}</span>
                </div>
              ))}
            </div>
            <div className="my-2 border-t border-border" />
            <p className="mb-1.5 font-semibold text-foreground">Connections</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="h-0 w-4 border-t-[3px] border-muted-foreground/60" />
                <span className="text-muted-foreground">Computed from text (thicker = more similar)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-0 w-4 border-t-[1.8px] border-dashed border-status-ripple-fg" />
                <Link2 className="h-2.5 w-2.5 text-status-ripple-fg" />
                <span className="text-muted-foreground">Manual (human-linked)</span>
              </div>
            </div>
          </div>
        </Panel>
      </ReactFlow>

      {warning && (
        <div className="absolute left-1/2 top-3 z-30 flex max-w-xl -translate-x-1/2 items-start gap-2 rounded-lg border border-status-atrisk-fg/30 bg-status-atrisk-bg px-3 py-2 text-xs text-status-atrisk-fg shadow-sm">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      {popover && (
        <div
          className="absolute z-20 w-64 animate-fade-in rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
          style={{ left: popover.x, top: popover.y }}
        >
          <span className="font-mono text-[11px] font-medium text-primary">{popover.requirement.id}</span>
          <p className="mt-1 text-sm font-semibold leading-snug">{popover.requirement.title}</p>
          <div className="mt-2.5">
            <StatusBadge status={popover.requirement.liveStatus} />
          </div>
          <button
            onClick={() => openRequirementPanel(popover.requirement.id)}
            className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View full detail panel
            <ArrowUpRight className="h-3 w-3" />
          </button>
          <button
            onClick={() => onOpenRequirement(popover.requirement.id)}
            className="mt-1.5 block text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            Open in requirements list
          </button>
        </div>
      )}

      <RequirementDetailPanel
        requirementId={panel?.type === "requirement" ? panel.id : null}
        projectId={projectId}
        requirements={requirements}
        open={panel?.type === "requirement"}
        onOpenChange={(open) => !open && setPanel(null)}
        onSelectRequirement={switchToRequirement}
        onBack={backTo ? () => setPanel({ type: "link", link: backTo }) : undefined}
        backLabel={backTo ? `Back to link ${backTo.source ?? backTo.sourceId} ↔ ${backTo.target ?? backTo.targetId}` : undefined}
        onCloseAutoFocus={handleCloseAutoFocus}
      />

      <LinkDetailsPanel
        link={panelLink}
        open={panel?.type === "link"}
        onOpenChange={(open) => !open && setPanel(null)}
        onCloseAutoFocus={handleCloseAutoFocus}
        projectId={projectId}
        nodes={requirements}
        links={links}
        signals={signals}
        isPM={isPM}
        onSelectRequirement={switchToRequirement}
        onRemoveManualLink={async (raw) => {
          await handleRemoveLinkRequest(raw);
          setPanel(null);
        }}
      />

      <ManualLinkDialog
        open={Boolean(dialogPair)}
        onOpenChange={(open) => !open && setDialogPair(null)}
        source={dialogPair?.source}
        target={dialogPair?.target}
        onConfirm={handleConfirmLink}
        submitting={submitting}
      />

      {toast && (
        <div className="absolute bottom-16 right-4 z-30 flex max-w-sm items-start gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-2xl animate-slide-up">
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
    </NetworkMapContext.Provider>
  );
}

// React Flow's hooks (zoom, fit) need a provider above the map, so the keyboard shortcuts and the toolbar can use them.
export function NetworkMap(props) {
  return (
    <ReactFlowProvider>
      <NetworkMapInner {...props} />
    </ReactFlowProvider>
  );
}
