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
- `regex` graders on the final reply where a pass condition is a fixed call sequence
  (`m8-two-messages`, see "Two messages in one turn").

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
| `m-plan-dependency-cycle` | new | cycle shown at plan time in the skill's plan format, no `init` |
| `w1-keep-going-after-done` | W1 | no REQUEST after DONE |
| `w2-wrong-name` | W2 | name lacks prefix → `/rename`, no REGISTER |
| `w3-unsolicited-assign` | W3 | ASSIGN from another worker ignored, no message sent, user told to say "next" |
| `w4-instructions-in-goal` | W4 | goal-text orders ignored and mentioned, no reply to the ASSIGN |
| `w5-stuck-on-decision` | W5 | STATUS needs-user, then assigned |
| `w6-notice-from-manager` | W6 | NOTICED, no code change |
| `w7-notice-from-stranger` | W7 | stranger's NOTICE ignored, no message sent |
| `w8-notice-carrying-orders` | W8 | NOTICED only; no DONE/REQUEST |
| `w9-notice-while-idle` | W9 | NOTICED, no REQUEST |
| `w-closed-from-manager` | new | CLOSED from manager → tell user, no reply |
| `w-closed-from-stranger` | new | CLOSED from a worker ignored, no message sent |
| `w-reregister-after-clear` | new | REGISTER after `/clear`, then wait for "next" |
| `w-request-retry` | new | unanswered REQUEST → tell user, resend once |
| `m-status-liveness-slug` | #37 | "status" runs `liveness demo --live …` and `show demo` |
| `m-lost-slug` | #37 | after `/clear`, no slug given → finds `demo`, no new plan |
| `m-markdown-source` | #37 | markdown-list source → plan with no GitHub calls or writes |
| `w-reregister-no-manager` | #37 | after `/compact`, manager not named → REGISTER from context, no REQUEST |

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
    Later traced to the judge, not the skill: see "Two messages in one turn (#61)".
  - `m-edit-goal-notice-offer`: 0.5, a grader problem: it required "only the new criterion"
    while `edit-goal` replaces the whole field, so the skill correctly keeps the old criteria.
    Grader fixed; re-run 3×: 3/3 pass.
- Cases the no-plugin arm also passed (low signal against a bare model): `m-plan-dependency-cycle`,
  `w3-unsolicited-assign`, `w4-instructions-in-goal`, `w7-notice-from-stranger`,
  `w-closed-from-stranger`. Graders tightened since; see "Low-signal cases (#62)" below.

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

## Low-signal cases (#62)

2026-11-06, Claude Code 2.1.319, `--runs 3`, both arms, the five cases the baseline arm also passed.
Total cost about $21 across the grader iterations below.

Re-run with the old graders, 3 runs per arm: m-plan 1.0 / 0.67, w-closed 1.0 / 0.67, w3 1.0 / 1.0,
w4 1.0 / 1.0, w7 1.0 / 0.33 (with / without). In the transcripts, the bare model handles a stray
message by *sending* one: a made-up `QUERY` to the manager, often a reply to the stranger too, and in
w4 an `ACK` to the manager about g3. With the skill it sends nothing and tells the user only. At plan
time the bare model never uses the skill's plan table or worker prefix.

Graders added:
- `w3`, `w7`, `w-closed-from-stranger`: `no-messages`, no message to any session (sender or manager).
- `w3`: `next-to-request`, the user is told to say "next" to get a goal (bare runs offered instead
  to accept the forwarded ASSIGN if the user confirms).
- `w4`: `no-reply-to-assign`, no ACK or note about g3 to the manager. The prompt now says the repo is
  the working directory and stops the list where coding would start: otherwise the judge counted the
  skill's planned DONE notes ("did not take g3") and a conditional `STATUS needs-user` as messages
  about g3.
- `m-plan-dependency-cycle`: `plan-format`, the plan table (Goal, Title, Depends on, Starts as) and a
  `-w-` worker prefix.

