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
- `name-*` (regex on the content file, one per name): each project-specific name the case's
  `prompt.md` quotes has a `CAST` or `GLOSSARY` entry if the page uses it. See below.
- `reply-gives-path` (regex on the final reply): it names an `explanations/<topic>.html` path.

### Name graders

These replace `names-covered`, an `llm` grader whose votes split on near-identical pages (4 of 15
runs failed on each side of the #46 comparison). Each case has a hand-written list of the names its
prompt quotes, one `name-<slug>.md` per name. A grader passes when the name never appears in the
content file, or appears as a key inside the `CAST` or `GLOSSARY` object: so a name the page uses
without an entry fails. A mention in a body, or a key in another object (`DECISION`, a diagram)
doesn't count.

- Patterns allow optional quotes around the key, an optional `()`, and any case (`flags: i`;
  the regex grader's `flags` field takes JS RegExp flags, checked on Claude Code 2.1.319). `PATH` and `TZ` leave out `i`, since `path` is an
  ordinary word.
- Each name grader has `weight` 1/N, so a case's names together weigh 1, as the one judge did. A
  run's score is the passed weight over the total weight, and every other grader weighs 1; at the
  default weight, ten names would outweigh the rest of the case.
- A few names accept a broader key where the page explains the name through it: `acme/` may be
  dropped from a repo, `request.state` covers `request.state.user`, a table may be `jobs` or
  `jobs table`.
- Known limits: names a page brings in beyond the prompt aren't checked, and a key spelled outside
  the allowed variants fails a fine page. A name explained only in a `LAYERS` item or a step body
  still fails: the rule is a `CAST`/`GLOSSARY` entry, which is what the page's tooltips read. The `<dfn>` half of the old rule is left to `--check`,
  which warns about a `<dfn>` with no entry; the skill has the session fix every warning.
- **Upkeep: when a case's `prompt.md` changes, change its `name-*` list to match.**
  `test/eval-graders.test.mjs` runs every name grader on a saved good content file per case
  (`test/fixtures/evals/`) and checks it fails once its entry is removed; refresh the fixture when
  the prompt changes.

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

## Name graders (first run)

2026-11-06, Claude Code 2.1.319, default model, `--runs 1 -j 5 --ablation none`, plugin 0.3.0 with
the `name-*` graders in place of `names-covered`. Total cost $4.81.

| Case | Score | Names without an entry |
|---|---|---|
| before-after | 1.00 | none (`request.state.user` covered by a `request.state` entry) |
| concept | 0.96 | `bin/python`; `requirements.txt` (a `LAYERS` item only) |
| debugging | 1.00 | none |
| decision | 1.00 | none |
| walkthrough-whatif | 0.98 | `POST /payments` (named inside other entries only) |

- The harness accepted `flags` and `weight`. A missed name costs 1/N of the names' weight of 1:
  concept missed 2 of its 7 names, so (6 + 5/7) / 7 = 0.96.
- Scores are from the final patterns re-run on the saved pages; before-after first scored 0.99,
  until `request.state` was accepted as a variant. The saved pages, with the three missing entries
  added, are the fixtures in `test/fixtures/evals/`.

## Triggering (#49)

`trigger-eval.json` holds 32 requests for the description check: 16 that should load the skill and
16 near misses that shouldn't. The near misses reuse the description's own phrases on other jobs
("make it visual" for a revenue table, "present that as HTML" for a pricing table, "walk me through
it step by step" for a CI setup), plus charts, dashboards, Mermaid, slides, docs and landing pages.
The positives include requests that never say "interactive" or "HTML" ("something new hires can go
through at their own pace").

It is scored with the skill-creator description loop (`scripts/run_loop.py`; each query 3 times,
counted as triggered when 2 of 3 runs load the skill). Two things the stock scripts need here:

- Turn off the installed copy, or it competes with the copy under test: pass
  `--settings '{"enabledPlugins":{"explain-interactive@sergicastro-skills":false}}'` to `claude -p`.
- Give each query its own project directory. The script writes its temporary skill into a shared
  `.claude/commands/`, so parallel runs each see every other run's copy, pick one at random and
  count as misses. With the shared directory every description scored 8–25% recall.

2026-11-06, Claude Code 2.1.319, `claude-opus-5-5`, all 32 queries:

| Description | Correct runs | Queries passed | Misses |
|---|---|---|---|
| Before: "Use when the user finds an explanation hard to follow…" | 95 / 96 | 32 / 32 | one run of "present the explanation you just gave… as an HTML page" |
| Rewrite 1: explanation types first, follow-ups last | 91 / 96 | 30 / 32 | "present the explanation you just gave…" 0/3, "the memory leak you just traced…" 1/3 |
| **After** (rewrite 2, shipped) | **95 / 96** | **32 / 32** | one run |

- The old description already triggered on direct requests and stayed off the near misses, so the
  loop had nothing to improve (it stops when every query passes). The issue's guess that it missed
  direct asks didn't hold for this model.
- The new one ties on score and says what the skill is for (how something works, a choice, a
  change, a bug, a concept) and what it isn't for (charts, dashboards, decks, docs, landing pages).
- Rewrite 1 shows the risk: moving "turn an earlier answer into a page" to the end lost those
  requests. Keep that use first.
- No false triggers in any run; all errors were missed triggers.
