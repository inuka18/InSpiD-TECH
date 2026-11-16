// Small pure helpers for the "Link details" panel of the network map. No dependencies.

export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

const isScored = (l) => l.kind === "pathfinder" && l.weight != null;

// min / max / average similarity (0-1) over the project's computed links.
export function networkWeightStats(links) {
  const weights = links.filter(isScored).map((l) => l.weight);
  if (!weights.length) return null;
  return {
    count: weights.length,
    min: Math.min(...weights),
    max: Math.max(...weights),
    avg: weights.reduce((s, w) => s + w, 0) / weights.length,
  };
}

// Rank of `link` among all computed links that touch `requirementId`, strongest first: { rank, total } (rank 1 = strongest).
export function linkRank(link, requirementId, links) {
  const mine = links
    .filter((l) => isScored(l) && (l.source === requirementId || l.target === requirementId))
    .sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1));
  const idx = mine.findIndex((l) => l.id === link.id);
  return { rank: idx + 1, total: mine.length };
}

export function rankPhrase(requirementId, { rank, total }) {
  if (rank < 1 || total < 1) return null;
  const how = rank === 1 ? "strongest link" : `${ordinal(rank)} strongest link`;
  return `${how} of ${requirementId} (${rank} of ${total})`;
}

// A manual link as the details panel wants it (the UI's manual links use sourceId / targetId).
export function manualToDetail(l) {
  return { id: l.id, kind: "manual", source: l.sourceId, target: l.targetId, reason: l.reason, createdBy: l.createdBy, createdAt: l.createdAt, raw: l };
}

// ---- key shared terms
const STOPWORDS = new Set(
  ("the and for with that this from into onto over under than then them they their there these those are was were been being have has had not " +
    "but can could may might will would shall should must also any all each every some such only more most other another via per out off its " +
    "our your you who whom whose which what when where while how why able allow allows allowed ensure ensures provide provides providing " +
    "use used uses using user users system systems should within without across between before after during about above below")
    .split(" ")
);

const tokens = (text) => String(text ?? "").toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];

function counts(text) {
  const m = new Map();
  tokens(text).forEach((w) => {
    if (!STOPWORDS.has(w)) m.set(w, (m.get(w) ?? 0) + 1);
  });
  return m;
}

// The most informative words two texts share: words in both, ranked by how often they occur in both and by length
// (longer words are usually more specific). Returns [] when nothing meaningful is shared.
export function sharedTerms(textA, textB, max = 8) {
  const a = counts(textA);
  const b = counts(textB);
  return [...a.keys()]
    .filter((w) => b.has(w))
    .map((w) => ({ w, score: Math.min(a.get(w), b.get(w)) * (1 + Math.min(w.length, 12) / 12) }))
    .sort((x, y) => y.score - x.score || y.w.length - x.w.length || x.w.localeCompare(y.w))
    .slice(0, max)
    .map((x) => x.w);
}
