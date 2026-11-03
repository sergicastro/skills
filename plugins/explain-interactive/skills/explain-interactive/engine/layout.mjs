/* explain-interactive diagram layout: turns a DIAGRAM spec into the SVG the engine shows. Runs in build.mjs (no DOM).
     { layout: "sequence" | "chain" | "layers" | "states", label, nodes: [{ id, label, kind?, branch?, term? }],
       edges: [{ id?, from, to, label, kind?, term? }] }
   Every node and edge becomes a <g data-id="…">, the same shape a hand-written DIAGRAM uses, so a step's
   hl / dim / hide / build work on it unchanged. There is no browser at build time, so text widths come from a table
   that errs wide: a box a little too roomy reads fine, a clipped label doesn't. After laying out, the result is checked
   for overlaps with the same estimates and each one becomes a build warning. Field reference: diagram-recipes.md. */

export const LAYOUTS = ["sequence", "chain", "layers", "states"];
const KINDS = { node: ["bad", "ok"], edge: ["bad", "ok", "flow"] };
const KEYS = { spec: ["layout", "label", "nodes", "edges"], node: ["id", "label", "kind", "branch", "term"], edge: ["id", "from", "to", "label", "kind", "term"] };

const NODE_FONT = 16, LABEL_FONT = 14, NODE_H = 44, PAD_X = 18, MIN_NODE_W = 96, LABEL_H = 18;
const MARGIN = 12, MIN_WIDTH = 560, MAX_WIDTH = 900, MAX_NODES = 7;

// Advance widths in em for system-ui faces, rounded up
function textWidth(s, size) {
  let em = 0;
  for (const ch of String(s)) {
    if (ch === " ") em += .3;
    else if ("iljI.,:;'|!`".includes(ch)) em += .3;
    else if ("ftr()[]{}/\\-\"*".includes(ch)) em += .42;
    else if ("mwMW@%&".includes(ch)) em += .92;
    else if (/[A-Z]/.test(ch)) em += .72;
    else if (/[0-9a-z]/.test(ch)) em += .58;
    else if (ch.codePointAt(0) > 0x2e7f) em += 1.05;   // CJK and other full-width text
    else em += .7;
  }
  return Math.ceil(em * size);
}
const nodeW = n => Math.max(MIN_NODE_W, textWidth(n.label, NODE_FONT) + 2 * PAD_X);
const labelW = s => (s ? textWidth(s, LABEL_FONT) + 10 : 0);

const r1 = v => Math.round(v * 10) / 10;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kindClass = k => (k ? " " + String(k).trim().split(/\s+/).join(" ") : "");