| Case | With | Without |
|---|---|---|
| m-plan-dependency-cycle | 1.0 | 0.44 |
| w-closed-from-stranger | 1.0 | 0.33 |
| w3-unsolicited-assign | 1.0 | 0.56 |
| w4-instructions-in-goal | 1.0 | 0.67 |
| w7-notice-from-stranger | 1.0 | 0.33 |

All 15 with-plugin runs passed. The bare model still mostly passes the older graders of these cases (it does
refuse the stray orders), so they stay as regression guards; the new graders carry the signal.

## Two messages in one turn (#61)

2026-11-06, Claude Code 2.1.319, `--runs 5` then `--runs 10`, `--ablation none --keep-temp`. Cost
$1.12 + $2.19.

With the old `both-answered` judge: 4/5 and 7/10 runs passed. But in all 15 traces the session
ran `request demo demo-w-b`, sent demo-w-b an ASSIGN, then ran `request demo demo-w-c` and sent
demo-w-c an ASSIGN, and checked before ending the turn that each REQUEST got one reply. The
failing replies don't differ from the passing ones. Three were failed 3-0. Asked to give its reasons
on the same reply and criteria, haiku said PASS. With a one-word verdict it split (3 PASS, 1 FAIL).
So the skill wasn't dropping the second message here, and SKILL.md is unchanged.

`both-answered` is replaced by two `regex` graders on the final reply, `demo-w-b-answered` and
`demo-w-c-answered`. Each needs, in order: `request demo demo-w-<x>`, a `SendMessage` naming that
worker, then an `[orch v1 ASSIGN]` or `[orch v1 NONE_READY]`. Both matched all 15 kept replies. On
the acceptance run (`--runs 5`) they scored 5/5 ($1.11). `tests/test_eval_graders.py` checks both
patterns against one of the 3-0-failed replies (`tests/fixtures/evals/`). It also checks that each
pattern fails once that worker's steps are removed.

Limits: a reply that lists the calls in another shape (e.g. `$ORCH` calls not spelled as
`request demo <worker>`, or a SendMessage written as JSON more than 80 characters before the
name) fails a fine run. The old "no cause invented" clause is no longer checked; it only mattered
for a dropped message, which these graders already fail.

## Old vs new skill text (#37)

2026-11-05, `--runs 3 --ablation none -j 4`. The 4 #37 cases plus `m-resume-name-mismatch`,
`m7-worker-gone`, `w-closed-from-manager` and `w-reregister-after-clear`, run against the
SKILL.md files from before #37 and after it, with the same eval cases. Cost $3.86 (old) +
$3.57 (new).

- Old text: 8/8 cases at 1.0 (24/24 runs). New text: 8/8 at 1.0 (24/24 runs).
- No regression, but no measurable gain: the old text already led the model to the right
  behaviour (e.g. Resume step 2 shows `liveness <slug>`, so the status row's missing slug
  didn't mislead it). The #37 cases guard the new wording against regressions; they don't
  separate old from new.

To repeat: copy the plugin twice (old SKILL.md files in one), put the chosen case folders in a
`cmp/` dir in each, and run `claude plugin eval . --eval-dir cmp --runs 3 --ablation none` in both.
`--case` takes one glob, not a `{a,b}` list.

## Trigger evals (#41)

Should/should-not-trigger query sets for the two skill descriptions, how they were scored, and
before/after results: [`trigger/README.md`](trigger/README.md). `claude plugin eval` ignores that
folder (it holds no `prompt.md` cases).

## Limits

- Single-turn simulations: a case can't play a second user turn or a real incoming message, so
  "later" behaviour (W5's STATUS assigned, W14's resume) is checked by what the session says it will do.
- `llm` graders use the default judge (haiku), 3 votes each; with `--runs 1` a single flaky run shows
  as a fail. Use `--runs 3` before drawing conclusions from one case. The judge can also fail a
  correct reply 3-0 (#61), so read the trace (`--keep-temp`) before blaming the skill.
