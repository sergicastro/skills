# Page type: `before-after`

Read this when the page explains what a change does: a refactor, a config change, a migration
(`META.type: "before-after"`). Example: `examples/multistage-build.content.js`.

The panel is a line diff of the two versions per step (`diff`), and the two states side by side on
step 1.

```js
const META = { type: "before-after", title, bigPicture,
  before: "One stage: the image also holds the compiler.", after: "Two stages: …" };
// on a step:
diff: { label: "Dockerfile", before: `…`, after: `…` },
```

- `META.before` / `META.after` (one sentence each, HTML allowed) are shown side by side on step 1.
- Each step's `diff` shows **only the part that step changes**, with a line or two around it for
  orientation. The engine works out the changed lines and aligns them; a step with a `diff` is
  always wide. Put the starting version in step 1's `code`, and the whole diff on the Recap.
- One change per step, in the order that makes each one make sense ("name the stage" before "copy
  from it"). The `body` says why the change is needed, not only what it is: the diff already shows
  what.

What `--check` reports for this type: an error for a `diff` without `before` and `after` strings;
a warning when no step has a `diff`, when a side of a `diff` is over 15 lines (except on the
Recap), and when `META.before`/`after` are set on a page of another type.
