---
name: explain-interactive
description: Use when the user wants an explanation as an interactive, step-by-step HTML page instead of prose: how a system or flow works, a choice between options, what a change or PR does, why a bug happens, or a concept. Covers turning an explanation you already gave into a page ("present that as HTML", "make it visual", "I don't get it, show me", "something the team can step through") and direct asks ("an interactive diagram of our auth flow", "walk me through what this PR changes", "compare Redis vs Postgres for sessions interactively", "/explain-interactive"). Builds a self-contained explainer page from the previous explanation or a named topic. Not for charts, dashboards or other data visualizations, slide decks, docs or landing pages.
---

# Interactive Step-by-Step Explainer

Turn a complex explanation into a single self-contained HTML page that a human can walk through
**one step at a time**, with visuals, analogies and self-checks.

## When to use

- The user says an explanation is complex/confusing and asks for an HTML / visual / interactive /
  step-by-step version.
- Default subject: **the last substantive explanation Claude gave in this conversation**. If the
  user names another topic, use that. If ambiguous, pick the most recent one and say so in one
  line; don't ask.

## Files next to this skill

Read only what the page needs:

| File | Read it when |
|---|---|
| `references/content-file.md` | Always, before writing the content file: its format, every step field, what `--check` reports, the commands. |
| `diagram-recipes.md` | The page has a `DIAGRAM` (most walkthroughs): layouts and the spec. |
| `references/whatif.md` | A step gets a what-if control. |
| `references/<type>.md` (`decision`, `before-after`, `debugging`, `concept`) | The page is of that type (one file). |
| `examples/<name>.content.js` | Always: the one for your type (table below), as the shape to copy. |

## Workflow

The scripts need **Node 22 or newer** (`node --version`). If Node is missing or older, don't try
to work around it: tell the user to install a current Node (https://nodejs.org or their package
manager) and stop; the page can't be checked or built without it.

0. **Pick the page type** from "Page types" below: it decides what the page is built around (a
   mechanism, a choice, a change, an investigation, a concept). Read its file. Say which type you
   picked in your final line.
1. **Find the reader's gap.** From the user's message, work out *what* they found hard to follow
   and what they likely already know (their role, what they've said, what they've done in the
   conversation). Pitch the page at that level and give the confusing point the most room. If the
   source explanation is a reply inside a conversation, assume it leans on context the reader never
   saw: files Claude read, earlier turns, how the system is laid out.
2. **List the assumptions, then decompose.** Before planning steps, write down (internally)
   everything the source explanation takes for granted: terms, project names, how the system is
   laid out, why the problem exists, what the starting state is. Each item must end up somewhere on
   the page (the Context step, a step of its own, `CAST`, or `GLOSSARY`), never left unstated. Then
   produce the learning path:
   - One-sentence **big picture** (what & why).
   - A **Context step** (always step 1, see "Rules for every page"): the question, where it
     happens, why it matters, prerequisites, the running example set up in full.
   - One **running example**: a concrete case from the conversation (a specific request, file,
     value, e.g. "`GET /orders` with an expired token") that every step follows. It supplies the
     real values for diagram labels and code.
   - **5–10 steps in all, Context and Recap included** (so 3–8 steps in between), each introducing
     ONE new idea, ordered so each builds only on earlier ones.
   - A step that only refreshes background a knowledgeable reader already has → mark it
     `depth: "full"` so the Short switch can skip it.
   - **Prerequisite terms** → `GLOSSARY` entries; **every project-specific name** on the page
     (service, file, function, team, flag) → a `CAST` one-liner.
   - For a type other than walkthrough, plan its structure first (the options and criteria, the
     two versions, the hypotheses, the layers) and give each step one piece of it.
   - Where the real mechanism is spatial/temporal (flows, layers, sequences, state changes), plan
     **one diagram for the whole page**: read `diagram-recipes.md`, pick the layout (`sequence`,
     `chain`, `layers` or `states`) that matches the mechanism, list its nodes and edges, then
     decide which parts each step lights up.
   - Where the outcome depends on a condition the reader would want to flip (token expired or not,
     cache hit or miss, a value crossing a limit), plan a **what-if control** on that step instead
     of two near-identical steps (`references/whatif.md`).
   - The 2–3 points where a learner most likely gets confused → **check-your-understanding**
     questions: **2–3 quizzes per page**, one per point, on different steps. Each wrong option
     should be a real misconception from the source.
