import { memo, useContext, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "reactflow";
import { NetworkMapContext } from "./networkMapContext";

// A computed (Pathfinder) link. Wide invisible hit target, hover highlight (thicker line + a pill with the similarity
// as a percent), and a click opens the "Link details" panel, unless link mode is on, when clicks do nothing.
function PathfinderEdgeImpl({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }) {
  const { linkMode, openLink } = useContext(NetworkMapContext);
  const [hovered, setHovered] = useState(false);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const interactive = !linkMode;
  const highlighted = hovered && interactive;
  const baseWidth = Number(style?.strokeWidth) || 1.5;
  const pct = data?.weight != null ? Math.round(data.weight * 100) : null;

  const activate = (e) => {
    e.stopPropagation();
    if (interactive && data?.link) openLink(data.link, id);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ ...style, ...(highlighted ? { stroke: "hsl(var(--primary))", strokeWidth: baseWidth + 2, strokeDasharray: undefined } : {}) }}
      />
      {/* Wide, invisible hit-target so the thin line is easy to hover and click. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: interactive ? "pointer" : "default" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={activate}
      />
      {highlighted && pct != null && (
        <EdgeLabelRenderer>
          <button
            type="button"
            tabIndex={-1}
            onClick={activate}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ position: "absolute", zIndex: 30, transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all", cursor: "pointer" }}
            className="nodrag nopan rounded-full border border-primary/40 bg-card px-2 py-0.5 text-[10px] font-semibold text-primary shadow-sm"
            title="Text similarity (click for link details)"
          >
            {pct}%
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const PathfinderEdge = memo(PathfinderEdgeImpl);
