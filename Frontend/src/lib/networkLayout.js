// Pure layout computation for the requirements network map. Kept separate from the react-flow rendering
// component so the clustering/placement logic can be reasoned about without touching any rendering code.
//
// Nodes are grouped by their COMPUTED cluster (node.cluster, "cluster-1", ...; null = "Ungrouped"). There is no fixed
// cluster list: cluster boxes are laid out on a grid sized from what the API returned, and coloured from lib/clusters.
// Edges are the backend's Pathfinder links; the line width follows each link's weight (cosine similarity).
import { clusterMeta, clustersOf } from "./clusters";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 66;

function clusterRadius(count) {
  if (count <= 1) return 0;
  if (count === 2) return 130;
  return 100 + count * 18;
}

// Link weight -> stroke width in px. Scaled between the weakest and strongest link of this network.
export function strokeWidthFor(weight, lo, hi) {
  if (weight == null) return 1.4;
  if (hi - lo < 1e-9) return 2.4;
  return 1 + 4 * ((weight - lo) / (hi - lo));
}

export function buildNetworkLayout(requirements, links = []) {
  const clusters = clustersOf(requirements); // ordered: numbered clusters first, "Ungrouped" last
  const byCluster = new Map(clusters.map((c) => [c.id, []]));
  requirements.forEach((req) => byCluster.get(clusterMeta(req).id).push(req));

  // Grid of cluster cells, sized from the biggest cluster so boxes never overlap.
  const cols = Math.max(1, Math.ceil(Math.sqrt(clusters.length)));
  const maxRadius = Math.max(0, ...clusters.map((c) => clusterRadius(c.count)));
  const cellW = 2 * maxRadius + NODE_WIDTH + 220;
  const cellH = 2 * maxRadius * 0.78 + NODE_HEIGHT + 260;

  const positions = new Map();
  const clusterBoxes = [];

  clusters.forEach((cluster, index) => {
    const members = byCluster.get(cluster.id);
    const anchor = { x: (index % cols) * cellW + cellW / 2, y: Math.floor(index / cols) * cellH + cellH / 2 };
    const radius = clusterRadius(members.length);

    members.forEach((req, i) => {
      let x;
      let y;
      if (members.length === 1) {
        x = anchor.x;
        y = anchor.y;
      } else {
        const angle = (i / members.length) * Math.PI * 2 - Math.PI / 2;
        x = anchor.x + radius * Math.cos(angle);
        y = anchor.y + radius * Math.sin(angle) * 0.78; // flatten slightly for a wider ellipse
      }
      positions.set(req.id, { x, y });
    });

    const xs = members.map((m) => positions.get(m.id).x);
    const ys = members.map((m) => positions.get(m.id).y);
    const pad = 70;
    const minX = Math.min(...xs) - NODE_WIDTH / 2 - pad;
    const maxX = Math.max(...xs) + NODE_WIDTH / 2 + pad;
    const minY = Math.min(...ys) - NODE_HEIGHT / 2 - pad - 18; // extra top room for the label
    const maxY = Math.max(...ys) + NODE_HEIGHT / 2 + pad;

    clusterBoxes.push({
      id: cluster.id,
      label: cluster.label,
      color: cluster.color,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      memberCount: members.length,
    });
  });

  // Cluster backgrounds are draggable as a group: each requirement node declares its `bg-<clusterId>` node as parent.
  const clusterBgNodes = clusterBoxes.map((box) => ({
    id: `bg-${box.id}`,
    type: "clusterBackground",
    position: { x: box.x, y: box.y },
    data: { label: box.label, color: box.color, width: box.width, height: box.height, count: box.memberCount },
    style: { width: box.width, height: box.height },
    draggable: true,
    selectable: false,
    zIndex: 0,
  }));

  const clusterBoxById = new Map(clusterBoxes.map((box) => [box.id, box]));

  const requirementNodes = requirements.map((req) => {
    const pos = positions.get(req.id) ?? { x: 0, y: 0 };
    const meta = clusterMeta(req);
    const absoluteX = pos.x - NODE_WIDTH / 2;
    const absoluteY = pos.y - NODE_HEIGHT / 2;
    const box = clusterBoxById.get(meta.id);

    return {
      id: req.id,
      type: "requirementNode",
      // Relative to the parent cluster box's top-left corner once a parent is set.
      position: box ? { x: absoluteX - box.x, y: absoluteY - box.y } : { x: absoluteX, y: absoluteY },
      parentNode: box ? `bg-${meta.id}` : undefined,
      extent: box ? "parent" : undefined,
      data: { requirement: req, clusterColor: meta.color },
      draggable: true,
      zIndex: 10,
    };
  });

  // The backend's computed (Pathfinder) links, deduplicated. Manual links are drawn separately by NetworkMap.
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const auto = links.filter((l) => l.kind === "pathfinder" && byId.has(l.source) && byId.has(l.target));
  const weights = auto.map((l) => l.weight).filter((w) => w != null);
  const lo = weights.length ? Math.min(...weights) : 0;
  const hi = weights.length ? Math.max(...weights) : 0;

  const seenPairs = new Set();
  const edges = [];
  auto.forEach((link) => {
    const key = [link.source, link.target].sort().join("__");
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    const sameCluster = clusterMeta(byId.get(link.source)).id === clusterMeta(byId.get(link.target)).id;
    edges.push({
      id: `e-${key}`,
      source: link.source,
      target: link.target,
      type: "smoothstep",
      animated: false,
      data: { weight: link.weight },
      style: {
        stroke: sameCluster ? "#94a3b8" : "#a8b0bd",
        strokeWidth: strokeWidthFor(link.weight, lo, hi),
        strokeDasharray: sameCluster ? undefined : "4 4",
      },
    });
  });

  return { nodes: [...clusterBgNodes, ...requirementNodes], edges, clusterBoxes, weightRange: { lo, hi } };
}
