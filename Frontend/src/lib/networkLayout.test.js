// Run with: npm test   (node:test, no extra dependency)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildNetworkLayout, NODE_WIDTH, NODE_HEIGHT } from "./networkLayout.js";

// sizes -> requirements; cluster k gets sizes[k] members. A size of null means "Ungrouped" (no cluster) with the next number as count.
function requirements(sizes, ungrouped = 0) {
  const out = [];
  sizes.forEach((n, k) => {
    for (let i = 0; i < n; i += 1) out.push({ id: `R${String(k + 1).padStart(2, "0")}-${String(i + 1).padStart(3, "0")}`, title: "t", cluster: `cluster-${k + 1}`, clusterLabel: `Cluster ${k + 1}` });
  });
  for (let i = 0; i < ungrouped; i += 1) out.push({ id: `U-${String(i + 1).padStart(3, "0")}`, title: "t", cluster: null });
  return out;
}

// Absolute rectangles of the cluster boxes and the requirement cards (cards are positioned relative to their box).
function rects(layout) {
  const boxes = layout.nodes.filter((n) => n.type === "clusterBackground").map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.data.width, h: n.data.height }));
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const cards = layout.nodes.filter((n) => n.type === "requirementNode").map((n) => {
    const box = byId.get(n.parentNode);
    return { id: n.id, box: n.parentNode, x: box.x + n.position.x, y: box.y + n.position.y, w: NODE_WIDTH, h: NODE_HEIGHT };
  });
  return { boxes, cards };
}
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const pairs = (list) => list.flatMap((a, i) => list.slice(i + 1).map((b) => [a, b]));
const extent = (list) => ({
  w: Math.max(...list.map((r) => r.x + r.w)) - Math.min(...list.map((r) => r.x)),
  h: Math.max(...list.map((r) => r.y + r.h)) - Math.min(...list.map((r) => r.y)),
});

function assertClean(sizes, ungrouped = 0) {
  const layout = buildNetworkLayout(requirements(sizes, ungrouped), []);
  const { boxes, cards } = rects(layout);
  assert.equal(cards.length, sizes.reduce((a, b) => a + b, 0) + ungrouped);
  const touching = pairs(cards).filter(([a, b]) => overlap(a, b));
  assert.equal(touching.length, 0, `${touching.length} overlapping cards for ${JSON.stringify(sizes)}`);
  const boxClash = pairs(boxes).filter(([a, b]) => overlap(a, b));
  assert.equal(boxClash.length, 0, `${boxClash.length} overlapping cluster boxes for ${JSON.stringify(sizes)}`);
  const byBox = new Map(boxes.map((b) => [b.id, b]));
  for (const c of cards) {
    const b = byBox.get(c.box);
    assert.ok(c.x >= b.x + 40 && c.y >= b.y + 40 && c.x + c.w <= b.x + b.w - 40 && c.y + c.h <= b.y + b.h - 40, `${c.id} is not inside its box with padding`);
  }
  return { layout, boxes, cards };
}

describe("buildNetworkLayout: no overlaps", () => {
  for (const n of [1, 2, 3, 5, 8, 10, 11, 12, 30, 65]) {
    it(`one cluster of ${n} nodes`, () => { assertClean([n]); });
  }

  it("the demo projects (real cluster sizes of SYS-RET, SYS-HMS, SYS-MBA, SYS-ULP in inspid_test)", () => {
    assertClean([9, 7, 8, 2, 2, 3]);
    assertClean([20, 1, 2, 2, 1]);
    assertClean([19, 5, 2, 2, 5, 1]);
    assertClean([18, 2, 1, 1, 1]);
  });

  it("the CCTNS import (115 nodes in clusters of 65, 11, 10, 8, 8, 6, 4, 3) stays under 4000 x 3000", () => {
    const { boxes } = assertClean([65, 11, 10, 8, 8, 6, 4, 3]);
    const { w, h } = extent(boxes);
    assert.ok(w < 4000 && h < 3000, `map is ${Math.round(w)} x ${Math.round(h)}`);
  });

  it("an Ungrouped box (no cluster computed yet) is laid out like any other", () => {
    assertClean([8, 3], 12);
    assertClean([], 30);
  });

  it("clusters of up to 10 keep the ring: the first card is at the top of the ellipse", () => {
    const { cards, boxes } = assertClean([8]);
    const b = boxes[0];
    const centres = cards.map((c) => ({ x: c.x + NODE_WIDTH / 2 - b.x, y: c.y + NODE_HEIGHT / 2 - b.y }));
    const cx = centres.reduce((a, c) => a + c.x, 0) / centres.length;
    assert.ok(Math.abs(centres[0].x - cx) < 1 && centres[0].y === Math.min(...centres.map((c) => c.y)));
  });

  it("a larger cluster is a compact block: 65 nodes are far narrower than the old ring", () => {
    const { boxes } = assertClean([65]);
    assert.ok(boxes[0].w < 2400 && boxes[0].h < 1100, `${Math.round(boxes[0].w)} x ${Math.round(boxes[0].h)}`);
  });
});

describe("buildNetworkLayout: deterministic and unchanged elsewhere", () => {
  it("gives identical output for identical input", () => {
    const sizes = [65, 11, 10, 8, 8, 6, 4, 3];
    const a = JSON.stringify(buildNetworkLayout(requirements(sizes, 2), []));
    const b = JSON.stringify(buildNetworkLayout(requirements(sizes, 2), []));
    assert.equal(a, b);
  });

  it("keeps the node contract: cards are children of their cluster box, ids and edges are untouched", () => {
    const reqs = requirements([3, 2]);
    const links = [{ kind: "pathfinder", source: reqs[0].id, target: reqs[4].id, weight: 0.6 }, { kind: "pathfinder", source: reqs[4].id, target: reqs[0].id, weight: 0.6 }];
    const layout = buildNetworkLayout(reqs, links);
    const card = layout.nodes.find((n) => n.id === reqs[0].id);
    assert.equal(card.parentNode, "bg-cluster-1");
    assert.equal(card.extent, "parent");
    assert.equal(card.type, "requirementNode");
    assert.equal(layout.edges.length, 1); // the duplicate pair is dropped
    assert.equal(layout.edges[0].type, "semantic");
    assert.equal(layout.clusterBoxes.length, 2);
    assert.ok(layout.clusterBoxes.every((b) => b.color && b.label));
  });
});