// ---------- Check the spec ----------
export function checkSpec(spec) {
  const errors = [], warnings = [];
  const unknownKeys = (o, keys, what) => Object.keys(o).filter(k => !keys.includes(k))
    .forEach(k => warnings.push(`${what} has an unknown field "${k}" (known: ${keys.join(", ")})`));
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return { errors: ["DIAGRAM must be an <svg> string or a spec object { layout, label, nodes, edges }"], warnings };
  unknownKeys(spec, KEYS.spec, "DIAGRAM");
  if (!LAYOUTS.includes(spec.layout)) errors.push(`DIAGRAM.layout must be one of ${LAYOUTS.join(", ")} (got ${JSON.stringify(spec.layout)})`);
  if (!spec.label || typeof spec.label !== "string") errors.push("DIAGRAM.label is missing: one sentence describing the picture, read out by screen readers");
  if (!Array.isArray(spec.nodes) || !spec.nodes.length) { errors.push("DIAGRAM.nodes must be a non-empty array of { id, label }"); return { errors, warnings }; }
  if (spec.edges !== undefined && !Array.isArray(spec.edges)) { errors.push("DIAGRAM.edges must be an array of { id, from, to, label }"); return { errors, warnings }; }

  const ids = new Set(), nodeIds = new Set();
  const claim = (id, what) => {
    if (typeof id !== "string" || !/^[\w.-]+$/.test(id)) { errors.push(`${what}: id ${JSON.stringify(id)} must be letters, digits, "_", "-" or "."`); return; }
    if (ids.has(id)) errors.push(`${what}: id "${id}" is used twice (nodes and edges share one set of ids)`);
    ids.add(id);
  };
  spec.nodes.forEach((n, i) => {
    const what = `DIAGRAM.nodes[${i}]`;
    if (!n || typeof n !== "object") return errors.push(`${what} must be an object { id, label }`);
    unknownKeys(n, KEYS.node, what);
    claim(n.id, what); nodeIds.add(n.id);
    if (!n.label || typeof n.label !== "string") errors.push(`${what} ("${n.id}"): label is missing`);
    else if (n.label.length > 24) warnings.push(`${what} ("${n.id}"): label "${n.label}" is long; a box holds a name of ≤ 3 words`);
    if (n.kind !== undefined && !KINDS.node.includes(n.kind)) errors.push(`${what} ("${n.id}"): kind must be one of ${KINDS.node.join(", ")}`);
    if (n.branch && spec.layout !== "chain") warnings.push(`${what} ("${n.id}"): branch only applies to the chain layout`);
  });
  (spec.edges || []).forEach((e, i) => {
    const what = `DIAGRAM.edges[${i}]`;
    if (!e || typeof e !== "object") return errors.push(`${what} must be an object { id, from, to, label }`);
    unknownKeys(e, KEYS.edge, what);
    for (const end of ["from", "to"]) if (!nodeIds.has(e[end])) errors.push(`${what}: ${end} names "${e[end]}", which is not a node id`);
    claim(e.id ?? `${e.from}-${e.to}`, e.id === undefined ? `${what} (no id, so "${e.from}-${e.to}"; give it an id if that repeats)` : what);
    if (!e.label) warnings.push(`${what} ("${e.id ?? `${e.from}-${e.to}`}"): label is missing; say what travels on it (the real value)`);
    if (e.kind !== undefined && String(e.kind).trim().split(/\s+/).some(k => !KINDS.edge.includes(k)))
      errors.push(`${what}: kind must be made of ${KINDS.edge.join(", ")} (e.g. "bad flow")`);
    if (e.from === e.to && spec.layout === "layers") errors.push(`${what}: a layers diagram can't draw an edge from a band to itself`);
    if (e.from === e.to && spec.layout === "chain") errors.push(`${what}: a chain diagram can't draw an edge from a box to itself (use states)`);
  });
  if (spec.nodes.length > MAX_NODES) warnings.push(`DIAGRAM has ${spec.nodes.length} nodes; keep it to ~${MAX_NODES} (merge or drop what this explanation doesn't need)`);
  if (spec.layout === "chain") {
    if (spec.nodes.every(n => n.branch)) errors.push("DIAGRAM: a chain needs at least one node without branch: true");
    const branch = new Set(spec.nodes.filter(n => n && n.branch).map(n => n.id));
    (spec.edges || []).forEach((e, i) => e && branch.has(e.from) && errors.push(`DIAGRAM.edges[${i}]: starts at branch node "${e.from}"; in a chain a branch is where a request ends (a rejection), so edges only lead to it (use states for a graph)`));
  }
  return { errors, warnings };
}

