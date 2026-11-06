# Skill-behaviour evals

Eval cases for the `explain-interactive` skill, in the layout `claude plugin eval` reads: one
folder per case with `prompt.md` and `graders/*.md`. The tests in `test/` cover the build and the
engine; these check what Claude does with the skill: does it build a clean page of the right type,
with the parts every page needs.

Each prompt is a realistic request: a user quotes an explanation they couldn't follow and asks for
an interactive page. Every run builds a real page (node, headless Chrome, a cold-reader subagent).

## Cases

| Case | Page type asked for | Extra check |
|---|---|---|
| `walkthrough-whatif` | walkthrough (retried payment with an idempotency key) | has a `whatif` control |
| `decision` | decision (which job queue to use) | |
| `before-after` | before-after (a PR moving auth into middleware) | |
| `debugging` | debugging (a test failing only in CI) | |
| `concept` | concept (Python virtual environments for a frontend developer) | |

## Graders

Every case has:

- `skill-loaded` (`tool_used: Skill`, `arm: with-only`): did the skill fire. An indicator, not
  scored when a no-plugin baseline arm runs.
- `ran-check`: a Bash call ran `build.mjs --check`.
- `built-clean`: the built page exists. `build.mjs` writes nothing when the content has errors, so
  a page means `--check` found no errors.
- `page-type` (regex on the content file): `META.type` is the type the request calls for; for the
  walkthrough, no other type is set.
- `context-first-recap-last` (`llm`): step 1 has a `context` card, the last step is the Recap.
- `names-covered` (`llm`): every project-specific name used on the page is in `CAST`/`GLOSSARY`,
  and every `<dfn>` has an entry.
- `reply-gives-path` (regex on the final reply): it names an `explanations/<topic>.html` path.

### Why the prompts end with a harness note

Graders can only read files inside the run's working directory, and the skill writes to
`~/explanations/` (the run's HOME is its parent, so `..` is refused). Each prompt therefore ends with
a note asking the session to copy the content file and page to `./out/page.content.js` and
`./out/page.html`, and not to run `open`. That adds one copy step to the workflow; it is the same
in every run, so comparisons stay fair. `claude plugin eval` has no script grader, so the
`--check` result is read through `built-clean` rather than re-run.

## Running

From `plugins/explain-interactive/` (each run is a full Claude session on your credential, takes
3–6 minutes and costs about $1–2):

```bash
claude plugin eval . --runs 1 -j 5 --ablation none --allow-tools Bash Write Edit \
  --threshold 0 --max-cost-usd 30 --no-publish
claude plugin eval . --case decision --runs 3 --ablation none --allow-tools Bash Write Edit --no-publish
```

`--allow-tools Bash Write Edit` is required: the skill runs node and Chrome and writes files. A
no-plugin arm (`--ablation with-without`) isn't useful here: without the skill there is no
`build.mjs`, so every check but the type fails. Results go to `evals/results/<timestamp>/`, which is
git-ignored; `aggregate-result.json` has `costUsd`, `turns` and `durationSeconds` per run (no token
counts), which is the cost measure to compare.

## Baseline

2026-11-05, Claude Code 2.1.318, default model, `--runs 1 -j 5 --ablation none`, skill as of
plugin 0.2.1 (before #46). Total cost $6.05.

| Case | Score | Cost | Turns | Seconds |
|---|---|---|---|---|
| before-after | 1.00 | $0.85 | 11 | 174 |
| concept | 1.00 | $1.71 | 17 | 326 |
| debugging | 0.86 | $1.29 | 13 | 166 |
| decision | 1.00 | $0.88 | 8 | 186 |
| walkthrough-whatif | 1.00 | $1.32 | 13 | 225 |

- Overall score 0.97; the skill loaded and the page built cleanly in every run.
- The one fail: `debugging` `names-covered`, judge votes FAIL/PASS/FAIL. The judge flagged the
  content file as long (10.5k characters) and noisy for an `llm` grader, so this may be judge noise
  rather than a real gap; re-run with `--runs 3` before reading anything into it.
- To compare #46: run the same command on the new skill and compare score per case and `costUsd`.
  With one run per case the cost varies by tens of percent; use `--runs 3` for both sides.

## After #46 (SKILL.md split into `references/`)

2026-11-05, same Claude Code and model, `--runs 3 -j 5 --ablation none`, run back to back against
the skill before #46 (plugin 0.2.1) and after it.

| Case | Before: score / cost | After: score / cost |
|---|---|---|
| before-after | 1.00 / $2.98 | 1.00 / $3.30 |
| concept | 0.90 / $3.47 | 0.86 / $3.39 |
| debugging | 1.00 / $3.45 | 0.95 / $2.64 |
| decision | 0.95 / $4.43 | 0.95 / $3.84 |
| walkthrough-whatif | 0.96 / $3.61 | 1.00 / $3.25 |
| **All 15 runs** | **0.96 / $17.93** | **0.95 / $16.42** |

- Cost is 8% lower; turns went up (168 → 199), mostly from reading the reference files.
- `names-covered` failed 4 of 15 runs before and 4 of 15 after (in different cases), and 2 more in
  a rerun of `decision`: the judge's votes split on near-identical pages, so read it as noise.
- The one other fail: a `decision` run whose final reply named no path. A rerun of `decision`
  (3 runs, $3.38) had the path in every reply.
