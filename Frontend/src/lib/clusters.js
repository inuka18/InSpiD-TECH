// Clusters now come from the backend (computed from the requirement texts), as `cluster` ("cluster-1", ...)
// and `clusterLabel` ("Cluster 1 (payments, card)") on every requirement and network node. There is no fixed
// cluster list any more: groups and colours are derived from whatever the API returns. A null cluster means the
// network has not been computed yet and is shown as "Ungrouped".

export const UNGROUPED = { id: "ungrouped", label: "Ungrouped", color: "#94a3b8" };

const PALETTE = ["#6366f1", "#0ea5e9", "#f59e0b", "#ec4899", "#14b8a6", "#8b5cf6", "#84cc16", "#ef4444", "#06b6d4", "#a855f7"];

const numberOf = (id) => Number(String(id ?? "").replace(/\D/g, "")) || 0;

export function clusterColor(id) {
  if (!id) return UNGROUPED.color;
  return PALETTE[(Math.max(numberOf(id), 1) - 1) % PALETTE.length];
}

// { id, label, color } for one requirement / node.
export function clusterMeta(item) {
  if (!item?.cluster) return UNGROUPED;
  return { id: item.cluster, label: item.clusterLabel || item.cluster, color: clusterColor(item.cluster) };
}

// Distinct clusters of a list of requirements / nodes: [{ id, label, color, count }], numbered clusters first,
// "Ungrouped" last (only if some item has no cluster).
export function clustersOf(items) {
  const map = new Map();
  items.forEach((item) => {
    const meta = clusterMeta(item);
    const entry = map.get(meta.id) ?? { ...meta, count: 0 };
    entry.count += 1;
    map.set(meta.id, entry);
  });
  return [...map.values()].sort((a, b) => {
    if (a.id === UNGROUPED.id) return 1;
    if (b.id === UNGROUPED.id) return -1;
    return numberOf(a.id) - numberOf(b.id);
  });
}