// ---------- Geometry bookkeeping ----------
// Each layout fills a Scene: drawn parts in order, plus the rectangles and polylines the overlap check reads.
// term: the CAST/GLOSSARY entry a part stands for, when its label doesn't name it; the page shows it on click
const termAttr = x => x.term ? ` data-term="${esc(x.term)}"` : "";
class Scene {
  constructor() { this.parts = []; this.boxes = []; this.labels = []; this.paths = []; this.extra = []; }
  node(n, x, y, w, h, inner = "") {
    this.boxes.push({ id: n.id, x, y, w, h });
    this.parts.push(`<g data-id="${n.id}"${termAttr(n)}><rect class="box${kindClass(n.kind)}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="8"/>` +
      `<text x="${r1(x + w / 2)}" y="${r1(y + h / 2 + NODE_FONT * .35)}" text-anchor="middle">${esc(n.label)}</text>${inner}</g>`);
  }
  // A label is placed by its centre; a background keeps lines that pass behind it from cutting through the text.
  // If that spot is taken by a box or an earlier label (parallel edges share one), it moves by `step` until it is free.
  edge(e, path, lx, ly, step = [0, LABEL_H + 4]) {
    this.paths.push({ id: e.id, from: e.from, to: e.to, pts: path.pts });
    let lab = "";
    if (e.label) {
      const w = labelW(e.label);
      const at = k => ({ x: lx + step[0] * k - w / 2, y: ly + step[1] * k - LABEL_H / 2, w, h: LABEL_H });
      const free = r => !this.labels.some(l => hit(l, r)) && !this.boxes.some(b => hit(b, r));
      const k = [0, 1, -1, 2, -2, 3, -3, 4].find(k => free(at(k))) ?? 0;
      ({ x: lx, y: ly } = at(k)); lx += w / 2; ly += LABEL_H / 2;
      const x = lx - w / 2, y = ly - LABEL_H / 2;
      this.labels.push({ id: e.id, x, y, w, h: LABEL_H });
      lab = `<rect class="label-bg" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${LABEL_H}" rx="3"/>` +
        `<text class="label" x="${r1(lx)}" y="${r1(ly + LABEL_FONT * .35)}" text-anchor="middle">${esc(e.label)}</text>`;
    }
    this.parts.push(`<g data-id="${e.id}"${termAttr(e)}><path class="arrow${kindClass(e.kind)}" d="${path.d}"/>${lab}</g>`);
  }
}

class Path {
  constructor(x, y) { this.d = `M${r1(x)},${r1(y)}`; this.pts = [[x, y]]; this.x = x; this.y = y; }
  L(x, y) { this.d += ` L${r1(x)},${r1(y)}`; this.pts.push([x, y]); this.x = x; this.y = y; return this; }
  H(x) { return this.L(x, this.y); }
  V(y) { return this.L(this.x, y); }
  C(ax, ay, bx, by, x, y) {
    const [x0, y0] = [this.x, this.y];
    for (let k = 1; k <= 16; k++) {
      const t = k / 16, u = 1 - t;
      this.pts.push([u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y]);
    }
    this.d += ` C${r1(ax)},${r1(ay)} ${r1(bx)},${r1(by)} ${r1(x)},${r1(y)}`; this.x = x; this.y = y; return this;
  }
}

// ---------- Layouts ----------
// sequence: actors as columns with lifelines, one message per row in the order of `edges`
function sequence(spec, sc) {
  const { nodes } = spec, edges = spec.edges, col = new Map(nodes.map((n, i) => [n.id, i]));
  const w = nodes.map(nodeW);
  const gap = nodes.slice(1).map((_, i) => w[i] / 2 + w[i + 1] / 2 + 32);   // centre-to-centre distance i → i+1
  let tail = w[w.length - 1] / 2;   // room right of the last centre
  // Widen the columns a message's label spans until it fits; shortest spans first so long ones only take what's missing
  const spans = edges.filter(e => e.from !== e.to).map(e => [Math.min(col.get(e.from), col.get(e.to)), Math.max(col.get(e.from), col.get(e.to)), labelW(e.label) + 24])
    .sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
  for (const [lo, hi, need] of spans) {
    const have = gap.slice(lo, hi).reduce((a, b) => a + b, 0);
    if (have < need) for (let i = lo; i < hi; i++) gap[i] += (need - have) / (hi - lo);
  }
  // A message to itself loops right of its lifeline, its label beside the loop
  for (const e of edges.filter(e => e.from === e.to)) {
    const i = col.get(e.from), need = 40 + labelW(e.label) + 12;
    if (i < gap.length) gap[i] = Math.max(gap[i], need); else tail = Math.max(tail, need);
  }
  const cx = [0]; gap.forEach(g => cx.push(cx[cx.length - 1] + g));
  const headBottom = NODE_H;
  let y = headBottom + 44;
  const rows = edges.map(e => { const r = y; y += e.from === e.to ? 64 : 50; return r; });
  const bottom = y - 22;
  nodes.forEach((n, i) => sc.node(n, cx[i] - w[i] / 2, 0, w[i], NODE_H,
    `<line class="lifeline" x1="${r1(cx[i])}" y1="${headBottom}" x2="${r1(cx[i])}" y2="${r1(bottom)}"/>`));
  sc.extra.push([cx[cx.length - 1] + tail, bottom]);
  edges.forEach((e, k) => {
    const a = cx[col.get(e.from)], b = cx[col.get(e.to)], ry = rows[k];
    if (e.from === e.to) {
      const p = new Path(a + 2, ry).H(a + 32).V(ry + 24).H(a + 4);
      return sc.edge(e, p, a + 40 + labelW(e.label) / 2, ry + 12);
    }
    const dir = Math.sign(b - a), p = new Path(a + 2 * dir, ry).H(b - 3 * dir);
    sc.edge(e, p, (a + b) / 2, ry - 13);
  });
}

