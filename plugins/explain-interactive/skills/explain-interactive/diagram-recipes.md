# Diagram recipes

Read this when planning the page's diagram (workflow step 1). One diagram serves the whole page: define it once as `DIAGRAM` in `template.html`, then each step lists which parts to light up.

## Pick the pattern from the mechanism

| Mechanism in the source explanation | Pattern |
|---|---|
| Request/response, protocol, handshake, who-calls-whom | **Sequence**: actors as columns with a `.lifeline`, time flowing down, one labelled arrow per message |
| Pipeline, middleware, filters, build stages | **Chain**: boxes left → right; the rejected path branches down in `.bad` |
| Layers, abstraction levels, stack | **Stacked bands**: full-width boxes, top = what the user sees |
| Lifecycle, status changes | **State machine**: one box per state, labelled transitions |
| "Before vs after" a config or code change | **Pair**: same layout twice side by side, changed parts `.hl` |
| Ownership, scope, trust boundary, cluster/namespace | **Nested `.zone` boxes** |
| Ordering, history, rollout | **Timeline**: a horizontal line with labelled ticks |

## Rules

- **Same positions in every step.** Steps never move or redraw parts; they only change state (`hl`, `dim`, `hide`, `build`).
- **Every arrow carries a `.label`** saying what travels on it, with the real value from the conversation (`Authorization: Bearer eyJ…`, `401`, `POST /orders`), not "data" or "request".
- **Each step lights up 1–3 parts.** If a step needs more, split the step.
- **At most ~7 boxes on screen.** Merge or drop details that this explanation doesn't need.
- **No sentences inside boxes**: a name (≤ 3 words) per box. Prose belongs in `body`.
- **Colour means one thing:** orange `.hl` = new in this step (and the `<mark>` in the text), red `.bad` = rejected/failure, green `.ok` = accepted/success, ghosted = not introduced yet.
- **Size the viewBox for real text.** Width 560–720 (up to 900 for `wide` steps), height ≤ ~60% of the width. SVG text scales with the viewBox: a 1200-wide viewBox shrinks 14px text to ~8px. Base text 14px, `.label` 12px, never below 11px.
- **Use `data-id`, not `id`**, on each part (`<g data-id="gw">…</g>`): the SVG is cloned for every step, so ids would repeat.
- Use CSS (`.flow`) for motion, never SMIL `<animate>` (reduced-motion settings don't stop it).
- `build` (staged reveal, ≤ 4 stages) is for sequences where the order of messages is the point.

## Kit (already styled in the template)

| Class | Use |
|---|---|
| `.box` | node/actor/component |
| `.arrow` (+ `.bad` / `.ok` / `.flow`) | edge; `.flow` animates direction of travel |
| `.label` | 12px muted text for edges and captions |
| `.zone` | dashed boundary (trust boundary, process, cluster) |
| `.lifeline` | dashed vertical line under a sequence actor |
| `.hl` / `.dim` / `.hidden` | set per step from `diagram.hl` / automatic ghosting / `diagram.hide` |
| `.box.bad` / `.box.ok` | a failed / successful component |

## Worked example: 3-lane sequence diagram

```html
<svg viewBox="0 0 640 260" role="img" aria-label="Client calls orders-svc through the gateway">
  <g data-id="client">
    <rect class="box" x="10" y="10" width="120" height="40" rx="8"/><text x="70" y="35" text-anchor="middle">Client</text>
    <line class="lifeline" x1="70" y1="50" x2="70" y2="250"/></g>
  <g data-id="gw">
    <rect class="box" x="260" y="10" width="120" height="40" rx="8"/><text x="320" y="35" text-anchor="middle">Gateway</text>
    <line class="lifeline" x1="320" y1="50" x2="320" y2="250"/></g>
  <g data-id="svc">
    <rect class="box" x="510" y="10" width="120" height="40" rx="8"/><text x="570" y="35" text-anchor="middle">orders-svc</text>
    <line class="lifeline" x1="570" y1="50" x2="570" y2="250"/></g>
  <g data-id="m1"><line class="arrow" x1="72" y1="90" x2="318" y2="90"/>
    <text class="label" x="195" y="82" text-anchor="middle">GET /orders  Bearer eyJ…</text></g>
  <g data-id="m2"><line class="arrow bad" x1="318" y1="140" x2="72" y2="140"/>
    <text class="label" x="195" y="132" text-anchor="middle">401 token expired</text></g>
  <g data-id="m3"><line class="arrow ok" x1="322" y1="190" x2="568" y2="190"/>
    <text class="label" x="445" y="182" text-anchor="middle">GET /orders (token valid)</text></g>
</svg>
```

Steps then read `diagram: { hl: ["client", "m1"] }`, `{ hl: ["gw"] }`, `{ hl: ["m2"], build: ["m2"] }`, and so on.
