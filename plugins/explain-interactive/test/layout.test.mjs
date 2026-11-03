// The diagram layouts (engine/layout.mjs): spec checks, the SVG they produce, and that nothing overlaps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render, checkSpec, LAYOUTS } from "../skills/explain-interactive/engine/layout.mjs";
import { build, loadContent } from "../skills/explain-interactive/build.mjs";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "../skills/explain-interactive");
const EXAMPLES = readdirSync(join(SKILL, "examples")).filter(f => f.endsWith(".content.js"));
const viewBox = svg => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
const ids = svg => [...svg.matchAll(/data-id="([^"]+)"/g)].map(m => m[1]);

test("every example builds with no warnings, and the examples cover every layout", () => {
  const used = new Set();
  for (const f of EXAMPLES) {
    const code = readFileSync(join(SKILL, "examples", f), "utf8");
    const { errors, warnings } = build(code, f);
    assert.deepEqual(errors, [], f);
    assert.deepEqual(warnings, [], f);
    const d = loadContent(code).DIAGRAM;
    if (d && typeof d === "object") used.add(d.layout);
  }
  assert.deepEqual([...used].sort(), [...LAYOUTS].sort());
});

test("a spec's nodes and edges become data-id parts, each edge carrying its label", () => {
  for (const f of EXAMPLES) {
    const spec = loadContent(readFileSync(join(SKILL, "examples", f), "utf8")).DIAGRAM;
    if (!spec || typeof spec !== "object") continue;
    const { svg } = render(spec);
    assert.deepEqual(ids(svg).sort(), [...spec.nodes.map(n => n.id), ...spec.edges.map(e => e.id)].sort(), f);
    for (const e of spec.edges) {
      const part = svg.match(new RegExp(`<g data-id="${e.id}">([\\s\\S]*?)</g>`))[1];
      assert.match(part, /<path class="arrow/, `${f}: ${e.id}`);
      assert.ok(part.includes(`>${e.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`), `${f}: ${e.id} label`);
    }
    const [w] = viewBox(svg);
    assert.ok(w >= 560 && w <= 900, `${f}: width ${w}`);
    assert.match(svg, new RegExp(`aria-label="${spec.label}"`));
  }
});

test("kinds become classes on the box or the arrow", () => {
  const { svg } = render({ layout: "chain", label: "x", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B", kind: "ok" }],
    edges: [{ id: "e", from: "a", to: "b", label: "go", kind: "bad flow" }] });
  assert.match(svg, /<rect class="box ok"/);
  assert.match(svg, /<path class="arrow bad flow"/);
});

test("labels are escaped", () => {
  const { svg } = render({ layout: "sequence", label: `a "b" <c>`, nodes: [{ id: "a", label: "A<b>" }, { id: "b", label: "B&C" }],
    edges: [{ id: "e", from: "a", to: "b", label: "<script>" }] });
  assert.doesNotMatch(svg, /<script>|<b>/);
  assert.match(svg, /A&lt;b&gt;/);
  assert.match(svg, /aria-label="a &quot;b&quot; &lt;c&gt;"/);
});

test("checkSpec reports broken specs", () => {
  const errs = s => checkSpec(s).errors.join("\n");
  assert.match(errs({ layout: "tree", label: "x", nodes: [{ id: "a", label: "A" }] }), /layout must be one of/);
  assert.match(errs({ layout: "chain", nodes: [{ id: "a", label: "A" }] }), /label is missing/);
  assert.match(errs({ layout: "chain", label: "x", nodes: [] }), /nodes must be a non-empty array/);
  assert.match(errs({ layout: "chain", label: "x", nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "zz", label: "l" }] }), /to names "zz", which is not a node id/);
  assert.match(errs({ layout: "chain", label: "x", nodes: [{ id: "a", label: "A" }, { id: "a", label: "B" }] }), /"a" is used twice/);
  assert.match(errs({ layout: "states", label: "x", nodes: [{ id: "a", label: "A" }], edges: [{ id: "a", from: "a", to: "a", label: "l" }] }), /"a" is used twice/);
  assert.match(errs({ layout: "chain", label: "x", nodes: [{ id: "a", label: "A" }, { id: "r", label: "R", branch: true }],
    edges: [{ id: "e", from: "r", to: "a", label: "l" }] }), /starts at branch node "r"/);
  assert.match(errs({ layout: "layers", label: "x", nodes: [{ id: "a", label: "A" }], edges: [{ id: "e", from: "a", to: "a", label: "l" }] }), /from a band to itself/);
  assert.match(errs({ layout: "chain", label: "x", nodes: [{ id: "a b", label: "A" }] }), /must be letters/);
  assert.match(errs({ layout: "chain", label: "x", nodes: [{ id: "a", label: "A", kind: "red" }] }), /kind must be one of bad, ok/);

  const warns = s => checkSpec(s).warnings.join("\n");
  assert.match(warns({ layout: "chain", label: "x", nodes: [{ id: "a", label: "A", colour: "red" }] }), /unknown field "colour"/);
  assert.match(warns({ layout: "chain", label: "x", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ id: "e", from: "a", to: "b" }] }), /label is missing/);
  assert.match(warns({ layout: "chain", label: "x", nodes: [...Array(9)].map((_, i) => ({ id: "n" + i, label: "N" })) }), /9 nodes/);
});

