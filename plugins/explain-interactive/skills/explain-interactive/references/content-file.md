# The content file

Read this before writing `~/explanations/<kebab-topic>.content.js` (workflow step 3), and when a
`--check` message needs explaining.

A plain script (not a module) with top-level `const` declarations; the build runs it, checks it,
and inlines it into the page before the engine:

```js
const META = { title: "Why an expired token gets a 401",
  bigPicture: "One sentence: what this is and why it matters." };
const CAST = { "orders-svc": "The service that returns a customer's orders." };          // optional
const GLOSSARY = { "token": "A signed string the client sends to prove who it is." };    // optional
const DIAGRAM = { layout: "sequence", label: "…",                                        // optional
  nodes: [{ id: "gw", label: "Gateway" }, …],
  edges: [{ id: "req", from: "client", to: "gw", label: "GET /orders" }, …] };
const STEPS = [ { title, summary, context, body, diagram, … }, …, { title: "Recap", body, diagram: {} } ];
```

- `META` and `STEPS` are required; `CAST`, `GLOSSARY` and `DIAGRAM` may be left out. `META.type`
  picks the page type, and `decision`, `debugging` and `concept` pages also declare `DECISION`,
  `HYPOTHESES` or `LAYERS` (see that type's file in `references/`).
- `DIAGRAM` is a spec the build lays out (`diagram-recipes.md`), with no coordinates. Its `label`
  (one sentence, read out by screen readers) is required: a spec without one is an error. Only when
  no layout fits, `DIAGRAM` is an `<svg>…</svg>` string written by hand.
- Strings hold HTML (`<dfn>`, `<mark>`, `<code>`, `<strong>`), step titles included (e.g.
  `` `Why <code>401</code>, not 403` ``; word counts ignore the tags). Use template literals for
  multi-line `body` and `deeper`.
- Plain data only: the content runs before the engine, so no DOM code, no `<script>` or `<link>`,
  no external URLs (the build rejects them).

## Fields of a step

| Field | Rule |
|---|---|
| `context` | **Step 1 only.** `{ question, setting, why, prereqs: [], example }`, rendered as a card above `body`. `question`: what we're explaining and what prompted it. `setting`: which system/repo and the main parts involved. `why`: what goes wrong or stays confusing without this. `prereqs`: 0–3 things to know first, each with a one-line refresher. `example`: the running example's inputs and starting state. One or two sentences each; HTML allowed (`<dfn>`, `<code>`). |
| `title` | ≤ 6 words, names the idea ("Requests hit the gateway first"). HTML allowed. |
| `summary` | ≤ 8 words, one-line takeaway shown next to the title in the Recap's step list ("bad tokens stop at a 401"). |
| `body` | 2–5 short sentences of plain language, ≤ ~120 words. **Open with a transition** that ties it to the previous step ("Once the token is decoded…") and **say why this step happens**, not only what happens. Bold the one key idea. **Name the highlighted part of the diagram** and wrap that name in `<mark>…</mark>`; it gets the same colour as the diagram's `hl` highlight, so the reader can match text to picture. Wrap glossary terms in `<dfn>term</dfn>` for hover tooltips (`<dfn data-term="token">tokens</dfn>` maps an inflected word to an entry). |
| `diagram` | **Preferred visual.** `{ hl: [ids new in this step], hide?: [...], dim?: [...], build?: [...] }` over the page's shared `DIAGRAM`, naming its node and edge ids. Earlier steps' parts look normal, parts not introduced yet are ghosted, the Recap shows everything, and a legend is added. `build` lists parts (or arrays of parts) revealed one per Next/→ click before the step advances; use it only where message order is the point, max 4 stages. |
| `visual` | Escape hatch when one step needs its own picture (replaces `diagram`). Inline SVG or small HTML. Give the `<svg>` a `viewBox` of width 560–720 (≤ 900 for `wide`) so the 16px text renders near its real size, and **no `width`**. Use CSS vars so it works in dark mode and the diagram kit classes (`.box .arrow .label .zone .hl .bad .ok`); mark staged parts with `data-b="1"`, `data-b="2"`… and set `build: n` on the step. |
| `analogy` | Optional one-liner real-world analogy. Say which part maps to which; put "where the analogy breaks down" in `deeper`. |
| `code` | Optional minimal snippet (≤ 15 lines of ≤ 60 characters): only the lines that matter. Lines containing `←` (e.g. `// ← this`) are highlighted in the diagram's colour. |
| `deeper` | Optional "go deeper" detail, hidden behind a toggle. Edge cases and nuance go here, NOT in `body`. |
| `quiz` | `{q, options[], answer, why}`, on 2–3 steps per page: the ones a reader most likely gets wrong. Use 3–4 options: the reader gets one retry before the answer is revealed, and with only 2 options the retry would give it away. Ask a **prediction** ("what happens if…", "which component…"), not recall of the text. An option may be `{t, why}`: `why` is shown on the retry and explains why *that* answer is wrong (name the misconception). `why` on the quiz explains the right answer and names the trap. A quiz may sit on the step *after* a concept is introduced, to apply it. The page shuffles the options on display, so write them in any order. |
| `whatif` | Optional `{ label, control?, options: [{ id, label, outcome, diagram? }] }`: a toggle or slider that switches the step's outcome text and lit diagram parts. See `references/whatif.md`. |
| `matrix`, `diff`, `phase`, `verdicts`, `evidence`, `layer` | Page-type fields; see that type's file in `references/`. `panel: false` hides the type's panel on one step. |
| `depth` | Optional `"full"`: a **background step** (a refresher on a prerequisite, how the system is laid out) that a reader who already knows it can skip. The page's **Short** switch hides these steps, and the Context card's `setting`, `why` and `prereqs`; the steps are renumbered and Next skips over them. Leave it off the steps the mechanism needs, and don't light diagram parts on a background step (later steps would show them as already introduced). Ignored on step 1 and the Recap. |
| `wide` | Optional `true`: puts `visual`/`code` under the text at full width instead of beside it. Steps whose `DIAGRAM` is wider than 680 units, steps with a `diff`, and decision steps without a quiz get this on their own, and the Recap is always wide; set it for a wide `visual`. On a step with a wide `DIAGRAM` and a quiz, the quiz sits beside the diagram, so the step still fits one screen. |

## What `--check` reports

Each line is `error:` or `warning:` with the step it is on. Errors stop the build; warnings don't.

Errors (shared by every type; each type's file lists its own):

- `META` or `META.title` missing; `STEPS` missing or empty; a step without a `title`.
- A text field that isn't a string (`META.bigPicture: 42`, a number as a step's `body`, a `context`
  field, a quiz's `q`/`why`, `CAST`/`GLOSSARY` values). `null` means "none", like leaving it out.
- `DIAGRAM` that is neither a spec nor an `<svg>` string; a spec without `label`, `nodes`, or a
  node/edge `label`; a `diagram` id that is not a part of `DIAGRAM`; a step naming parts when there
  is no `DIAGRAM`; a nested list in `hl`, `hide` or `dim` (only `build` stages can be lists).
- A quiz without `q` and `options[]`, or with an `answer` out of range.
- A `depth` other than `"full"`; an unknown `META.type`; an external resource.

Warnings:

- Structure: a page outside 5–10 steps (Context and Recap included); a step 1 without a `context`
  card; `context` on a later step; a last step not titled Recap or, when there is a `DIAGRAM`,
  without `diagram: {}`; fewer than 2 or more than 3 quizzes; an empty `bigPicture`, `body` or
  `summary` (the Recap needs no summary).
- Size: a title over 6 words or a summary over 8; a body over 5 sentences or over ~120 words;
  `context.prereqs` over 3 items, or a `context` field over 2 sentences; `code` over 15 lines or 60
  characters wide; a quiz with other than 3–4 options or no `why`.
- Diagram: a step lighting more than 3 parts, or lighting parts with no `<mark>` in the body;
  `diagram.build` over 4 stages; a `visual` with more `data-b` stages than its `build`; a long node
  label; `id=` or `<animate>` in a hand-written SVG.
- Terms: a `<dfn>` or a diagram part's `term` with no `CAST`/`GLOSSARY` entry. Every field shown as
  HTML is checked (steps, what-if options, `META.before`/`after`, `CAST`/`GLOSSARY` text,
  `DECISION`, `HYPOTHESES` and `LAYERS`); entities such as `&amp;` are decoded first.
- Depth: a `depth: "full"` step that lights diagram parts, itself or through its what-if options;
  `depth` on step 1 or the Recap.
- Type: a type's structure (`DECISION`, `HYPOTHESES`, `LAYERS`) or step field on a page of another
  type.
- A step field the engine doesn't know (usually a typo).

A run with no errors prints `ok`, or `N warnings` when some remain (exit 0 either way).

## Commands

All scripts are in this skill's directory and need Node 22+.

- Check without building: `node build.mjs --check <topic>.content.js`.
- Build: `node build.mjs <topic>.content.js [-o <file>.html]`. Default output: `<topic>.html` next
  to the content file. `--no-index` leaves `index.html` alone; `node build.mjs --index [<dir>]`
  only rewrites the index (default `~/explanations`). An `index.html` the build didn't write is
  never replaced.
- Recover a page whose content file is lost (or one made with the old `template.html`):
  `node build.mjs --extract <page>.html [-o <file>]` writes `<page>.content.js` next to it (or to
  `<file>`); then build that.
- Screenshots: `node shots.mjs <page>.html | <topic>.content.js [-o <dir>] [--phone] [--dark]`.
  Default output: a temp `explain-shots/<topic>/` folder. With `-o`, use a new or empty folder: it
  refuses one that already holds `step-*.png` files it didn't write. A browser is looked for in the
  usual install places and on `PATH`; `CHROME=/path/to/chrome` picks one.