// chain: boxes left to right in node order; branch: true nodes (the rejected path) drop below the box that leads to them
function chain(spec, sc) {
  const main = spec.nodes.filter(n => !n.branch), side = spec.nodes.filter(n => n.branch);
  const pos = new Map(main.map((n, i) => [n.id, i])), w = new Map(spec.nodes.map(n => [n.id, nodeW(n)]));
  const straight = new Set(), arcs = [], drops = [], usedPair = new Set();
  for (const e of spec.edges) {
    const i = pos.get(e.from), j = pos.get(e.to);
    if (i !== undefined && j === i + 1 && !usedPair.has(i)) { straight.add(e); usedPair.add(i); }
    else if (i !== undefined && j !== undefined) arcs.push(e);
    else drops.push(e);   // checkSpec refuses edges that start at a branch node
  }
  const gap = main.slice(1).map((n, i) => w.get(main[i].id) / 2 + w.get(n.id) / 2 + 48);
  for (const e of straight) { const i = pos.get(e.from); gap[i] = Math.max(gap[i], w.get(e.from) / 2 + w.get(e.to) / 2 + labelW(e.label) + 20); }
  for (const e of drops) { const i = pos.get(e.from); if (i < gap.length) gap[i] = Math.max(gap[i], labelW(e.label) + 28); }
  const cx = [0]; gap.forEach(g => cx.push(cx[cx.length - 1] + g));

  // Arcs above the row, nested by span so a longer arc clears a shorter one
  const levels = [];
  arcs.map(e => ({ e, lo: Math.min(pos.get(e.from), pos.get(e.to)), hi: Math.max(pos.get(e.from), pos.get(e.to)) }))
    .sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))
    .forEach(a => { a.level = 1 + Math.max(0, ...levels.filter(o => o.lo <= a.hi && a.lo <= o.hi).map(o => o.level)); levels.push(a); });
  const top = 0, mid = top + NODE_H / 2;
  main.forEach((n, i) => sc.node(n, cx[i] - w.get(n.id) / 2, top, w.get(n.id), NODE_H));

  // Branch row: each branch node under the box that leads to it, pushed right where two would touch
  const below = top + NODE_H + 76, bx = new Map();
  const want = side.map(n => { const src = drops.find(e => e.to === n.id); return { n, x: src ? cx[pos.get(src.from)] : cx[0] }; })
    .sort((a, b) => a.x - b.x);
  let right = -Infinity;
  for (const { n, x } of want) {
    const half = w.get(n.id) / 2, c = Math.max(x, right + 32 + half);
    bx.set(n.id, c); right = c + half;
    sc.node(n, c - half, below, w.get(n.id), NODE_H);
  }
  for (const e of straight) {
    const i = pos.get(e.from), a = cx[i] + w.get(e.from) / 2, b = cx[i + 1] - w.get(e.to) / 2;
    sc.edge(e, new Path(a, mid).H(b - 2), (a + b) / 2, mid - 13);
  }
  for (const e of drops) {
    const s = cx[pos.get(e.from)], half = w.get(e.from) / 2 - 14, t = bx.get(e.to);
    const sx = Math.max(s - half, Math.min(s + half, t)), p = new Path(sx, top + NODE_H).L(t, below - 2);
    sc.edge(e, p, (sx + t) / 2 + 8 + labelW(e.label) / 2, (top + NODE_H + below) / 2);
  }
  // Square arcs, one band per nesting level: an outer arc stays clear of an inner one's label. Where two arcs share
  // a box, the outer one leaves nearer the box's far edge so their verticals don't cross.
  for (const a of levels) {
    const { e } = a, s = cx[pos.get(e.from)], t = cx[pos.get(e.to)], d = Math.sign(t - s) || 1;
    const h = 30 + 30 * a.level, inset = Math.max(-30, 30 - 10 * a.level), sx = s + inset * d, tx = t - inset * d, y = top - h;
    const p = new Path(sx, top).V(y + 8).C(sx, y, sx, y, sx + 8 * d, y).H(tx - 8 * d).C(tx, y, tx, y, tx, y + 8).V(top - 2);
    sc.edge(e, p, (sx + tx) / 2, y);
  }
}

