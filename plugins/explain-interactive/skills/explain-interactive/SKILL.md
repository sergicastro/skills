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

0. **Find the reader's gap.** From the user's message, work out *what* they found hard to follow and what they likely already know (their role, what they've said, what they've done in the conversation). Pitch the page at that level and give the confusing point the most room. If the source explanation is a reply inside a conversation, assume it leans on context the reader never saw: files Claude read, earlier turns, how the system is laid out.
1. **List the assumptions, then decompose.** Before planning steps, write down (internally) everything the source explanation takes for granted: terms, project names, how the system is laid out, why the problem exists, what the starting state is. Each item must end up somewhere on the page — the Context step, a step of its own, `CAST`, or `GLOSSARY` — never left unstated. Then produce the learning path:
   - One-sentence **big picture** (what & why).
   - A **Context step** (always step 1, see below): the question, where it happens, why it matters, prerequisites, the running example set up in full.
   - One **running example**: a concrete case from the conversation (a specific request, file, value — e.g. "`GET /orders` with an expired token") that every step follows. It supplies the real values for diagram labels and code.
   - 4–10 **steps**, each introducing ONE new idea, ordered so each builds only on earlier ones.
   - **Prerequisite terms** → `GLOSSARY` entries; **every project-specific name** on the page (service, file, function, team, flag) → a `CAST` one-liner.
   - Where the real mechanism is spatial/temporal (flows, layers, sequences, state changes), plan **one diagram for the whole page**: pick the pattern from `diagram-recipes.md` (read it), then decide which parts each step lights up.
   - The 2–3 points where a learner most likely gets confused → **check-your-understanding** questions. Each wrong option should be a real misconception from the source.
2. **Fill the template** at `template.html` (same directory as this file). Keep its structure, stepper, styles and JS; replace only the `STEPS`, `CAST`, `GLOSSARY`, `META`, `DIAGRAM` data and per-step HTML. Do not pull in frameworks.
3. **Cold-reader check (required).** Claude can't see its own assumptions, so test the page on someone who has none of the conversation. Spawn a fresh subagent (`Agent` tool, `general-purpose`, never a fork — a fork inherits the context) and give it **only the page's text**: `META`, `CAST`, `GLOSSARY` and every step's fields, in order — not the conversation, not the source explanation. Ask it to read as a newcomer to this project and list, per step: every term or name it couldn't place, every jump where it didn't see how this follows from the previous step, every "why?" left unanswered, and anything it had to guess. For each item, fix the page: add a `CAST`/`GLOSSARY` entry, add a sentence or prerequisite to the Context step, add a transition, or split out a new step. Fix only with verified facts (see the accuracy rule). Re-run the check once if you added steps; then move on. If the `Agent` tool is unavailable, do the same pass yourself, reading strictly as someone who has only the page.
4. **Deliver locally.** Write the file to `~/explanations/<kebab-topic>.html` and run `open <path>` (macOS) / `xdg-open` (Linux). Never publish to claude.ai or use the `Artifact` tool unless the user explicitly asks for it.
5. Reply in chat with **one line**: what the page covers + file path. Don't repeat the explanation in chat.

## Content rules per step

Each step object has:

| Field | Rule |
|---|---|
| `context` | **Step 1 only.** `{ question, setting, why, prereqs: [], example }`, rendered as a card above `body`. `question`: what we're explaining and what prompted it. `setting`: which system/repo and the main parts involved. `why`: what goes wrong or stays confusing without this. `prereqs`: 0–3 things to know first, each with a one-line refresher. `example`: the running example's inputs and starting state. One or two sentences each; HTML allowed (`<dfn>`, `<code>`). |
| `title` | ≤ 6 words, names the idea ("Requests hit the gateway first") |
| `summary` | ≤ 8 words, one-line takeaway shown next to the title in the Recap's step list ("bad tokens stop at a 401"). |
| `body` | 2–5 short sentences of plain language. **Open with a transition** that ties it to the previous step ("Once the token is decoded…") and **say why this step happens**, not only what happens. Bold the one key idea. **Name the highlighted part of the diagram** and wrap that name in `<mark>…</mark>`; it gets the same colour as the diagram's `hl` highlight, so the reader can match text to picture. Wrap glossary terms in `<dfn>term</dfn>` for hover tooltips. |
| `diagram` | **Preferred visual.** `{ hl: [ids new in this step], hide?: [...], dim?: [...], build?: [...] }` over the page's shared `DIAGRAM` (parts are `<g data-id="…">`). Earlier steps' parts look normal, parts not introduced yet are ghosted, the Recap shows everything, and a legend is added. `build` lists parts (or arrays of parts) revealed one per Next/→ click before the step advances — use it only where message order is the point, max 4 stages. |
| `visual` | Escape hatch when one step needs its own picture (replaces `diagram`). Inline SVG or small HTML. Give the `<svg>` a `viewBox` of width 560–720 (≤ 900 for `wide`) so the 16px text renders near its real size, and **no `width`**. Use CSS vars so it works in dark mode and the diagram kit classes (`.box .arrow .label .zone .hl .bad .ok`); mark staged parts with `data-b="1"`, `data-b="2"`… and set `build: n` on the step. |
| `analogy` | Optional one-liner real-world analogy. Say which part maps to which; put "where the analogy breaks down" in `deeper`. |
| `code` | Optional minimal snippet (≤ 15 lines) — only the lines that matter. Lines containing `←` (e.g. `// ← this`) are highlighted in the diagram's colour. |
| `deeper` | Optional "go deeper" detail, hidden behind a toggle. Edge cases and nuance go here, NOT in `body`. |
| `quiz` | Optional `{q, options[], answer, why}` — for the confusing steps. Use 3–4 options: the reader gets one retry before the answer is revealed, and with only 2 options the retry would give it away. Ask a **prediction** ("what happens if…", "which component…"), not recall of the text. An option may be `{t, why}`: `why` is shown on the retry and explains why *that* answer is wrong (name the misconception). `why` on the quiz explains the right answer and names the trap. A quiz may sit on the step *after* a concept is introduced, to apply it. The page shuffles the options on display, so write them in any order and don't try to vary the right answer's position yourself. |
| `wide` | Optional `true` — puts `visual`/`code` under the text at full width instead of beside it. Use for very wide diagrams. The Recap is always wide. |

