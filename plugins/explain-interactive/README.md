# explain-interactive

A Claude Code skill that turns an explanation you found hard to follow into a
self-contained, step-by-step interactive HTML page. Each page follows one running
example through a single shared diagram, highlights the part each step is about, and
adds a glossary, a recap and short quizzes.

- **Page types.** Besides that walkthrough, a page can be built around a decision (options
  against criteria, with a recommendation), a before/after diff, a debugging story
  (hypotheses ruled out one by one) or a concept built up layer by layer. The skill picks
  the type that fits.
- **What-if controls.** A step can carry a toggle or a slider that switches the outcome it
  shows, such as a cache hit or a miss, and the diagram parts it lights.
- **Short version.** Steps that only refresh background can be skipped with one switch.
- **Clickable diagram parts.** A part named in the glossary shows its entry on click.
- **Still confused here.** A reader stuck on a step can copy a ready-made prompt about
  that step and paste it back into Claude.

Diagrams are declared as nodes and edges and laid out by the build (sequence, chain,
layers or states), so every step shows them in the same place. Before showing you a page,
Claude checks its content and reads a screenshot of every step.

![A generated page about a cached read: a sequence diagram lit part by part, a what-if toggle between a cache hit and a miss, a diagram part showing its glossary entry, and a slider moving the entry past its TTL](docs/demo.gif)

## Use

Ask for it after an explanation, e.g. "show me that as HTML", "walk me through it step
by step", or run `/explain-interactive <topic>`. The page is written to
`~/explanations/<topic>.html` (with its source, `<topic>.content.js`, next to it) and opened in your browser. Nothing is published.
`~/explanations/index.html` lists every page you have, newest first, with how far you read each one.

## Install

In Claude Code:

    /plugin install explain-interactive --marketplace sergicastro/skills

On Claude Code older than 2.1.275, add the marketplace first:

    /plugin marketplace add sergicastro/skills
    /plugin install explain-interactive@sergicastro-skills

## Layout

- `skills/explain-interactive/SKILL.md`: the workflow and the data format for each step
- `skills/explain-interactive/diagram-recipes.md`: how to declare the shared diagram and pick its layout
- `skills/explain-interactive/engine/`: the page shell, styles and script shared by every page (`page.html`, `engine.css`, `engine.js`), and the diagram layouts the build runs (`layout.mjs`)
- `skills/explain-interactive/build.mjs`: checks a content file, inlines it into the engine and writes one offline HTML file, plus the `index.html` next to it (Node 22+, no dependencies)
- `skills/explain-interactive/shots.mjs`: renders every step of a page in headless Chrome to `step-NN.png` for review (plus `step-NN-<option>.png` per what-if option and `-phone` variants, never two with the same name), and reports what it can measure (a step taller than the screen, overflow, tiny diagram text, console errors, dialogs). With `-o` it only clears images it wrote there and refuses a folder holding other `step-*.png` files
- `skills/explain-interactive/cdp.mjs`: the small DevTools-protocol driver `shots.mjs` and the tests use (finds Chrome, Chromium or Edge on macOS, Linux and Windows or on `PATH`; times out stuck calls and answers page dialogs)
- `skills/explain-interactive/examples/`: one sample content file per page type (walkthrough, decision, before/after, debugging story, concept), and walkthroughs for each diagram layout, for what-if controls and for a wide diagram with quizzes (`dns-lookup`)
- `evals/`: skill-behaviour eval cases for `claude plugin eval`, one per page type, with a recorded baseline (see `evals/README.md`)
- `test/`: `node --test plugins/explain-interactive/test/*.test.mjs` (the browser tests need Chrome or Chromium; set `CHROME=` to pick one)

Claude writes only `~/explanations/<topic>.content.js`; the build turns it into the page. To change a page, edit its content file and rebuild:

    node skills/explain-interactive/build.mjs ~/explanations/<topic>.content.js

`build.mjs --check <file>` lists problems without writing anything. Pages made before the engine split can be recovered with `build.mjs --extract <page>.html`.

## License

MIT. See [LICENSE](../../LICENSE).
