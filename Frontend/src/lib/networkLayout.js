// Pure layout computation for the requirements network map. Kept separate from the react-flow rendering
// component so the clustering/placement logic can be reasoned about without touching any rendering code.
//
// Nodes are grouped by their COMPUTED cluster (node.cluster, "cluster-1", ...; null = "Ungrouped"). There is no fixed
// cluster list: cluster boxes are laid out on a grid sized from what the API returned, and coloured from lib/clusters.
// Edges are the backend's Pathfinder links; the line width follows each link's weight (cosine similarity).
import { clusterMeta, clustersOf } from "./clusters.js";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 74; // the tallest RequirementNode card (two-line title), measured in the browser: 74 px

// ---- layout constants (all deterministic: the same input always gives the same positions)
const RING_MAX = 10; // clusters up to this size keep the ring; larger ones use a compact grid
const MIN_GAP = 8; // minimum free space between two node cards
const GRID_GAP_X = 28;
const GRID_GAP_Y = 22;
const GRID_ASPECT = 1.2; // columns = ceil(sqrt(ASPECT * n)): a slightly wide block
const BOX_PAD = 70; // space between the outermost cards and the cluster box
const LABEL_ROOM = 18; // extra room at the top of a box for its label
const CLUSTER_GAP = 80; // free space between two cluster boxes
const SHELF_ASPECT = 2; // target width of the whole map = sqrt(total area * ASPECT)

// The original ring radius for a cluster of `count` nodes.
function clusterRadius(count) {
  if (count <= 1) return 0;
  if (count === 2) return 130;
  return 100 + count * 18;
}

const touching = (a, b) => Math.abs(a.x - b.x) < NODE_WIDTH + MIN_GAP && Math.abs(a.y - b.y) < NODE_HEIGHT + MIN_GAP;

function ringCentres(n, radius) {
  return Array.from({ length: n }, (_, i) => {
    if (n === 1) return { x: 0, y: 0 };
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) * 0.78 }; // flattened a little for a wider ellipse
  });
}

// The ring of the original layout, widened only as far as needed so that no two cards touch.
function ringLayout(n) {
  let radius = clusterRadius(n);
  for (let guard = 0; guard < 400; guard += 1) {
    const pts = ringCentres(n, radius);
    let clash = false;
    for (let i = 0; i < n && !clash; i += 1) for (let j = i + 1; j < n; j += 1) if (touching(pts[i], pts[j])) { clash = true; break; }
    if (!clash) return pts;
    radius += 6;
  }
  return ringCentres(n, radius);
}

// Compact grid for bigger clusters, in the order the requirements were given (by id); an unfinished last row is centred.
function gridLayout(n) {
  const cols = Math.ceil(Math.sqrt(GRID_ASPECT * n));
  const rows = Math.ceil(n / cols);
  const pitchX = NODE_WIDTH + GRID_GAP_X;
  const pitchY = NODE_HEIGHT + GRID_GAP_Y;
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i - row * cols;
    return { x: (col + (cols - inRow) / 2) * pitchX, y: row * pitchY };
  });
}

// One cluster: card centres relative to the box's top-left corner, plus the box size.
function layoutCluster(n) {
  const centres = n <= RING_MAX ? ringLayout(n) : gridLayout(n);
  const minX = Math.min(...centres.map((c) => c.x)) - NODE_WIDTH / 2;
  const maxX = Math.max(...centres.map((c) => c.x)) + NODE_WIDTH / 2;
  const minY = Math.min(...centres.map((c) => c.y)) - NODE_HEIGHT / 2;
  const maxY = Math.max(...centres.map((c) => c.y)) + NODE_HEIGHT / 2;
  const ox = BOX_PAD - minX;
  const oy = BOX_PAD + LABEL_ROOM - minY;
  return {
    centres: centres.map((c) => ({ x: c.x + ox, y: c.y + oy })),
    width: maxX - minX + 2 * BOX_PAD,
    height: maxY - minY + 2 * BOX_PAD + LABEL_ROOM,
  };
}

// Shelf packing of the cluster boxes: biggest first (then by id), left to right, wrapping at a target width taken from the total
// area, so the map stays roughly 3:2 however many clusters there are. Returns the top-left corner of every box.
function packClusters(items) {
  const order = [...items].sort((a, b) => b.n - a.n || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const area = order.reduce((sum, c) => sum + (c.width + CLUSTER_GAP) * (c.height + CLUSTER_GAP), 0);
  const targetWidth = Math.max(...order.map((c) => c.width), Math.sqrt(area * SHELF_ASPECT));
  const corner = new Map();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  order.forEach((c) => {
    if (x > 0 && x + c.width > targetWidth) {
      x = 0;
      y += rowHeight + CLUSTER_GAP;
      rowHeight = 0;
    }
    corner.set(c.id, { x, y });
    x += c.width + CLUSTER_GAP;
    rowHeight = Math.max(rowHeight, c.height);
  });
  return corner;
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

  // Each cluster is laid out on its own (ring up to RING_MAX nodes, compact grid above), then the boxes are packed into rows.
  const local = new Map(clusters.map((c) => [c.id, { ...layoutCluster(byCluster.get(c.id).length), n: byCluster.get(c.id).length, id: c.id }]));
  const corners = packClusters([...local.values()]);

  const positions = new Map();
  const clusterBoxes = [];
  clusters.forEach((cluster) => {
    const lay = local.get(cluster.id);
    const corner = corners.get(cluster.id);
    byCluster.get(cluster.id).forEach((req, i) => positions.set(req.id, { x: corner.x + lay.centres[i].x, y: corner.y + lay.centres[i].y }));
    clusterBoxes.push({
      id: cluster.id,
      label: cluster.label,
      color: cluster.color,
      x: corner.x,
      y: corner.y,
      width: lay.width,
      height: lay.height,
      memberCount: lay.n,
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
      type: "semantic", // PathfinderEdge: clickable, hover highlight
      animated: false,
      zIndex: 5, // above the cluster background boxes (0) so the line can be hovered and clicked, below the requirement nodes (10)
      data: { weight: link.weight, link },
      style: {
        stroke: sameCluster ? "#94a3b8" : "#a8b0bd",
        strokeWidth: strokeWidthFor(link.weight, lo, hi),
        strokeDasharray: sameCluster ? undefined : "4 4",
      },
    });
  });

  return { nodes: [...clusterBgNodes, ...requirementNodes], edges, clusterBoxes, weightRange: { lo, hi } };
}
