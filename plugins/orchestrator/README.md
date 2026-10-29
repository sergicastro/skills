# orchestrator

A pair of Claude Code skills that coordinate several user-created Claude sessions
working on related goals from one epic or task list:

- `orchestrator` — the manager session: plans goals and dependencies, keeps the
  state file, and hands out goals when workers ask for them.
- `orchestrator-worker` — a worker session: registers with the manager, asks for a
  goal when the user says so, works it, and reports back.

The manager can also propose a change notice to the affected workers when a goal changes
or a merged goal settles a design question. It sends the notice only after the user approves;
workers acknowledge it and change course only on the user's say-so.

## Goals

- **Easy issue management with concurrent work.** One manager session keeps the
  plan, dependencies and progress for an epic, while several worker sessions take
  goals in parallel and the user reviews each one on its own.
- **Save tokens compared with one session owning every issue.** Each worker's
  context holds only its own goal and a short upstream summary, and the manager
  never sees code, diffs or logs, so no session carries the whole epic's history.

## Layout

- `skills/orchestrator/`: manager skill, plus `scripts/orch_state.py` (state helper)
- `skills/orchestrator-worker/`: worker skill
- `shared/`: `protocol.md` and `github.md`, symlinked into both skills
- `tests/`: helper unit tests, skill pressure scenarios, a dry-run demo epic

## Install

In Claude Code:

    /plugin install orchestrator --marketplace sergicastro/skills

On Claude Code older than 2.1.275, add the marketplace first:

    /plugin marketplace add sergicastro/skills
    /plugin install orchestrator@sergicastro-skills

To work on the skills, run Claude Code with the local copy instead:
`claude --plugin-dir plugins/orchestrator` from the repo root.

## Use

1. Open a manager session (e.g. `claude -n <name>-manager`; the manager suggests a `/rename` if needed) and run `/orchestrator <epic URL, issue list or text>`.
   Review the plan and reply "go".
2. Open worker sessions named with the prefix the manager gives (`claude -n <slug>-w-<anything>`)
   and run `/orchestrator-worker <manager name>` in each.
3. In a worker, say "next" to get a goal. When it reports done, review the work and, in the manager session, type
   `approve <goal>` (or `send <goal> back`). Then say "next" in the worker again.
4. Ask the manager "status" at any time. Plans change: ask it to add, drop or edit a goal
   (title, summary, acceptance criteria, dependencies…) or to rename the epic, and the
   status page follows. State lives in `~/.claude-orchestrator/<slug>/`
   (`status.md` is the readable view; the manager also gives you a live page).
5. Once every goal is approved, the manager suggests a cleanup. Say "cleanup" and pick
   what to do: delete the state directory, stop the status server (if no other
   orchestration is left), and tell the workers they can end their sessions.

## Live status page

The manager starts a small local server the first time you create or resume an
orchestration, and gives you its URL (default `http://127.0.0.1:8765/`). The index lists
every orchestration; each one has a page with its dependency graph, goals, workers and
recent events, updated within a second of each change.

![Epic page: dependency graph, goals, workers and recent events](docs/images/status-epic-light.png)

<details>
<summary>Dark mode and the index page</summary>

![Epic page in dark mode](docs/images/status-epic-dark.png)

![Index of all orchestrations](docs/images/status-index.png)

</details>

The screenshots use made-up data.

    python3 plugins/orchestrator/skills/orchestrator/scripts/orch_state.py serve --ensure   # start if needed
    python3 plugins/orchestrator/skills/orchestrator/scripts/orch_state.py serve --stop     # stop it

Without the server, open `~/.claude-orchestrator/<slug>/status.html`; it reloads every
3 seconds.

## Tests

From `plugins/orchestrator/`:

```bash
python3 -m unittest discover -s tests -v
```

See `docs/specs/` for the design.

## License

MIT. See [LICENSE](../../LICENSE).