Global rules:
- **One new concept per step.** If a step needs "and also…", split it.
- **Context before mechanism**: step 1 is always the Context step (`title` like "What we're figuring out", `context` card, a one-sentence `body` saying what the steps will follow, `diagram: {}` so the whole map appears ghosted as the setting). No reader should meet the mechanism before knowing the question, the setting and why it matters.
- **Concrete before abstract**: from step 2 on, each `body` starts with what happens to the running example, then states the general rule. Diagram labels and code use the example's real values. Step 2 lights only the entry point.
- **No unexplained names**: every project-specific name used anywhere on the page is in `CAST`, and wrapped in `<dfn>` the first time it appears. Every jargon term is in `GLOSSARY`, same treatment.
- **No gaps between steps**: reading only the step titles and the first clause of each body should tell a continuous story.
- **One diagram, same positions in every step** (the `DIAGRAM` + `diagram.hl` mechanism): consistency beats novelty. Follow the rules in `diagram-recipes.md` (labelled arrows, 1–3 parts per step, ≤ ~7 boxes, no sentences in boxes).
- Colour carries one meaning: `<mark>` and `.hl` (orange) = the thing this step is about; key ideas are just **bold**.
- Use the user's actual names (files, services, functions) from the conversation, not generic placeholders.
- Final step is always **Recap**: a 1–2 sentence `body` + a "how it all fits" `visual`. Don't write the step list yourself; the template builds it from each step's `title` + `summary` (clickable, with quiz marks) and adds the finish panel (score, Start over, Review all, Glossary).
- No external network resources (fonts, CDNs, images). Must work offline and in light/dark mode.
- Accuracy over flourish: **add background context freely when it is verified** — from code you read, docs, or the conversation itself — because missing context is the most common reason an explanation can't be followed. Never invent it: if a fact the reader needs can't be verified, check it (read the file, grep) or say plainly on the page that it's an assumption.

## Template features (already implemented — keep them)

- **Fits the viewport**: fixed top bar / sidebar / footer; only the step area scrolls. On wide screens each step is two columns (text left, visual + code right); code wraps instead of being clipped.
- **Orientation**: the sidebar lists every step title (current / visited, plus ✓ / ? quiz marks) under the big picture. The big picture also opens step 1 on every screen. On phones the top bar shows title + `n / N`, and the ☰ drawer holds the steps, Glossary, Show all and the theme switch.
- **Navigation**: footer Back (hidden on step 1) / Next with a "Next: <title>" preview (shown on the button on phones); ← / → keys; swipe on phones; each step is a browser-history entry, so browser Back/Forward move between steps; `#step-N` deep links.
- **Ending**: on the last step Next becomes "Finish ✓" and jumps to the finish panel (score, Start over, Review all steps, Open glossary).
- **Shared diagram**: one `DIAGRAM`, per-step `diagram.hl` lighting, auto-ghosting of parts not yet introduced, legend, staged `build` reveals, diagram kit classes (`.label .zone .lifeline .bad .ok .flow .dim`), arrowheads that follow the theme.
- **Orientation**: every step shows "Step n of N"; steps slide in from the direction of travel; code lines with `←` are highlighted.
- **Quiz**: options shown in a shuffled (but stable across reloads) order; one retry before the answer is revealed, with option-specific hints; results show in the sidebar and the Recap.
- **Progress is remembered** per page (localStorage): visited steps, quiz answers, last step.
- "Show all" for skimming / printing; the sidebar and counter follow the scroll position.
- **Context card** on step 1 (`context` field) and a **Who's who** section (`CAST`) shown first in the Glossary drawer; `<dfn>` tooltips look up both `CAST` and `GLOSSARY`.
- Glossary tooltips via `<dfn>` (kept on-screen) plus a Glossary drawer. Drawers have a × button, a dimmed backdrop and close on Esc.
- Accessibility: step changes, reveals and quiz explanations are announced to screen readers; `aria-current` marks the current step; drawers are dialogs that take focus, return it on close, and block ←/→ while open; ←/→ scroll a wide diagram instead of changing step; `<dfn data-term="token">tokens</dfn>` maps inflected words to a glossary entry; reduced-motion is respected.
- Light/dark: follows `prefers-color-scheme` by default; the ☀/☾ button switches manually and the choice is remembered. Diagrams scroll sideways on phones rather than shrinking to unreadable text.

Keep each step to roughly one screen: body ≤ 5 sentences, code ≤ 15 lines of ≤ 60 characters, quiz 3–4 options.
