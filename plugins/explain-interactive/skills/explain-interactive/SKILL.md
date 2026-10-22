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

1. **Decompose before writing HTML.** Re-read the source explanation and produce (internally) a learning path:
   - One-sentence **big picture** (what & why).
   - 4–10 **steps**, each introducing ONE new idea, ordered so each builds only on earlier ones.
   - **Prerequisite terms** → glossary entries.
   - Where the real mechanism is spatial/temporal (flows, layers, sequences, state changes), plan a **diagram** for that step.
   - The 2–3 points where a learner most likely gets confused → **check-your-understanding** questions.
2. **Fill the template** at `template.html` (same directory as this file). Keep its structure, stepper, styles and JS; replace only the `STEPS`, `GLOSSARY`, `META` data and per-step HTML. Do not pull in frameworks.
3. **Deliver locally.** Write the file to `~/explanations/<kebab-topic>.html` and run `open <path>` (macOS) / `xdg-open` (Linux). Never publish to claude.ai or use the `Artifact` tool unless the user explicitly asks for it.
4. Reply in chat with **one line**: what the page covers + file path. Don't repeat the explanation in chat.

## Content rules per step

Each step object has:

| Field | Rule |
|---|---|
| `title` | ≤ 6 words, names the idea ("Requests hit the gateway first") |
| `summary` | ≤ 8 words, one-line takeaway shown next to the title in the Recap's step list ("bad tokens stop at a 401"). |
| `body` | 2–5 short sentences of plain language. Bold the one key idea. **Name the highlighted part of the diagram** and wrap that name in `<mark>…</mark>`; it gets the same colour as the diagram's `hl` highlight, so the reader can match text to picture. Wrap glossary terms in `<dfn>term</dfn>` for hover tooltips. |
| `visual` | Inline SVG or small HTML diagram showing *this step's* mechanism. Give the `<svg>` a `viewBox` but **no `width`** (it scales to its column). Use CSS vars (`var(--fg)`, `var(--accent)`, …) so it works in dark mode. Highlight what's new in this step with `class="hl"`. Optional only if a visual would add nothing. |
| `analogy` | Optional one-liner real-world analogy. |
| `code` | Optional minimal snippet (≤ 15 lines) — only the lines that matter, with `// ← this` markers. |
| `deeper` | Optional "go deeper" detail, hidden behind a toggle. Edge cases and nuance go here, NOT in `body`. |
| `quiz` | Optional `{q, options[], answer, why}` — for the confusing steps. Use 3–4 options: the reader gets one retry before the answer is revealed, and with only 2 options the retry would give it away. |
| `wide` | Optional `true` — puts `visual`/`code` under the text at full width instead of beside it. Use for very wide diagrams. The Recap is always wide. |

Global rules:
- **One new concept per step.** If a step needs "and also…", split it.
- Reuse the same diagram across steps and progressively reveal/highlight parts — consistency beats novelty.
- Use the user's actual names (files, services, functions) from the conversation, not generic placeholders.
- Final step is always **Recap**: a 1–2 sentence `body` + a "how it all fits" `visual`. Don't write the step list yourself; the template builds it from each step's `title` + `summary` (clickable, with quiz marks) and adds the finish panel (score, Start over, Review all, Glossary).
- No external network resources (fonts, CDNs, images). Must work offline and in light/dark mode.
- Accuracy over flourish: never add claims that weren't in the source explanation or verified.

## Template features (already implemented — keep them)

- **Fits the viewport**: fixed top bar / sidebar / footer; only the step area scrolls. On wide screens each step is two columns (text left, visual + code right); code wraps instead of being clipped.
- **Orientation**: the sidebar lists every step title (current / visited, plus ✓ / ? quiz marks) under the big picture. The big picture also opens step 1 on every screen. On phones the top bar shows title + `n / N`, and the ☰ drawer holds the steps, Glossary, Show all and the theme switch.
- **Navigation**: footer Back (hidden on step 1) / Next with a "Next: <title>" preview (shown on the button on phones); ← / → keys; swipe on phones; each step is a browser-history entry, so browser Back/Forward move between steps; `#step-N` deep links.
- **Ending**: on the last step Next becomes "Finish ✓" and jumps to the finish panel (score, Start over, Review all steps, Open glossary).
- **Quiz**: one retry before the answer is revealed; results show in the sidebar and the Recap.
- **Progress is remembered** per page (localStorage): visited steps, quiz answers, last step.
- "Show all" for skimming / printing; the sidebar and counter follow the scroll position.
- Glossary tooltips via `<dfn>` (kept on-screen) plus a Glossary drawer. Drawers have a × button, a dimmed backdrop and close on Esc.
- Accessibility: step changes and quiz results are announced to screen readers; focus moves to the step heading when picked from the outline; reduced-motion is respected.
- Light/dark: follows `prefers-color-scheme` by default; the ☀/☾ button switches manually and the choice is remembered. Diagrams scroll sideways on phones rather than shrinking to unreadable text.

Keep each step to roughly one screen: body ≤ 5 sentences, code ≤ 15 lines of ≤ 60 characters, quiz 3–4 options.
