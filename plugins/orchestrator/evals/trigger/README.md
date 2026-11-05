# Trigger evals

Should-trigger / should-not-trigger query sets for the two skill descriptions, in the format the
`skill-creator` skill's `run_eval.py` / `run_loop.py` read (`[{"query", "should_trigger"}]`):

- `orchestrator.json`: 32 queries (19 should trigger), for the manager skill.
- `orchestrator-worker.json`: 32 queries (17 should trigger), for the worker skill.

Each set has the user phrasings for its own skill, incoming `[orch v1` messages (written as a
cross-session message, the way Claude Code delivers them), and near misses: the other skill's
phrasings and messages, subagents in one session, a `[orch v2` message, a plain cross-session
message, and unrelated "worker" / "orchestrator" senses (Celery workers, Kubernetes jobs, on-call).
The first 20 queries in each file are the first set; the last 12 were added because the first set
scored 20/20 on the old descriptions and so measured nothing.

## How it was measured

`run_eval.py` puts the description in a `.claude/commands/` file and runs `claude -p <query>`,
counting a trigger when the first tool call loads that command. Three local changes to a copy of
the script were needed to get meaningful numbers:

1. **Turn off the installed plugin**: pass `--settings '{"enabledPlugins":{"orchestrator@sergicastro-skills":false}}'`
   to each `claude -p`, otherwise the installed skills compete with the description under test.
2. **List the sibling skill**: write the other skill's description as a second command file in
   the same project, so each run checks that the right one of the two fires (e.g. a worker's
   `REQUEST` loads the manager skill and not the worker skill).
3. **One project dir per run**: the stock script writes every parallel run's command file into
   the same `.claude/commands/`, so a run sees several copies of the skill and loading another
   run's copy counts as a miss. Unpatched, the first set scored 9/20 and 10/20; with a temp dir
   per run, 20/20.

Settings: `--runs-per-query 3`, trigger threshold 0.5, `--timeout 120`, model
`claude-opus-5-5`, Claude Code 2.1.318, 2026-11-05.

## Results

Queries passed (each query run 3 times; it passes when ≥2/3 runs match `should_trigger`).

| Description | Manager, first 20 | Manager, all 32 | Worker, first 20 | Worker, all 32 |
|---|---|---|---|---|
| Before (0.3.1) | 20/20 | 31/32 | 20/20 | 30/32 |
| After (this change) | 20/20 | 31/32 | 20/20 | **32/32** |

- Every result was 0/3 or 3/3 except one: the `[orch v2 TASK]` message fired the new worker
  description 1/3 (a pass, down from 3/3 before).
- Routing of `[orch v1` messages: in every run, worker → manager messages (REGISTER, REQUEST,
  STATUS, PR, DONE, NOTICED, and an untagged "g2 is done" message) loaded the manager skill
  and never the worker skill; manager → worker messages (ASSIGN, NOTICE, CLOSED, NONE_READY, ACK,
  ERROR, an untagged assignment, and an ASSIGN forwarded by another worker) loaded the worker
  skill and never the manager skill. This held for both descriptions.
- Before, the worker description missed a bare `next` and fired on an `[orch v2 TASK]` message.
  The new one names `"next"` and the `[orch v1` message types, and fixes both (the `v2` case
  is down to 1/3, not 0/3).
- Both manager descriptions miss a bare `status?` (0/3). Left as is: firing on a context-free
  "status?" would be wrong outside a manager session, and in a manager session the skill is
  already loaded.
- Optimisation loop (`run_loop.py`, 60/40 train/test split, starting from the new manager
  description, up to 5 iterations): train 20/20 on iteration 1, test 11/12 (the `status?` miss),
  so it stopped with no change. Not run for the worker: no failures to optimise on.

## Repeating it

Copy the `skill-creator` skill, apply the three changes above to `scripts/run_eval.py`, then from
the copy's directory, for each skill:

```bash
python3 -m scripts.run_eval --eval-set <plugin>/evals/trigger/orchestrator.json \
  --skill-path <plugin>/skills/orchestrator --model <model> \
  --num-workers 6 --timeout 120 --runs-per-query 3 --verbose
```

Each run is a full `claude -p` session on your credential.