3. **Write only the content file.** The page's look and behaviour live in an engine you don't
   touch (`engine/`). You write one plain script, `~/explanations/<kebab-topic>.content.js`, that
   declares `META`, `CAST`, `GLOSSARY`, `DIAGRAM` and `STEPS`, plus `DECISION`, `HYPOTHESES` or
   `LAYERS` for those page types, as `references/content-file.md` describes. Start from the example
   for your page type: copy its shape, replace all of its content. No HTML shell, CSS, engine code
   or frameworks in it.
4. **Check the content (required).** Run
   `node <this skill's directory>/build.mjs --check ~/explanations/<kebab-topic>.content.js`. It
   writes nothing and lists every problem as `error:` or `warning:` with the step it is on
   (`references/content-file.md` lists them all). Fix them in the content file and run it again
   until there are **no errors and every remaining warning has a reason** you can state (e.g. a
   long command that can't be wrapped); it then prints `N warnings` instead of `ok`, and that is
   fine. Say which warnings you kept, and why, in your final line.
5. **Cold-reader check (required).** Claude can't see its own assumptions, so test the page on
   someone who has none of the conversation. Spawn a fresh subagent (`Agent` tool,
   `general-purpose`, never a fork: a fork inherits the context) and give it **only the page's
   text**: `META`, `CAST`, `GLOSSARY`, the type's own structure (`DECISION`, `HYPOTHESES` or
   `LAYERS`) and every step's fields, in order; not the conversation, not the source explanation.
   Ask it to read as a newcomer to this project and list, per step: every term or name it couldn't
   place, every jump where it didn't see how this follows from the previous step, every "why?"
   left unanswered, and anything it had to guess. **Size it to the page:** for a page of up to 7
   steps, pass `effort: "lower"` and ask for at most 6 items, the ones that most block
   understanding; for 8–10 steps, at most 10. Ask for a plain list, no rewrite of the page.
   For each item, fix the page: add a `CAST`/`GLOSSARY` entry, add a sentence or prerequisite to
   the Context step, add a transition, or split out a new step. Fix only with verified facts (see
   the accuracy rule). Re-run the check once if you added steps; then move on: one cold reader per
   page. If the `Agent` tool is unavailable, do the same pass yourself, reading strictly as someone
   who has only the page.
6. **Build and review the screenshots (required).** Run
   `node <this skill's directory>/build.mjs ~/explanations/<kebab-topic>.content.js`. It runs the
   same checks, inlines the content with the engine into `~/explanations/<kebab-topic>.html` (one
   self-contained file, works offline) and prints the path; on errors it writes nothing. It also
   rewrites `~/explanations/index.html`, the list of every page there. Then run
   `node <this skill's directory>/shots.mjs ~/explanations/<kebab-topic>.html --phone`. It renders
   every step in headless Chrome as the reader sees it on arrival, with all build stages revealed,
   saves `step-NN.png` (desktop) and `step-NN-phone.png`, plus `step-NN-<option id>.png` for each
   other option of a what-if, and prints their paths and `finding:` lines.
   - **Read every desktop image** (`Read` each one, what-if options included). **Spot-check the
     phone images:** read step 1's and the one for the step with the widest diagram, `diff` or
     table; read more only if those show a problem.
   - Fix the content for what you see: a label that overlaps or is cut off, the wrong part lit,
     text that doesn't match the picture, a step that needs scrolling, an empty or broken panel.
     Also fix every `finding:` (a middle step much taller than the screen, a diagram that scrolls
     sideways, diagram text too small, console errors, a dialog the page opened, external
     requests). Size findings are measured on desktop only; the phone images are where a phone
     layout problem shows.
   - After changes, rebuild and re-shoot (without `--phone` unless a phone problem was fixed), and
     read again only the images of the steps you changed.
   - If no Chrome, Chromium or Edge is found (`CHROME=/path/to/chrome` picks one), it says so: skip
     the images then and tell the user in your final line.
7. **Deliver locally.** Open the page: `open <path>` (macOS), `xdg-open <path>` (Linux),
   `start "" "<path>"` (Windows `cmd`; in PowerShell `Start-Process "<path>"`). If that fails or
   there is no desktop (SSH, a container), don't retry: give the user the full path to open
   themselves. Keep the `.content.js` next to the page: to change the page later, edit the content
   and rebuild; never edit the built HTML. Never publish to claude.ai or use the `Artifact` tool
   unless the user explicitly asks for it.
8. Reply in chat with **one line**: what the page covers, its type, and the file path. Don't repeat
   the explanation in chat.

**When the reader comes back stuck.** Each step has a "Still confused here" box that copies a
prompt starting *I'm reading an explainer page, "<title>", and I'm stuck on step n of N*. It
carries the step's text, the terms it uses, a missed check and what the reader typed. Answer it in
chat, aimed at what they said is unclear. If the answer shows the page itself skips or gets
something wrong, fix that step in the `.content.js` and rebuild, and say so in one line.

