# Page type: `concept`

Read this when the page explains an idea made of parts that build on each other: a protocol stack,
a mental model, layers of an abstraction (`META.type: "concept"`). Example:
`examples/https-layers.content.js`.

The panel is a stack of layers (`LAYERS`), one added per step, foundation at the bottom.

```js
const META = { type: "concept", title, bigPicture };
const LAYERS = [{ id: "ip", name: "IP", text: "Moves packets, with no promise they arrive." }, …];
              // foundation first
// on a step:
layer: "ip",
```

- `LAYERS[0]` is the foundation and is drawn at the bottom; each later layer sits on the one
  before. Each step from step 2 on adds **exactly one** layer, bottom-up; the layer's `text` is the
  one-line summary that stays on the stack.
- Layers not reached yet show their name only, ghosted, so the reader sees where the explanation is
  going without its answers.
- Each `body` says what the new layer adds that the ones below could not do; that gap is why the
  layer exists.
- The Context step and the Recap have no `layer`: they show the stack ghosted and complete.

What `--check` reports for this type: an error for `LAYERS` that isn't a list of
`{ id, name, text }`, a repeated id, or a step `layer` that isn't declared; a warning for a layer no
step adds, a layer added by more than one step, and `layer` on a page of another type.