// layers: full-width bands stacked top to bottom; edges between neighbouring bands run in the gap, longer ones in lanes on the right
function layers(spec, sc) {
  const { nodes, edges } = spec, row = new Map(nodes.map((n, i) => [n.id, i]));
  const near = edges.filter(e => Math.abs(row.get(e.from) - row.get(e.to)) === 1);
  const far = edges.filter(e => Math.abs(row.get(e.from) - row.get(e.to)) > 1);
  const byGap = nodes.slice(1).map((_, k) => near.filter(e => Math.min(row.get(e.from), row.get(e.to)) === k));
  // Bands only as wide as their content needs: the viewBox is padded to MIN_WIDTH anyway, and a wider band shrinks the text
  let W = Math.max(320, ...nodes.map(n => nodeW(n) + 80));
  for (const es of byGap) if (es.length) W = Math.max(W, (es.length + 1) * Math.max(...es.map(e => labelW(e.label) + 28)));
  const GAP = 52, y = nodes.map((_, i) => i * (NODE_H + GAP));
  nodes.forEach((n, i) => sc.node(n, 0, y[i], W, NODE_H));
  byGap.forEach((es, k) => es.forEach((e, m) => {
    const x = W * (m + 1) / (es.length + 1), down = row.get(e.to) > row.get(e.from);
    const y0 = down ? y[k] + NODE_H : y[k + 1], y1 = down ? y[k + 1] - 2 : y[k] + NODE_H + 2;
    sc.edge(e, new Path(x, y0).V(y1), x + 8 + labelW(e.label) / 2, y[k] + NODE_H + GAP / 2);
  }));
  const laneX = m => W + 22 + 18 * m, labelX = W + 22 + 18 * far.length;
  far.forEach((e, m) => {
    const ys = y[row.get(e.from)] + NODE_H / 2 + 6, yt = y[row.get(e.to)] + NODE_H / 2 - 6;
    const p = new Path(W, ys).H(laneX(m)).V(yt).H(W + 2);
    sc.edge(e, p, labelX + labelW(e.label) / 2, (ys + yt) / 2);
  });
}

