# Page type: `decision`

Read this when the page compares options and recommends one (`META.type: "decision"`). Example:
`examples/session-store.content.js`.

The panel is an options × criteria table (`DECISION`), with cost and a recommendation.

```js
const META = { type: "decision", title, bigPicture };
const DECISION = {
  options:  [{ id: "redis", name: "Redis", summary: "one shared store" }, …],   // the columns, 2–4
  criteria: [{ id: "speed", name: "Read speed" }, …],                          // the rows, 2–6
  ratings:  { redis: { speed: { level: "good", note: "under a millisecond" } }, … },
            // level: good | fair | poor; or just "good"
  cost:     { redis: "One more service to run", … },   // optional: adds a last "Cost" row (id "cost")
  recommend: "redis",
  why: "the one sentence that decides it",
};
```

- Each step names what it discusses with `matrix: { criteria: [ids], options: [ids] }`: those rows
  and columns are lit, rows not discussed yet are ghosted, the Recap shows all. Discuss **one
  criterion per step**, in the order that eliminates options fastest, and use the running example
  ("Ana's second request lands on another server") to show why the criterion matters.
- The step that concludes sets `matrix: { …, recommend: true }`; from there on the recommended
  column is marked and `why` shown under the table. Without it the recommendation appears only on
  the Recap (a warning).
- Fill every cell: a missing rating is a warning. A `note` says why, in a few words; the level
  alone does not.
- The step 1 `context.question` names the choice; `why` says what goes wrong with the wrong pick.

What `--check` reports for this type:

- Errors: `DECISION` without `options[]` and `criteria[]`; an option or criterion without `id` or
  `name`, or a repeated id; a criterion with the id `cost` (that is the `DECISION.cost` row); a
  rating or cost for an option or criterion that isn't declared; a level other than
  `good`/`fair`/`poor`; a `recommend` that isn't an option id; a step's `matrix` naming an option
  or criterion that isn't declared.
- Warnings: fewer than 2 options; an empty cell; an empty `recommend`, or a `recommend` with no
  `why`; no step with `matrix.recommend`; `matrix` on a page of another type.
