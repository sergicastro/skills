# What-if controls

Read this when a step's outcome depends on a condition the reader would want to flip. Example:
`examples/cache-read.content.js`.

A what-if control is a toggle or a slider above the step's visual that switches which diagram parts
are lit and which outcome text is shown. Use it where the reader's natural question is "and what if
it weren't?": an expired or a valid token, a cache hit or a miss, a value under or over a limit.
One step with a what-if replaces two near-identical steps.

```js
// on a step:
whatif: {
  label: "the key is…",                       // read as "What if the key is…"
  control: "choice",                           // choice (default): a row of buttons; slider: ordered values
  options: [                                   // 2–4; the first is shown on arrival
    { id: "hit",  label: "in Redis",
      outcome: `A <dfn>cache hit</dfn>: Redis returns <mark>the cached product</mark>.`,
      diagram: { hl: ["hit"] } },
    { id: "miss", label: "not in Redis",
      outcome: `A <dfn>cache miss</dfn>, so the <mark>SELECT</mark> runs.`,
      diagram: { hl: ["miss", "query"] } },
  ],
},
```

- `label` finishes the sentence "What if …". Each option's `label` is the value the reader picks (a
  few words), and its `outcome` (1–2 sentences, HTML allowed) says what happens in that case. Wrap
  the part it lights in `<mark>`.
- An option's `diagram` takes `hl`, `hide` and `dim` and replaces the step's own `diagram` fields
  while that option is picked. Leave it out and the option keeps the step's diagram, changing the
  outcome text only. Every part any option lights counts as introduced on later steps, so they
  aren't ghosted there.
- Use `slider` when the options are points on one scale in order (an entry 10 s, 59 s and 61 s old;
  1, 10 and 100 requests a second); `choice` for cases with no order. Put the case that makes the
  step's point first.
- The `body` sets up the condition and says what to try ("Switch between the two cases"); the
  outcomes carry the difference. A `quiz` on the same step or the next one can ask the reader to
  predict a case.
- A step can't have both a what-if and `build` stages, and the Recap takes none. On a step with its
  own `visual`, options change only the outcome text.
- The reader's pick is remembered with the rest of the progress, "Start over" resets it, and the
  "Still confused here" prompt says which case they were looking at.

What `--check` reports:

- Errors: no `label` or `options[]`; fewer than 2 options; an option without `id`, `label` or
  `outcome`, or a repeated id; a `control` other than `choice`/`slider`; `build` stages on the same
  step (on the step or in an option's `diagram`); an option's `diagram` naming a part that isn't in
  `DIAGRAM`, or set when there is no `DIAGRAM`.
- Warnings: more than 4 options; an outcome over 2 sentences; an option lighting more than 3 parts,
  or lighting parts with no `<mark>` in its outcome or the body; a what-if on the Recap; options
  with a `diagram` on a step that shows its own `visual` (they change nothing).

Screenshots: `shots.mjs` saves a step with a what-if once per other option as
`step-NN-<option id>.png`. In the name, each run of characters other than letters, digits and `_`
becomes `_`; an id that is `phone`, or that comes out the same as an earlier option's, gets `_2`,
`_3`, … so no two images share a name.