// states: a layered graph, left to right. Ranks by longest path from the first node; back edges and loops become arcs.
function states(spec, sc) {
  const { nodes, edges } = spec, N = nodes.length, at = new Map(nodes.map((n, i) => [n.id, i]));
  const loops = edges.filter(e => e.from === e.to), links = edges.filter(e => e.from !== e.to);
  const out = nodes.map(() => []);
  links.forEach(e => out[at.get(e.from)].push(e));
  const seen = new Array(N).fill(0), back = new Set(), post = [];
  const dfs = u => { seen[u] = 1; for (const e of out[u]) { const v = at.get(e.to); if (seen[v] === 1) back.add(e); else if (!seen[v]) dfs(v); } seen[u] = 2; post.push(u); };
  nodes.forEach((_, i) => seen[i] || dfs(i));
  // A second edge between the same two states would share the first one's curve, so it is drawn as an arc instead
  const pairSeen = new Set();
  links.forEach(e => { const k = e.from + "\u0000" + e.to; if (back.has(e)) return; if (pairSeen.has(k)) back.add(e); pairSeen.add(k); });
  const rank = new Array(N).fill(0);
  for (const u of post.reverse()) for (const e of out[u]) if (!back.has(e)) rank[at.get(e.to)] = Math.max(rank[at.get(e.to)], rank[u] + 1);
  const R = Math.max(...rank) + 1;

  // Items per rank: real nodes, plus one small dummy per rank a long edge passes through, so it bends around boxes
  const looped = new Set(loops.map(e => e.from));
  const items = nodes.map((n, i) => ({ node: n, r: rank[i], w: nodeW(n), h: NODE_H, up: looped.has(n.id) ? 40 : 0 }));
  const cols = [...Array(R)].map(() => []);
  items.forEach(it => cols[it.r].push(it));
  const fwd = links.filter(e => !back.has(e)).map(e => {
    const a = items[at.get(e.from)], b = items[at.get(e.to)], route = [a];
    for (let r = a.r + 1; r < b.r; r++) { const d = { dummy: true, r, w: 0, h: 18, up: 0 }; cols[r].push(d); route.push(d); }
    route.push(b); return { e, route };
  });
  const segs = fwd.flatMap(f => f.route.slice(1).map((b, k) => [f.route[k], b]));
  // Order inside each rank by the average position of neighbours, sweeping right then left
  const idx = () => cols.forEach(c => c.forEach((it, k) => it.k = k));
  idx();
  for (let pass = 0; pass < 6; pass++) {
    const rightward = pass % 2 === 0;
    for (let s = 1; s < R; s++) {
      const r = rightward ? s : R - 1 - s;
      cols[r].forEach(it => {
        const nb = segs.filter(([a, b]) => rightward ? b === it : a === it).map(([a, b]) => (rightward ? a : b).k);
        it.bary = nb.length ? nb.reduce((x, y) => x + y, 0) / nb.length : it.k;
      });
      cols[r].sort((a, b) => a.bary - b.bary || a.k - b.k);
      idx();
    }
  }
  // Vertical positions: each item pulled toward its neighbours, kept apart and in order
  const place = (col, want) => {
    let prev = null;
    col.forEach(it => { it.y = prev ? Math.max(want(it), prev.y + prev.h / 2 + 34 + it.h / 2 + it.up) : want(it); prev = it; });
    const shift = col.reduce((a, it) => a + (it.y - want(it)), 0) / col.length;
    col.forEach(it => it.y -= shift);
  };
  cols.forEach(col => { let y = 0; col.forEach(it => { it.y = y + it.up + it.h / 2; y += it.up + it.h + 34; }); });
  for (let pass = 0; pass < 4; pass++) {
    const rightward = pass % 2 === 0;
    for (let s = 1; s < R; s++) {
      const r = rightward ? s : R - 1 - s;
      place(cols[r], it => {
        const nb = segs.filter(([a, b]) => rightward ? b === it : a === it).map(([a, b]) => (rightward ? a : b).y);
        return nb.length ? nb.reduce((x, y) => x + y, 0) / nb.length : it.y;
      });
    }
  }
  // Columns: as wide as their widest box; each gap as wide as the widest label crossing it
  const colW = cols.map(c => Math.max(16, ...c.map(it => it.w)));
  const gapW = [...Array(R - 1)].map(() => 60);
  fwd.forEach(({ e, route }) => { gapW[route[0].r] = Math.max(gapW[route[0].r], labelW(e.label) + 28); });
  const left = [0]; for (let r = 1; r < R; r++) left.push(left[r - 1] + colW[r - 1] + gapW[r - 1]);
  items.forEach(it => { it.x = left[it.r] + (colW[it.r] - it.w) / 2; });
  cols.forEach((c, r) => c.filter(it => it.dummy).forEach(it => it.x = left[r] + colW[r] / 2));

  // Ports: edges leaving (or entering) one side of a box fan out along it in the order of their other end
  const outs = new Map(), ins = new Map();
  fwd.forEach(f => {
    const a = f.route[0], b = f.route[f.route.length - 1];
    (outs.get(a) || outs.set(a, []).get(a)).push(f); (ins.get(b) || ins.set(b, []).get(b)).push(f);
  });
  const portY = (it, map, f, nextOf) => {
    const list = map.get(it).slice().sort((p, q) => nextOf(p).y - nextOf(q).y);
    return list.length > 1 ? it.y + Math.max(-14, Math.min(14, (list.indexOf(f) - (list.length - 1) / 2) * 10)) : it.y;
  };
  const parts = [];
  fwd.forEach(f => {
    const { e, route } = f, a = route[0], b = route[route.length - 1];
    let y = portY(a, outs, f, g => g.route[1]);
    const p = new Path(a.x + a.w, y);
    let label;
    route.slice(1).forEach((it, k) => {
      const prev = route[k], x0 = left[prev.r] + colW[prev.r], x1 = left[it.r];
      if (p.x < x0) p.H(x0);
      const y1 = it === b ? portY(b, ins, f, g => g.route[g.route.length - 2]) : it.y;
      if (k === 0) label = [(x0 + x1) / 2, (y + y1) / 2];
      const m = (x1 - x0) / 2;
      p.C(x0 + m, y, x1 - m, y1, x1, y1);
      if (it === b) p.H(b.x - 2); else p.H(left[it.r] + colW[it.r]);
      y = y1;
    });
    parts.push([e, p, label]);
  });
  // Back edges and repeated edges: an arc under (or over) the graph, whichever side has fewer boxes in the way; nested by span
  const yTop = Math.min(...items.map(it => it.y - it.h / 2 - it.up)), yBot = Math.max(...items.map(it => it.y + it.h / 2));
  const placed = { above: [], below: [] };
  [...back].map(e => ({ e, a: items[at.get(e.from)], b: items[at.get(e.to)] }))
    .sort((p, q) => Math.abs(p.a.x - p.b.x) - Math.abs(q.a.x - q.b.x))
    .forEach(({ e, a, b }) => {
      const ahead = it => cols[it.r].filter(o => o.y < it.y).length, behind = it => cols[it.r].filter(o => o.y > it.y).length;
      const side = ahead(a) + ahead(b) < behind(a) + behind(b) ? "above" : "below";
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x + a.w, b.x + b.w);
      const level = 1 + Math.max(0, ...placed[side].filter(o => o.lo <= hi && lo <= o.hi).map(o => o.level));
      placed[side].push({ lo, hi, level });
      const sx = a.x + a.w / 2 + (b.x < a.x ? -10 : 10), tx = b.x + b.w / 2 + (b.x < a.x ? 10 : -10);
      const dir = side === "below" ? 1 : -1, sy = a.y + dir * a.h / 2, ty = b.y + dir * (b.h / 2 + 2);
      const apex = side === "below" ? yBot + 28 * level : yTop - 28 * level, ctrl = (8 * apex - sy - ty) / 6;
      parts.push([e, new Path(sx, sy).C(sx, ctrl, tx, ctrl, tx, ty), [(sx + tx) / 2, apex], [labelW(e.label) / 2 + 12, 0]]);
    });
  loops.forEach(e => {
    const it = items[at.get(e.from)], cx = it.x + it.w / 2, top = it.y - it.h / 2;
    parts.push([e, new Path(cx - 12, top).C(cx - 30, top - 36, cx + 30, top - 36, cx + 12, top - 2), [cx, top - 34], [0, -(LABEL_H + 2)]]);
  });
  const order = new Map(edges.map((e, i) => [e, i]));
  items.forEach(it => sc.node(it.node, it.x, it.y - it.h / 2, it.w, it.h));
  parts.sort((p, q) => order.get(p[0]) - order.get(q[0])).forEach(([e, p, [lx, ly], step]) => sc.edge(e, p, lx, ly, step));
}

