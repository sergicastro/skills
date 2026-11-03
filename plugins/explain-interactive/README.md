# explain-interactive

A Claude Code skill that turns an explanation you found hard to follow into a
self-contained, step-by-step interactive HTML page. Each page follows one running
example through a single shared diagram, highlights the part each step is about, and
adds a glossary, a recap and short quizzes. A step can carry a what-if control (a toggle
or a slider) that switches the outcome it shows, such as a cache hit or a miss. A reader still stuck on a step can copy a
ready-made prompt about that step and paste it back into Claude.
Besides that walkthrough, a page can be built around a decision (options against criteria,
with a recommendation), a before/after diff, a debugging story (hypotheses ruled out one
by one) or a concept built up layer by layer; the skill picks the type that fits.

![A generated page stepping through why an expired token gets a 401: the context card, then one diagram part lit up per step](docs/demo.gif)

## Use

Ask for it after an explanation, e.g. "show me that as HTML", "walk me through it step
by step", or run `/explain-interactive <topic>`. The page is written to
`~/explanations/<topic>.html` (with its source, `<topic>.content.js`, next to it) and opened in your browser. Nothing is published.

## Install

In Claude Code:

    /plugin install explain-interactive --marketplace sergicastro/skills

On Claude Code older than 2.1.275, add the marketplace first:

    /plugin marketplace add sergicastro/skills
    /plugin install explain-interactive@sergicastro-skills

## Layout

- `skills/explain-interactive/SKILL.md`: the workflow and the data format for each step
- `skills/explain-interactive/engine/`: the page shell, styles and script shared by every page (`page.html`, `engine.css`, `engine.js`), and the diagram layouts the build runs (`layout.mjs`)
- `skills/explain-interactive/build.mjs`: inlines a content file into the engine and writes one offline HTML file (Node 22+, no dependencies)
- `skills/explain-interactive/shots.mjs`: renders every step of a page in headless Chrome to `step-NN.png` for review, and reports what it can measure (overflow, tiny diagram text, console errors)
- `skills/explain-interactive/cdp.mjs`: the small DevTools-protocol driver `shots.mjs` and the tests use
- `skills/explain-interactive/examples/`: one sample content file per page type (walkthrough, decision, before/after, debugging story, concept), and walkthroughs for each diagram layout and for what-if controls
- `test/`: `node --test plugins/explain-interactive/test/*.test.mjs` (the browser test needs Chrome or Chromium; set `CHROME=` to pick one)

Claude writes only `~/explanations/<topic>.content.js` (`META`, `CAST`, `GLOSSARY`, `DIAGRAM`, `STEPS`); the build turns it into the page. To change a page, edit its content file and rebuild:

    node skills/explain-interactive/build.mjs ~/explanations/<topic>.content.js

Pages made before the engine split can be recovered with `build.mjs --extract <page>.html`.
- `skills/explain-interactive/diagram-recipes.md`: how to declare the shared diagram and pick its layout

## License

MIT. See [LICENSE](../../LICENSE).