test("an edge without an id is named from-to", () => {
  const { svg, errors } = render({ layout: "chain", label: "x", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b", label: "go" }] });
  assert.deepEqual(errors, []);
  assert.ok(ids(svg).includes("a-b"));
});

test("a wide diagram is reported", () => {
  const nodes = [...Array(7)].map((_, i) => ({ id: "n" + i, label: "orders-service-" + i }));
  const { warnings } = render({ layout: "chain", label: "x", nodes, edges: nodes.slice(1).map((n, i) => ({ id: "e" + i, from: "n" + i, to: n.id, label: "GET /orders/{id}" })) });
  assert.ok(warnings.some(w => /units wide/.test(w)), warnings.join("\n"));
});

// Random sparse specs of every layout: boxes and labels never overlap each other. (A line may pass under another edge's
// label, whose background hides it, and a dense states graph may route an edge across a box; both are left out here.)
test("no layout overlaps boxes or labels, on many random specs", () => {
  let seed = 7;
  const rnd = n => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const words = ["Client", "Gateway", "orders-svc", "Token issuer", "Cache", "DB", "Queue", "Auth", "Rate limit"];
  const labels = ["GET /orders", "401", "200 OK", "POST /token", "publish", "retry", "xDS push", "expired token", "valid"];
  for (const layout of LAYOUTS) for (let r = 0; r < 300; r++) {
    const n = 2 + rnd(6);
    const nodes = [...Array(n)].map((_, i) => ({ id: "n" + i, label: words[rnd(words.length)], ...(layout === "chain" && i > 1 && rnd(3) === 0 ? { branch: true } : {}) }));
    const edges = [];
    for (let k = 0; k < n + 1; k++) {
      const a = rnd(n), b = rnd(n);
      if (a === b && (layout === "chain" || layout === "layers")) continue;
      if (layout === "chain" && nodes[a].branch) continue;
      if (layout !== "sequence" && edges.some(x => x.from === "n" + a && x.to === "n" + b)) continue;
      edges.push({ id: "e" + k, from: "n" + a, to: "n" + b, label: labels[rnd(labels.length)] });
    }
    const { errors, warnings } = render({ layout, label: "x", nodes, edges });
    const spec = JSON.stringify({ nodes, edges });
    assert.deepEqual(errors, [], `${layout} ${spec}`);
    assert.deepEqual(warnings.filter(w => /overlaps/.test(w)), [], `${layout} ${spec}`);
    if (layout !== "states") assert.deepEqual(warnings.filter(w => /runs through/.test(w)), [], `${layout} ${spec}`);
  }
});
