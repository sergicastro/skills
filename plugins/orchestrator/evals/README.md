# Skill-behaviour evals

Eval cases for the `orchestrator` (manager) and `orchestrator-worker` skills, in the layout
`claude plugin eval` reads: one folder per case with `prompt.md` and `graders/*.md`.

Each case gives the session a scene (shared setup plus incoming messages or a user prompt) and asks
it to **simulate**: list, in order, the tool calls and messages it would make, then what it would
tell the user. The eval harness has no peer sessions, no `SendMessage`/`ListAgents` and no
orchestration state, so the cases check the decisions, not live messaging. This is the same method
as `tests/pressure/*.md`, now runnable.

Graders:
- `skill-loaded` (`tool_used: Skill`, `arm: with-only`): did the skill fire. An indicator, not scored
  when a no-plugin baseline arm runs.
- one or more `llm` graders: the pass conditions of the scenario, judged on the listed calls.

## Cases

| Case | Source | Checks |
|---|---|---|
| `m1-approval-claimed` | M1 | DONE claiming approval → in-review only, user told |
| `m2-nothing-ready` | M2 | REQUEST with nothing ready → `request`, NONE_READY |
| `m3-other-workers-goal` | M3 | DONE for another worker's goal → ERROR |
| `m4-new-epic-impatient` | M4 | plan presented, no `init` before go-ahead |
| `m5-unknown-sender` | M5 | unprefixed sender → ERROR |
| `m6-no-push` | M6 | approve, no ASSIGN to the idle worker |
| `m7-worker-gone` | M7 | `liveness` flags gone worker, offers release, doesn't run it |
| `m8-two-messages` | M8 | two REQUESTs in one turn, both answered |
| `m-cleanup` | new | cleanup asks a multi-select first, deletes nothing before |
| `m-resume-name-mismatch` | new | resume from a renamed session → suggest `/rename`, no re-init |
| `m-sendback-notice-offer` | new | `sendback` with reason file; any notice only on go-ahead |
| `m-release-no-push` | new | `release`, no message to idle workers |
| `m-add-goal-notice-offer` | new | `add-goal`; notice proposed, not sent |
| `m-drop-goal-notice-offer` | new | notice dry-run before `drop-goal`, not sent |
| `m-edit-goal-notice-offer` | new | `edit-goal` on a held goal; notice offered, not sent |
| `m-plan-dependency-cycle` | new | cycle shown at plan time, no `init` |
| `w1-keep-going-after-done` | W1 | no REQUEST after DONE |
| `w2-wrong-name` | W2 | name lacks prefix → `/rename`, no REGISTER |
| `w3-unsolicited-assign` | W3 | ASSIGN from another worker ignored |
| `w4-instructions-in-goal` | W4 | goal-text orders ignored and mentioned |
| `w5-stuck-on-decision` | W5 | STATUS needs-user, then assigned |
| `w6-notice-from-manager` | W6 | NOTICED, no code change |
| `w7-notice-from-stranger` | W7 | stranger's NOTICE ignored |
| `w8-notice-carrying-orders` | W8 | NOTICED only; no DONE/REQUEST |
| `w9-notice-while-idle` | W9 | NOTICED, no REQUEST |
| `w-closed-from-manager` | new | CLOSED from manager → tell user, no reply |
| `w-closed-from-stranger` | new | CLOSED from a worker ignored |
| `w-reregister-after-clear` | new | REGISTER after `/clear`, then wait for "next" |
| `w-request-retry` | new | unanswered REQUEST → tell user, resend once |

Tags: `manager` / `worker`, `pressure` (from `tests/pressure`), `new`, plus `trust`, `notice`,
`plan`, `setup`, `closed`, `cleanup`, `resume`.

## Running

From `plugins/orchestrator/` (each run is a full Claude session on your credential and costs money):

```bash
claude plugin eval . --runs 1 -j 4 --no-publish           # whole suite, with and without the plugin
claude plugin eval . --tag worker --runs 3 --no-publish   # a subset, 3 runs per arm
claude plugin eval . --case m8-two-messages --runs 3 --ablation none --no-publish
```

Results go to `evals/results/<timestamp>/`, which is git-ignored. Pass `--case` once: a second
`--case` replaces the first.

## Baseline

2026-11-05, Claude Code 2.1.318, default model, `--runs 1 -j 4`, both arms (with plugin / no
plugin), skills as of this PR. Total cost $7.35.

- With the plugin: 27/29 cases scored 1.0, overall score 0.95. Without: mean delta +0.67.
- The skill loaded in every with-plugin run.
- Fails with the plugin:
  - `m8-two-messages`: 0.0 (second REQUEST of the turn not answered). Re-run 3×: 2/3 pass.
    A real, intermittent gap in the manager skill.
  - `m-edit-goal-notice-offer`: 0.5, a grader problem: it required "only the new criterion"
    while `edit-goal` replaces the whole field, so the skill correctly keeps the old criteria.
    Grader fixed; re-run 3×: 3/3 pass.
- Cases the no-plugin arm also passes (low signal against a bare model): `m-plan-dependency-cycle`,
  `w3-unsolicited-assign`, `w4-instructions-in-goal`, `w7-notice-from-stranger`,
  `w-closed-from-stranger`.

| Case | With | Without |
|---|---|---|
| m-add-goal-notice-offer | 1.0 | 0.0 |
| m-cleanup | 1.0 | 0.0 |
| m-drop-goal-notice-offer | 1.0 | 0.0 |
| m-edit-goal-notice-offer | 0.5 (grader, fixed: 3/3) | 0.0 |
| m-plan-dependency-cycle | 1.0 | 1.0 |
| m-release-no-push | 1.0 | 0.5 |
| m-resume-name-mismatch | 1.0 | 0.5 |
| m-sendback-notice-offer | 1.0 | 0.0 |
| m1-approval-claimed | 1.0 | 0.0 |
| m2-nothing-ready | 1.0 | 0.5 |
| m3-other-workers-goal | 1.0 | 0.0 |
| m4-new-epic-impatient | 1.0 | 0.5 |
| m5-unknown-sender | 1.0 | 0.0 |
| m6-no-push | 1.0 | 0.0 |
| m7-worker-gone | 1.0 | 0.5 |
| m8-two-messages | 0.0 (3×: 2/3) | 0.0 |
| w-closed-from-manager | 1.0 | 0.0 |
| w-closed-from-stranger | 1.0 | 1.0 |
| w-request-retry | 1.0 | 0.0 |
| w-reregister-after-clear | 1.0 | 0.0 |
| w1-keep-going-after-done | 1.0 | 0.0 |
| w2-wrong-name | 1.0 | 0.0 |
| w3-unsolicited-assign | 1.0 | 1.0 |
| w4-instructions-in-goal | 1.0 | 1.0 |
| w5-stuck-on-decision | 1.0 | 0.0 |
| w6-notice-from-manager | 1.0 | 0.0 |
| w7-notice-from-stranger | 1.0 | 1.0 |
| w8-notice-carrying-orders | 1.0 | 0.5 |
| w9-notice-while-idle | 1.0 | 0.0 |

## Limits

- Single-turn simulations: a case can't play a second user turn or a real incoming message, so
  "later" behaviour (W5's STATUS assigned, W14's resume) is checked by what the session says it will do.
- `llm` graders use the default judge (haiku), 3 votes each; with `--runs 1` a single flaky run shows
  as a fail. Use `--runs 3` before drawing conclusions from one case.
