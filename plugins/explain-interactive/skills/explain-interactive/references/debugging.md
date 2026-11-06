# Page type: `debugging`

Read this when the page explains why something broke and how that was found
(`META.type: "debugging"`). Example: `examples/cron-twice.content.js`.

The panel shows the phase (symptom → hypothesis → evidence → cause → fix), evidence blocks, and a
board of hypotheses ruled out or confirmed.

```js
const META = { type: "debugging", title, bigPicture };
const HYPOTHESES = [{ id: "retry", text: "The mail server retried a send" }, …];
// on a step:
phase: "evidence",                                      // symptom | hypothesis | evidence | cause | fix
verdicts: { retry: "ruled-out" },                       // open | ruled-out | confirmed
evidence: { label: "grep 'Nightly report' mail.log", text: `…` },
```

- Step 1 is the symptom (`phase: "symptom"`, with its `evidence`). Then the story runs in the order
  it was found: raise a hypothesis (`verdicts: { id: "open" }`), show evidence, rule it out or keep
  it, until one is `confirmed` at the `cause` step; then the `fix`.
- The board on each step lists the hypotheses raised so far with their current state; the ones this
  step changes are lit. A hypothesis not raised yet is not shown, so the page does not give the
  answer away. Raise every hypothesis in `HYPOTHESES` at some step.
- `evidence.text` is a log line, command output or code, ≤ 15 lines; `label` is the command or file
  it came from. Lines with `←` are highlighted. Use the real output from the conversation; never
  make it up. Its line width isn't checked: real output is quoted as it was.
- Include the wrong turns that were actually taken: they are where the reader learns how to rule
  things out.

What `--check` reports for this type:

- Errors: `HYPOTHESES` that isn't a list of `{ id, text }`, or repeats an id; an unknown `phase` or
  verdict; a verdict for a hypothesis that isn't declared; `evidence` without a `text` string.
- Warnings: no step with phase `symptom` or `cause`; a hypothesis no step raises; no step that
  confirms one; `evidence.text` over 15 lines; `phase` or `verdicts` on a page of another type.