// ---------- Overlap check ----------
const hit = (a, b, pad = 1) => a.x < b.x + b.w - pad && b.x < a.x + a.w - pad && a.y < b.y + b.h - pad && b.y < a.y + a.h - pad;
// Does segment p→q pass through rectangle r (shrunk by pad)? Liang–Barsky clipping.
function crosses([x1, y1], [x2, y2], r, pad = 2) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, x1 - (r.x + pad)], [dx, r.x + r.w - pad - x1], [-dy, y1 - (r.y + pad)], [dy, r.y + r.h - pad - y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
}
const pathCrosses = (pts, r, pad) => pts.slice(1).some((q, k) => crosses(pts[k], q, r, pad));

// A line passing under another edge's label is not reported: the label's background hides it there.
export function overlaps(sc) {
  const found = [];
  const pairs = (list, f) => list.forEach((a, i) => list.slice(i + 1).forEach(b => f(a, b)));
  pairs(sc.boxes, (a, b) => hit(a, b) && found.push(`node "${a.id}" overlaps node "${b.id}"`));
  pairs(sc.labels, (a, b) => hit(a, b) && found.push(`the label of "${a.id}" overlaps the label of "${b.id}"`));
  for (const l of sc.labels) for (const b of sc.boxes) if (hit(l, b)) found.push(`the label of "${l.id}" overlaps node "${b.id}"`);
  for (const p of sc.paths) {
    for (const b of sc.boxes) if (b.id !== p.from && b.id !== p.to && pathCrosses(p.pts, b, 2)) found.push(`edge "${p.id}" runs through node "${b.id}"`);
  }
  return found;
}

