---
name: explain-interactive
description: Use when the user finds an explanation hard to follow and asks to see it as an interactive / dynamic / visual HTML page, step-by-step walkthrough, or "explain it in HTML" — e.g. "present that as HTML", "make it visual", "walk me through it step by step", "I don't get it, show me", "/explain-interactive". Turns the previous explanation (or a named topic) into a self-contained, step-by-step interactive HTML explainer.
---

# Interactive Step-by-Step Explainer

Turn a complex explanation into a single self-contained HTML page that a human can walk through **one step at a time**, with visuals, analogies and self-checks.

## When to use

- The user says an explanation is complex/confusing and asks for an HTML / visual / interactive / step-by-step version.
- Default subject: **the last substantive explanation Claude gave in this conversation**. If the user names another topic, use that. If ambiguous, pick the most recent one and say so in one line — don't ask.

## Workflow

0. **Pick the page type** from "Page types" below: it decides what the page is built around (a mechanism, a choice, a change, an investigation, a concept). Say which one you picked in your final line.
1. **Find the reader's gap.** From the user's message, work out *what* they found hard to follow and what they likely already know (their role, what they've said, what they've done in the conversation). Pitch the page at that level and give the confusing point the most room. If the source explanation is a reply inside a conversation, assume it leans on context the reader never saw: files Claude read, earlier turns, how the system is laid out.
2. **List the assumptions, then decompose.** Before planning steps, write down (internally) everything the source explanation takes for granted: terms, project names, how the system is laid out, why the problem exists, what the starting state is. Each item must end up somewhere on the page — the Context step, a step of its own, `CAST`, or `GLOSSARY` — never left unstated. Then produce the learning path:
   - One-sentence **big picture** (what & why).
   - A **Context step** (always step 1, see below): the question, where it happens, why it matters, prerequisites, the running example set up in full.
   - One **running example**: a concrete case from the conversation (a specific request, file, value — e.g. "`GET /orders` with an expired token") that every step follows. It supplies the real values for diagram labels and code.
   - 4–10 **steps**, each introducing ONE new idea, ordered so each builds only on earlier ones.
   - A step that only refreshes background a knowledgeable reader already has → mark it `depth: "full"` so the Short switch can skip it.
   - **Prerequisite terms** → `GLOSSARY` entries; **every project-specific name** on the page (service, file, function, team, flag) → a `CAST` one-liner.
   - For a type other than walkthrough, plan its structure first (the options and criteria, the two versions, the hypotheses, the layers) and give each step one piece of it; see "Page types".
   - Where the real mechanism is spatial/temporal (flows, layers, sequences, state changes), plan **one diagram for the whole page**: read `diagram-recipes.md`, pick the layout (`sequence`, `chain`, `layers` or `states`) that matches the mechanism, list its nodes and edges, then decide which parts each step lights up.
   - Where the outcome depends on a condition the reader would want to flip (token expired or not, cache hit or miss, a value crossing a limit), plan a **what-if control** on that step instead of two near-identical steps; see "What-if controls".
   - The 2–3 points where a learner most likely gets confused → **check-your-understanding** questions. Each wrong option should be a real misconception from the source.
