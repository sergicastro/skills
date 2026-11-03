# Diagram recipes

Read this when planning the page's diagram (workflow step 2). One diagram serves the whole page. You declare it once as `DIAGRAM` in the content file: which parts there are and how they connect. The build lays it out, so there are no coordinates to write. Each step then lists which parts to light up.

## Pick the layout from the mechanism

| Mechanism in the source explanation | `layout` | How it is drawn |
|---|---|---|
| Request/response, protocol, handshake, who calls whom and in what order | `sequence` | Nodes are columns with a lifeline; edges are messages, one row each, top to bottom in the order you list them. A message from a node to itself is a small loop. |
| Pipeline, middleware, filters, build stages | `chain` | Nodes left to right in the order you list them. A node with `branch: true` (the rejected path) sits below the node that leads to it. An edge that skips a node or goes back is drawn as an arc above the row. |
| Layers, abstraction levels, a stack | `layers` | Bands stacked top to bottom, the first node on top. Edges between neighbouring bands run straight down or up; longer ones go round on the right. |
| Lifecycle, status changes, a small graph | `states` | Left to right: each state sits one column after the furthest state that leads to it. Edges back to an earlier state, and repeated edges, are arcs above or below; an edge from a state to itself is a loop on top. |

None of these fit "before vs after", nested boundaries (trust boundary, cluster, namespace) or a timeline. Draw those as raw SVG (see the end of this file).

## The spec

```js
const DIAGRAM = {
  layout: "sequence",                       // sequence | chain | layers | states
  label: "Client calls orders-svc through the gateway",   // one sentence; screen readers read it
  nodes: [
    { id: "client", label: "Client" },
    { id: "gw", label: "Gateway" },
    { id: "svc", label: "orders-svc" },
  ],
  edges: [
    { id: "req", from: "client", to: "gw", label: "GET /orders  Bearer eyJ…" },
    { id: "deny", from: "gw", to: "client", label: "401 expired token", kind: "bad" },
    { id: "fwd", from: "gw", to: "svc", label: "GET /orders", kind: "ok" },
  ],
};
```

| Field | Meaning |
|---|---|
| `nodes[].id`, `edges[].id` | The names steps use in `diagram.hl` / `dim` / `hide` / `build`. Nodes and edges share one set of ids. Letters, digits, `_`, `-`, `.`. An edge without an `id` is called `<from>-<to>`; give every edge an id if a step names it. |
| `nodes[].label` | The box text: a name of ≤ 3 words. |
| `nodes[].kind` | `"bad"` (failed/rejected component, red) or `"ok"` (successful, green). |
| `nodes[].branch` | `chain` only: puts the node below the main row. It is the end of the line (a rejection), so edges may lead to it but not leave it. |
| `edges[].label` | What travels on the edge, with the real value from the conversation. |
| `edges[].kind` | `"bad"`, `"ok"`, `"flow"` (animated dashes in the direction of travel), or a mix such as `"bad flow"`. |

The build checks the spec. Unknown layouts, unknown or repeated ids, edges naming a missing node, and steps naming a missing part are errors. Missing edge labels, unknown fields, more than ~7 nodes and any overlap it finds after laying out are warnings. Fix the warnings too: each one means the picture is harder to read.

## Rules

- **Same positions in every step.** Steps never move or redraw parts; they only change their state (`hl`, `dim`, `hide`, `build`). The spec gives you this for free.
- **Every edge carries a `label`** saying what travels on it, with the real value (`Authorization: Bearer eyJ…`, `401`, `POST /orders`), not "data" or "request".
- **Each step lights up 1–3 parts.** If a step needs more, split the step.
- **At most ~7 nodes.** Merge or drop details this explanation doesn't need. Keep a `layers` stack to 5 bands and a `sequence` to about 8 messages, or the picture gets too tall to read.
- **No sentences inside boxes**: a name (≤ 3 words) per node. Prose belongs in `body`.
- **Short edge labels** (≤ ~25 characters). The layout makes room for each label, so a long one stretches the whole diagram and shrinks its text.
- **Colour means one thing:** orange `hl` = new in this step (and the `<mark>` in the text), red `bad` = rejected/failure, green `ok` = accepted/success, ghosted = not introduced yet.
- `build` (staged reveal, ≤ 4 stages) is for sequences where the order of messages is the point.

A diagram wider than 680 units would be too small beside the text, so the page shows its steps full width, with the text above. A `sequence` grows wider with each column and a `chain` with each box. If the build says the diagram is wider than ~900 units, drop a node or shorten labels.

## Raw SVG (escape hatch)

When no layout fits, `DIAGRAM` can be an `<svg>` string written by hand, and the same `diagram: { hl, … }` mechanism works on it. A single step can also bring its own picture with `visual`.

- Every part a step can light up is a `<g data-id="…">`. Use `data-id`, not `id`: the SVG is cloned for every step, so ids would repeat.
- Size the viewBox for real text: width 560–720 (up to 900 for `wide` steps), height ≤ ~60% of the width, and no `width` attribute. SVG text scales with the viewBox: a 1200-wide viewBox shrinks 16px text to ~9px. Base text 16px, `.label` 14px, never below 12px.
- Use CSS (`.flow`) for motion, never SMIL `<animate>` (reduced-motion settings don't stop it).

Classes the engine already styles:

| Class | Use |
|---|---|
| `.box` | node/actor/component |
| `.arrow` (+ `.bad` / `.ok` / `.flow`) | edge (`<line>` or `<path>`); `.flow` animates direction of travel |
| `.label` | 14px muted text for edges and captions; put a `.label-bg` rect behind it when a line passes under it |
| `.zone` | dashed boundary (trust boundary, process, cluster) |
| `.lifeline` | dashed vertical line under a sequence actor |
| `.hl` / `.dim` / `.hidden` | set per step from `diagram.hl` / automatic ghosting / `diagram.hide` |
| `.box.bad` / `.box.ok` | a failed / successful component |

Example: a before/after pair, the same box twice with the changed part lit.

```html
<svg viewBox="0 0 640 110" role="img" aria-label="The rate limit before and after the change">
  <text class="label" x="150" y="20" text-anchor="middle">Before</text>
  <text class="label" x="490" y="20" text-anchor="middle">After</text>
  <g data-id="old"><rect class="box" x="60" y="40" width="180" height="44" rx="8"/><text x="150" y="67" text-anchor="middle">10 calls / min</text></g>
  <g data-id="new"><rect class="box" x="400" y="40" width="180" height="44" rx="8"/><text x="490" y="67" text-anchor="middle">50 calls / min</text></g>
  <g data-id="change"><line class="arrow" x1="244" y1="62" x2="396" y2="62"/><text class="label" x="320" y="54" text-anchor="middle">PUT /policies</text></g>
</svg>
```

Steps then read `diagram: { hl: ["old"] }`, `{ hl: ["change", "new"] }`.