## Page types

Every type keeps the same page: sidebar, Next/Back, Context step, quizzes, glossary, Recap. The
type adds one panel, drawn next to each step's text, that holds the thing the page is built around.
Set it with `META.type`; leave it out for a walkthrough.

| If the explanation is about… | Type | The page is built around | Read | Example |
|---|---|---|---|---|
| how something works: a request's path, a sequence, what calls what | `walkthrough` (default) | one shared `DIAGRAM`, lit part by part | `diagram-recipes.md` | `token-401`; with what-if controls, `cache-read` |
| which of several options to pick, and why | `decision` | an options × criteria table, with cost and a recommendation | `references/decision.md` | `session-store` |
| what a change does: a refactor, a config change, a migration | `before-after` | a line diff of the two versions per step | `references/before-after.md` | `multistage-build` |
| why something broke, and how that was found | `debugging` | phases, evidence blocks, and a board of hypotheses ruled out or confirmed | `references/debugging.md` | `cron-twice` |
| an idea made of parts that build on each other: a protocol stack, a mental model, layers of an abstraction | `concept` | a stack of layers, one added per step, foundation at the bottom | `references/concept.md` | `https-layers` |

Examples are `examples/<name>.content.js`.

How to choose:
- Ask what the reader has to come away with. A path through a system → walkthrough. A choice →
  decision. A difference between two versions → before-after. A cause → debugging. A model they can
  reuse → concept.
- If the user's question starts with "which", "should we" or "X or Y", it is a decision. "What
  changed" or "what does this PR do" is before-after. "Why did X happen" about a past failure is
  debugging. "How does X work" is a walkthrough when X has moving parts, and a concept when X is an
  idea with levels.
- When two fit, pick the one whose panel the reader would look at most. A debugging story can still
  carry a `DIAGRAM` or a `code` snippet on a step; a decision step can still show a `visual`.
- Don't force it: if none fits clearly, use walkthrough.

## Rules for every page

- **One new concept per step.** If a step needs "and also…", split it.
- **Context before mechanism**: step 1 is always the Context step, whatever the type (`title` like
  "What we're figuring out", `context` card, a one-sentence `body` saying what the steps will
  follow, `diagram: {}` so the whole map appears ghosted as the setting). No reader should meet the
  mechanism before knowing the question, the setting and why it matters.
- **Concrete before abstract**: from step 2 on, each `body` starts with what happens to the running
  example, then states the general rule. Diagram labels and code use the example's real values.
  Step 2 lights only the entry point.
- **No unexplained names**: every project-specific name used anywhere on the page is in `CAST`, and
  wrapped in `<dfn>` the first time it appears. Every jargon term is in `GLOSSARY`, same treatment.
- **No gaps between steps**: reading only the step titles and the first clause of each body should
  tell a continuous story.
- **Refer to another step by what it showed, not its number** ("the cache hit you switched to
  earlier"): the Short version renumbers the steps.
- **One diagram, same positions in every step** (the `DIAGRAM` + `diagram.hl` mechanism):
  consistency beats novelty. Follow the rules in `diagram-recipes.md` (labelled edges, 1–3 parts
  per step, ≤ ~7 nodes, no sentences in boxes).
- Colour carries one meaning: `<mark>` and `.hl` (orange) = the thing this step is about; key ideas
  are just **bold**.
- Use the user's actual names (files, services, functions) from the conversation, not generic
  placeholders.
- Final step is always **Recap**: a 1–2 sentence `body` + `diagram: {}` (the whole diagram, nothing
  ghosted) when the page has a `DIAGRAM`, else a "how it all fits" `visual` if one helps. A type's
  panel is shown complete on the Recap by itself. Don't write the step list yourself; the engine
  builds it from each step's `title` + `summary` and adds the finish panel.
- Keep each step to roughly one screen: body 2–5 sentences (≤ ~120 words), code ≤ 15 lines of ≤ 60
  characters, quiz 3–4 options. Edge cases go in `deeper`.
- No external network resources (fonts, CDNs, images). Must work offline and in light/dark mode.
- Accuracy over flourish: **add background context freely when it is verified** (from code you
  read, docs, or the conversation itself) because missing context is the most common reason an
  explanation can't be followed. Never invent it: if a fact the reader needs can't be verified,
  check it (read the file, grep) or say plainly on the page that it's an assumption.

The page's features (navigation, quizzes, Short switch, progress, index, accessibility) come with
the engine; the plugin README lists them.