3. **Write only the content file.** The page's look and behaviour live in an engine you don't touch (`engine/engine.js`, `engine/engine.css`, `engine/page.html`, next to this file). You write one plain script, `~/explanations/<kebab-topic>.content.js`, that declares `META`, `CAST`, `GLOSSARY`, `DIAGRAM` and `STEPS`, plus `DECISION`, `HYPOTHESES` or `LAYERS` for those page types (see "The content file" below). Start from the example for your page type (table below): copy its shape, replace all of its content. No HTML shell, CSS, engine code or frameworks in it.
4. **Check the content (required).** Run `node <this skill's directory>/build.mjs --check ~/explanations/<kebab-topic>.content.js`. It writes nothing and lists every problem as `error:` or `warning:` with the step it is on. Errors: a `diagram` id that is not a `data-id` in `DIAGRAM`, a quiz `answer` out of range, a `depth` other than `"full"`, a nested list in `hl`, `hide` or `dim` (only `build` stages can be lists), an external resource, and other broken structure. Warnings: a `<dfn>` or a diagram part's `term` with no `CAST`/`GLOSSARY` entry (every field shown as HTML is checked: steps, what-if options, `META.before`/`after`, `CAST`/`GLOSSARY` text, `DECISION`, `HYPOTHESES` and `LAYERS`; entities such as `&amp;` are decoded first), a `depth: "full"` step that lights diagram parts, itself or through its what-if options, a step that lights more than 3 diagram parts, a lit part with no `<mark>` in the body, a body over 5 sentences, a title over 6 words or a summary over 8, `code` over 15 lines or 60 characters wide, a quiz with other than 3–4 options or no `why`, a `visual` with more `data-b` stages than its `build`, a step field the engine doesn't know (usually a typo). Fix all of them in the content file and run it again until it prints `ok`. A warning you keep on purpose (e.g. a long command that can't be wrapped) needs a reason you can state.
5. **Cold-reader check (required).** Claude can't see its own assumptions, so test the page on someone who has none of the conversation. Spawn a fresh subagent (`Agent` tool, `general-purpose`, never a fork — a fork inherits the context) and give it **only the page's text**: `META`, `CAST`, `GLOSSARY`, the type's own structure (`DECISION`, `HYPOTHESES` or `LAYERS`) and every step's fields, in order — not the conversation, not the source explanation. Ask it to read as a newcomer to this project and list, per step: every term or name it couldn't place, every jump where it didn't see how this follows from the previous step, every "why?" left unanswered, and anything it had to guess. For each item, fix the page: add a `CAST`/`GLOSSARY` entry, add a sentence or prerequisite to the Context step, add a transition, or split out a new step. Fix only with verified facts (see the accuracy rule). Re-run the check once if you added steps; then move on. If the `Agent` tool is unavailable, do the same pass yourself, reading strictly as someone who has only the page.
6. **Build and review the screenshots (required).** Run `node <this skill's directory>/build.mjs ~/explanations/<kebab-topic>.content.js`. It runs the same checks, inlines the content with the engine into `~/explanations/<kebab-topic>.html` (one self-contained file, works offline) and prints the path; on errors it writes nothing. It also rewrites `~/explanations/index.html`, a list of every page there (newest first, with type, step count and how far the reader got); an `index.html` it didn't write is left alone. Then run `node <this skill's directory>/shots.mjs ~/explanations/<kebab-topic>.html --phone`: it renders every step in headless Chrome, as the reader sees it on arrival with all build stages revealed, saves `step-NN.png` (desktop) and `step-NN-phone.png` and prints their paths. A step with a what-if control is also saved once per other option, as `step-NN-<option id>.png` (`-phone` added on phones). In the name, each run of characters other than letters, digits and `_` in the id becomes `_`; an id that is `phone`, or that comes out the same as an earlier option's, gets `_2`, `_3`, … so no two images share a name. **Look at every image** (`Read` each one) and fix the content for what you see: a label that overlaps or is cut off, the wrong part lit, text that doesn't match the picture, a step that needs scrolling, an empty or broken panel. Also fix every `finding:` it prints (a middle step much taller than the screen, a diagram that scrolls sideways, diagram text too small, console errors, external requests). Rebuild and re-shoot after changes. If no Chrome/Chromium is installed it says so; skip the images then and tell the user in your final line.
7. **Deliver locally.** Run `open <path>` (macOS) / `xdg-open` (Linux). Keep the `.content.js` next to the page: to change the page later, edit the content and rebuild — never edit the built HTML. Never publish to claude.ai or use the `Artifact` tool unless the user explicitly asks for it.
8. Reply in chat with **one line**: what the page covers, its type, and the file path. Don't repeat the explanation in chat.

**When the reader comes back stuck.** Each step has a "Still confused here" box that copies a prompt starting *I'm reading an explainer page, "<title>", and I'm stuck on step n of N*. It carries the step's text, the terms it uses, a missed check and what the reader typed. Answer it in chat, aimed at what they said is unclear. If the answer shows the page itself skips or gets something wrong, fix that step in the `.content.js` and rebuild, and say so in one line.

## Page types

Every type keeps the same page: sidebar, Next/Back, Context step, quizzes, glossary, Recap. The type adds one panel, drawn next to each step's text, that holds the thing the page is built around. Set it with `META.type`; leave it out for a walkthrough.

| If the explanation is about… | Type | The page is built around | Example |
|---|---|---|---|
| how something works: a request's path, a sequence, what calls what | `walkthrough` (default) | one shared `DIAGRAM`, lit part by part | `examples/token-401.content.js`; with what-if controls, `examples/cache-read.content.js` |
| which of several options to pick, and why | `decision` | an options × criteria table (`DECISION`), with cost and a recommendation | `examples/session-store.content.js` |
| what a change does: a refactor, a config change, a migration | `before-after` | a line diff of the two versions per step (`diff`), and the two states side by side on step 1 | `examples/multistage-build.content.js` |
| why something broke, and how that was found | `debugging` | phases (symptom → hypothesis → evidence → cause → fix), evidence blocks, and a board of hypotheses ruled out or confirmed | `examples/cron-twice.content.js` |
| an idea made of parts that build on each other: a protocol stack, a mental model, layers of an abstraction | `concept` | a stack of layers (`LAYERS`), one added per step, foundation at the bottom | `examples/https-layers.content.js` |

How to choose:
- Ask what the reader has to come away with. A path through a system → walkthrough. A choice → decision. A difference between two versions → before-after. A cause → debugging. A model they can reuse → concept.
- If the user's question starts with "which", "should we" or "X or Y", it is a decision. "What changed" or "what does this PR do" is before-after. "Why did X happen" about a past failure is debugging. "How does X work" is a walkthrough when X has moving parts, and a concept when X is an idea with levels.
- When two fit, pick the one whose panel the reader would look at most. A debugging story can still carry a `DIAGRAM` or a `code` snippet on a step; a decision step can still show a `visual`.
- Don't force it: if none fits clearly, use walkthrough.

### `decision`

```js
const META = { type: "decision", title, bigPicture };
const DECISION = {
  options:  [{ id: "redis", name: "Redis", summary: "one shared store" }, …],   // the columns, 2–4
  criteria: [{ id: "speed", name: "Read speed" }, …],                          // the rows, 2–6
  ratings:  { redis: { speed: { level: "good", note: "under a millisecond" } }, … },   // level: good | fair | poor; or just "good"
  cost:     { redis: "One more service to run", … },   // optional: adds a last "Cost" row (its id is "cost")
  recommend: "redis",
  why: "the one sentence that decides it",
};
```

- Each step names what it discusses with `matrix: { criteria: [ids], options: [ids] }`: those rows and columns are lit, rows not discussed yet are ghosted, the Recap shows all. Discuss **one criterion per step**, in the order that eliminates options fastest, and use the running example ("Ana's second request lands on another server") to show why the criterion matters.
- The step that concludes sets `matrix: { …, recommend: true }`; from there on the recommended column is marked and `why` shown under the table. Without it the recommendation appears only on the Recap.
- Fill every cell: a missing rating is a warning. A `note` says why, in a few words; the level alone does not.
- The step 1 `context.question` names the choice; `why` says what goes wrong with the wrong pick.

### `before-after`

```js
const META = { type: "before-after", title, bigPicture, before: "One stage: the image also holds the compiler.", after: "Two stages: …" };
// on a step:
diff: { label: "Dockerfile", before: `…`, after: `…` },
```

- `META.before` / `META.after` (one sentence each, HTML allowed) are shown side by side on step 1.
- Each step's `diff` shows **only the part that step changes**, with a line or two around it for orientation. The engine works out the changed lines and aligns them; a step with a `diff` is always wide. Put the starting version in step 1's `code`, and the whole diff on the Recap.
- One change per step, in the order that makes each one make sense ("name the stage" before "copy from it"). The `body` says why the change is needed, not only what it is: the diff already shows what.

### `debugging`

```js
const META = { type: "debugging", title, bigPicture };
const HYPOTHESES = [{ id: "retry", text: "The mail server retried a send" }, …];
// on a step:
phase: "evidence",                                      // symptom | hypothesis | evidence | cause | fix
verdicts: { retry: "ruled-out" },                       // open | ruled-out | confirmed
evidence: { label: "grep 'Nightly report' mail.log", text: `…` },
```

- Step 1 is the symptom (`phase: "symptom"`, with its `evidence`). Then the story runs in the order it was found: raise a hypothesis (`verdicts: { id: "open" }`), show evidence, rule it out or keep it, until one is `confirmed` at the `cause` step; then the `fix`.
- The board on each step lists the hypotheses raised so far with their current state; the ones this step changes are lit. A hypothesis not raised yet is not shown, so the page does not give the answer away. Raise every hypothesis in `HYPOTHESES` at some step.
- `evidence.text` is a log line, command output or code, ≤ 15 lines; `label` is the command or file it came from. Lines with `←` are highlighted. Use the real output from the conversation; never make it up.
- Include the wrong turns that were actually taken: they are where the reader learns how to rule things out.

### `concept`

```js
const META = { type: "concept", title, bigPicture };
const LAYERS = [{ id: "ip", name: "IP", text: "Moves packets, with no promise they arrive." }, …];   // foundation first
// on a step:
layer: "ip",
```

- `LAYERS[0]` is the foundation and is drawn at the bottom; each later layer sits on the one before. Each step from step 2 on adds **exactly one** layer, bottom-up; the layer's `text` is the one-line summary that stays on the stack.
- Layers not reached yet show their name only, ghosted, so the reader sees where the explanation is going without its answers.
- Each `body` says what the new layer adds that the ones below could not do; that gap is why the layer exists.
- The Context step and the Recap have no `layer`: they show the stack ghosted and complete.

## What-if controls

A step whose outcome depends on a condition can let the reader flip it: a toggle or a slider above the step's visual switches which diagram parts are lit and which outcome text is shown. Use it where the reader's natural question is "and what if it weren't?": an expired or a valid token, a cache hit or a miss, a value under or over a limit.

```js
// on a step:
whatif: {
  label: "the key is…",                       // read as "What if the key is…"
  control: "choice",                           // choice (default): a row of buttons; slider: ordered values on a track
  options: [                                   // 2–4; the first is shown on arrival
    { id: "hit",  label: "in Redis",     outcome: `A <dfn>cache hit</dfn>: Redis returns <mark>the cached product</mark>.`,
      diagram: { hl: ["hit"] } },
    { id: "miss", label: "not in Redis", outcome: `A <dfn>cache miss</dfn>, so the <mark>SELECT</mark> runs.`,
      diagram: { hl: ["miss", "query"] } },
  ],
},
```

- `label` finishes the sentence "What if …". Each option's `label` is the value the reader picks (a few words), and its `outcome` (1–2 sentences, HTML allowed) says what happens in that case. Wrap the part it lights in `<mark>`.
- An option's `diagram` takes `hl`, `hide` and `dim` and replaces the step's own `diagram` fields while that option is picked. Leave it out and the option keeps the step's diagram, changing the outcome text only. Every part any option lights counts as introduced on later steps, so they aren't ghosted there.
- Use `slider` when the options are points on one scale in order (an entry 10 s, 59 s and 61 s old; 1, 10 and 100 requests a second); `choice` for cases with no order. Put the case that makes the step's point first.
- The `body` sets up the condition and says what to try ("Switch between the two cases"); the outcomes carry the difference. A `quiz` on the same step or the next one can ask the reader to predict a case.
- A step can't have both a what-if and `build` stages, and the Recap takes none. On a step with its own `visual`, options change only the outcome text.
- The reader's pick is remembered with the rest of the progress, "Start over" resets it, and the "Still confused here" prompt says which case they were looking at.

## The content file

A plain script (not a module) with top-level `const` declarations; the build runs it, checks it, and inlines it into the page before the engine:

```js
const META = { title: "Why an expired token gets a 401", bigPicture: "One sentence: what this is and why it matters." };
const CAST = { "orders-svc": "The service that returns a customer's orders." };   // optional
const GLOSSARY = { "token": "A signed string the client sends to prove who it is." };   // optional
const DIAGRAM = { layout: "sequence", label: "…", nodes: [{ id: "gw", label: "Gateway" }, …], edges: [{ id: "req", from: "client", to: "gw", label: "GET /orders" }, …] };   // optional
const STEPS = [ { title, summary, context, body, diagram, … }, …, { title: "Recap", body, diagram: {} } ];
```

- `META` and `STEPS` are required; `CAST`, `GLOSSARY` and `DIAGRAM` may be left out. `META.type` picks the page type, and `decision`, `debugging` and `concept` pages also declare `DECISION`, `HYPOTHESES` or `LAYERS` (see "Page types").
- `DIAGRAM` is a spec the build lays out (`diagram-recipes.md`), with no coordinates. Only when no layout fits, it is an `<svg>…</svg>` string written by hand.
- Strings hold HTML (`<dfn>`, `<mark>`, `<code>`, `<strong>`); use template literals for multi-line `body` and `deeper`.
- Plain data only: the content runs before the engine, so no DOM code, no `<script>` or `<link>`, no external URLs (the build rejects them).
- Check without building: `node build.mjs --check <topic>.content.js`. Screenshots of a page or content file: `node shots.mjs <file> [-o <dir>] [--phone] [--dark]` (default output: a temp `explain-shots/<topic>/` folder; Node 22+, Chrome/Chromium, `CHROME=` to pick one).
- Rebuild an existing page: `node build.mjs <topic>.content.js` (`--no-index` leaves `index.html` alone; `node build.mjs --index [<dir>]` only rewrites the index, default `~/explanations`). A page whose content file is lost (or one made with the old `template.html`): `node build.mjs --extract <page>.html [-o <file>]` writes `<page>.content.js` next to it, then build that.

## Content rules per step

Each step object has:

| Field | Rule |
|---|---|
| `context` | **Step 1 only.** `{ question, setting, why, prereqs: [], example }`, rendered as a card above `body`. `question`: what we're explaining and what prompted it. `setting`: which system/repo and the main parts involved. `why`: what goes wrong or stays confusing without this. `prereqs`: 0–3 things to know first, each with a one-line refresher. `example`: the running example's inputs and starting state. One or two sentences each; HTML allowed (`<dfn>`, `<code>`). |
| `title` | ≤ 6 words, names the idea ("Requests hit the gateway first") |
| `summary` | ≤ 8 words, one-line takeaway shown next to the title in the Recap's step list ("bad tokens stop at a 401"). |
| `body` | 2–5 short sentences of plain language. **Open with a transition** that ties it to the previous step ("Once the token is decoded…") and **say why this step happens**, not only what happens. Bold the one key idea. **Name the highlighted part of the diagram** and wrap that name in `<mark>…</mark>`; it gets the same colour as the diagram's `hl` highlight, so the reader can match text to picture. Wrap glossary terms in `<dfn>term</dfn>` for hover tooltips. |
| `diagram` | **Preferred visual.** `{ hl: [ids new in this step], hide?: [...], dim?: [...], build?: [...] }` over the page's shared `DIAGRAM`, naming its node and edge ids. Earlier steps' parts look normal, parts not introduced yet are ghosted, the Recap shows everything, and a legend is added. `build` lists parts (or arrays of parts) revealed one per Next/→ click before the step advances — use it only where message order is the point, max 4 stages. |
| `visual` | Escape hatch when one step needs its own picture (replaces `diagram`). Inline SVG or small HTML. Give the `<svg>` a `viewBox` of width 560–720 (≤ 900 for `wide`) so the 16px text renders near its real size, and **no `width`**. Use CSS vars so it works in dark mode and the diagram kit classes (`.box .arrow .label .zone .hl .bad .ok`); mark staged parts with `data-b="1"`, `data-b="2"`… and set `build: n` on the step. |
| `analogy` | Optional one-liner real-world analogy. Say which part maps to which; put "where the analogy breaks down" in `deeper`. |
| `code` | Optional minimal snippet (≤ 15 lines) — only the lines that matter. Lines containing `←` (e.g. `// ← this`) are highlighted in the diagram's colour. |
| `deeper` | Optional "go deeper" detail, hidden behind a toggle. Edge cases and nuance go here, NOT in `body`. |
| `quiz` | Optional `{q, options[], answer, why}` — for the confusing steps. Use 3–4 options: the reader gets one retry before the answer is revealed, and with only 2 options the retry would give it away. Ask a **prediction** ("what happens if…", "which component…"), not recall of the text. An option may be `{t, why}`: `why` is shown on the retry and explains why *that* answer is wrong (name the misconception). `why` on the quiz explains the right answer and names the trap. A quiz may sit on the step *after* a concept is introduced, to apply it. The page shuffles the options on display, so write them in any order and don't try to vary the right answer's position yourself. |
| `whatif` | Optional `{ label, control?, options: [{ id, label, outcome, diagram? }] }`: a toggle or slider that switches the step's outcome text and lit diagram parts. See "What-if controls". |
| `matrix`, `diff`, `phase`, `verdicts`, `evidence`, `layer` | Page-type fields; see "Page types". `panel: false` hides the type's panel on one step. |
| `depth` | Optional `"full"`: a **background step** (a refresher on a prerequisite, how the system is laid out) that a reader who already knows it can skip. The page's **Short** switch hides these steps, and the Context card's `setting`, `why` and `prereqs`; the steps are renumbered and Next skips over them. Leave it off the steps the mechanism needs, and don't light diagram parts on a background step (later steps would show them as already introduced). Ignored on step 1 and the Recap. |
| `wide` | Optional `true` — puts `visual`/`code` under the text at full width instead of beside it. Steps whose `DIAGRAM` is wider than 680 units, steps with a `diff`, and decision steps without a quiz get this on their own, and the Recap is always wide; set it for a wide `visual`. |

Global rules:
- **One new concept per step.** If a step needs "and also…", split it.
- **Context before mechanism**: step 1 is always the Context step, whatever the type (`title` like "What we're figuring out", `context` card, a one-sentence `body` saying what the steps will follow, `diagram: {}` so the whole map appears ghosted as the setting). No reader should meet the mechanism before knowing the question, the setting and why it matters.
- **Concrete before abstract**: from step 2 on, each `body` starts with what happens to the running example, then states the general rule. Diagram labels and code use the example's real values. Step 2 lights only the entry point.
- **No unexplained names**: every project-specific name used anywhere on the page is in `CAST`, and wrapped in `<dfn>` the first time it appears. Every jargon term is in `GLOSSARY`, same treatment.
- **No gaps between steps**: reading only the step titles and the first clause of each body should tell a continuous story.
- **Refer to another step by what it showed, not its number** ("the cache hit you switched to earlier"): the Short version renumbers the steps.
- **One diagram, same positions in every step** (the `DIAGRAM` + `diagram.hl` mechanism): consistency beats novelty. Follow the rules in `diagram-recipes.md` (labelled edges, 1–3 parts per step, ≤ ~7 nodes, no sentences in boxes).
- Colour carries one meaning: `<mark>` and `.hl` (orange) = the thing this step is about; key ideas are just **bold**.
- Use the user's actual names (files, services, functions) from the conversation, not generic placeholders.
- Final step is always **Recap**: a 1–2 sentence `body` + `diagram: {}` (the whole diagram, nothing ghosted) when the page has a `DIAGRAM`, else a "how it all fits" `visual` if one helps. A type's panel is shown complete on the Recap by itself. Don't write the step list yourself; the engine builds it from each step's `title` + `summary` (clickable, with quiz marks) and adds the finish panel (score, Start over, Review all, Glossary).
- No external network resources (fonts, CDNs, images). Must work offline and in light/dark mode.
- Accuracy over flourish: **add background context freely when it is verified** — from code you read, docs, or the conversation itself — because missing context is the most common reason an explanation can't be followed. Never invent it: if a fact the reader needs can't be verified, check it (read the file, grep) or say plainly on the page that it's an assumption.

## Engine features (already implemented — you get them by building)

- **Fits the viewport**: fixed top bar / sidebar / footer; only the step area scrolls. On wide screens each step is two columns (text left, visual + code right); code wraps instead of being clipped.
- **Orientation**: every step shows "Step n of N" and slides in from the direction of travel; the sidebar lists every step title (current / visited, plus ✓ / ? quiz marks) under the big picture. The big picture also opens step 1 on every screen. On phones the top bar shows title + `n / N`, and the ☰ drawer holds the steps, Glossary, Show all and the theme switch.
- **Navigation**: footer Back (hidden on step 1) / Next with a "Next: <title>" preview (shown on the button on phones); ← / → keys; swipe on phones; each step is a browser-history entry, so browser Back/Forward move between steps; `#step-N` deep links.
- **Ending**: on the last step Next becomes "Finish ✓" and jumps to the finish panel (score, Start over, Review all steps, Open glossary).
- **Page types**: the decision matrix, line diff, hypothesis board and layer stack described in "Page types", each with the same new / introduced / coming-later ghosting as the diagram.
- **Shared diagram**: one `DIAGRAM`, laid out from a spec (`sequence`, `chain`, `layers`, `states`) or written as SVG; per-step `diagram.hl` lighting, auto-ghosting of parts not yet introduced, legend, staged `build` reveals, diagram kit classes (`.label .zone .lifeline .bad .ok .flow .dim`), arrowheads that follow the theme.
- **What-if controls**: a native radio group or range input per `whatif` step, so Tab, the arrow keys and screen readers work as they do on any form; the picked option's outcome is announced, its diagram state shown, and the choice remembered. ←/→ on the control change the option, not the step.
- **Quiz**: options shown in a shuffled (but stable across reloads) order; one retry before the answer is revealed, with option-specific hints; results show in the sidebar and the Recap.
- **Still confused here**: a box under every step. The reader can say what's unclear, then copy a prompt to paste back into Claude: page title, step n of N, the step's summary, text and analogy, the terms it uses, a missed check, and what they typed. Nothing is sent anywhere, and the prompt holds no file path. Copying works from `file://`; where the browser refuses, the prompt is shown selected to copy by hand. Hidden when printing.
- **Progress is remembered** per page (localStorage): visited steps, quiz answers, last step.
- **Short / full depth**: a **Short** switch (top bar; ☰ menu on phones) skips the `depth: "full"` background steps and the Context card's setting, why and prereqs, renumbers what is left, and is remembered across pages like the theme. Step 1 says what the short version leaves out, with a link back to the full one. Shown only when a page has something to skip.
- **Clickable diagram parts**: a part whose label, id or `term` names a `CAST`/`GLOSSARY` entry shows that entry on click or Tab + Enter; the legend says so.
- **Index page**: every build rewrites `index.html` next to the page, listing every explainer in that folder with its big picture, type, step count, date and reading progress, with a filter box.
- "Show all" for skimming / printing; the sidebar and counter follow the scroll position.
- **Context card** on step 1 (`context` field) and a **Who's who** section (`CAST`) shown first in the Glossary drawer; `<dfn>` tooltips look up both `CAST` and `GLOSSARY`.
- Glossary tooltips via `<dfn>` (kept on-screen) plus a Glossary drawer. Drawers have a × button, a dimmed backdrop and close on Esc.
- Accessibility: step changes, reveals and quiz explanations are announced to screen readers; `aria-current` marks the current step; drawers are dialogs that take focus, return it on close, and block ←/→ while open; ←/→ scroll a wide diagram instead of changing step; `<dfn data-term="token">tokens</dfn>` maps inflected words to a glossary entry; reduced-motion is respected.
- Light/dark: follows `prefers-color-scheme` by default; the ☀/☾ button switches manually and the choice is remembered. Diagrams scroll sideways on phones rather than shrinking to unreadable text.

Keep each step to roughly one screen: body ≤ 5 sentences, code ≤ 15 lines of ≤ 60 characters, quiz 3–4 options.
