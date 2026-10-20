import { useContext, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "reactflow";
import { Link2, X } from "lucide-react";
import { NetworkMapContext } from "./networkMapContext";
import { manualToDetail } from "../../../lib/networkStats";

// The visually-distinct edge type for a human-created link: the same "ripple" purple token Schedule already uses as
// its one deliberately distinct third hue, a dashed pattern the automatic edges don't use, and a small persistent
// "manual" pill at the midpoint. Clicking the line or the pill opens the "Link details" panel (unless link mode is on).
// The pill also carries the only way to remove one: an "x" that only appears on hover, and only when `canRemove` is
// true (PM viewing it). The "x" never opens the panel.
export function ManualLinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const { linkMode, openLink } = useContext(NetworkMapContext);
  const [hovered, setHovered] = useState(false);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const interactive = !linkMode;

  const open = (e) => {
    e.stopPropagation();
    if (!interactive || !data?.link) return;
    openLink(manualToDetail(data.link), id);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: "hsl(var(--status-ripple-fg))", strokeWidth: hovered && interactive ? 3.4 : 1.8, strokeDasharray: "6 3" }}
      />
      {/* Wide, invisible hit-target so hovering/clicking near (not just exactly on) the thin path works. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: interactive ? "pointer" : "default" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={open}
      />
      <EdgeLabelRenderer>
        <div
          style={{ position: "absolute", zIndex: 30, transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all", cursor: interactive ? "pointer" : "default" }}
          className="nodrag nopan"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={open}
        >
          <div className="flex items-center gap-1 rounded-full border border-status-ripple-fg/30 bg-status-ripple-bg px-1.5 py-0.5 shadow-sm">
            <Link2 className="h-2.5 w-2.5 text-status-ripple-fg" />
            {data?.canRemove && hovered && (
              <button
                onClick={(e) => {
                  e.stopPropagation(); // removing must not open the details panel
                  data.onRemove(data.link);
                }}
                title="Remove manual link"
                className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-status-dropped-fg hover:bg-status-dropped-bg"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