// ---------- Entry point ----------
// Returns { svg, errors, warnings, scene }. svg is null when the spec has errors.
export function render(spec) {
  const { errors, warnings } = checkSpec(spec);
  if (errors.length) return { svg: null, errors, warnings };
  const norm = { ...spec, edges: (spec.edges || []).map(e => ({ ...e, id: e.id ?? `${e.from}-${e.to}` })) };
  const sc = new Scene();
  ({ sequence, chain, layers, states })[spec.layout](norm, sc);
  overlaps(sc).forEach(o => warnings.push(`DIAGRAM: ${o}; shorten labels, drop an edge, or try another layout`));

  const xs = [], ys = [];
  for (const r of [...sc.boxes, ...sc.labels]) { xs.push(r.x, r.x + r.w); ys.push(r.y, r.y + r.h); }
  for (const [x, y] of [...sc.paths.flatMap(p => p.pts), ...sc.extra]) { xs.push(x); ys.push(y); }
  const minX = Math.min(...xs) - MARGIN, minY = Math.min(...ys) - MARGIN;
  let W = Math.max(...xs) + MARGIN - minX, dx = -minX;
  const H = Math.max(...ys) + MARGIN - minY;
  if (W < MIN_WIDTH) { dx += (MIN_WIDTH - W) / 2; W = MIN_WIDTH; }   // a narrow viewBox would blow the text up
  if (W > MAX_WIDTH) warnings.push(`DIAGRAM is ${Math.ceil(W)} units wide; above ~${MAX_WIDTH} its text shrinks below 12px (fewer nodes, shorter labels, or another layout)`);
  if (H > W * .85) warnings.push(`DIAGRAM is taller (${Math.ceil(H)}) than ~85% of its width (${Math.ceil(W)}); the page caps its height, so its text shrinks (fewer edges, or another layout)`);
  const svg = `<svg viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" role="img" aria-label="${esc(spec.label)}">\n` +
    `<g transform="translate(${r1(dx)},${r1(-minY)})">\n${sc.parts.filter(Boolean).join("\n")}\n</g>\n</svg>`;
  return { svg, errors, warnings, scene: sc };
}
