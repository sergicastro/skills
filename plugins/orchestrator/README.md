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
Workers report each PR as soon as they open it, so the status page lists a goal's PRs while it is still in progress.
GitHub issue and PR references in a goal's title or reason (`#123`, `owner/repo#123`, or a full URL) are links on the status page; a bare `#123` uses the goal's repo, or the epic's when the goal has none.
Each PR a worker opens ends with a small footer naming the worker, epic and goal, so you can tell who opened it from the PR alone.

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
   `approve <goal>` (or `send <goal> back`). After an approval the manager suggests resetting
   that worker's context (`/clear`, then `/orchestrator-worker <manager name>` again), since the
   next goal arrives with everything it needs. Then say "next" in the worker again.
4. Ask the manager "status" at any time. Plans change: ask it to add, drop or edit a goal
   (title, summary, acceptance criteria, dependencies…) or to rename the epic, and the
   status page follows. State lives in `~/.claude-orchestrator/<slug>/`
   (`status.md` is the readable view; the manager also gives you a live page).
5. Once every goal is approved, the manager suggests a cleanup. Say "cleanup" and pick
   what to do: delete the state directory, stop the status server (if no other
   orchestration is left), and tell the workers they can end their sessions.

## Goal lifecycle

```mermaid
stateDiagram-v2
    state "needs-user" as needs_user
    state "in-review" as in_review

    [*] --> blocked: goal added
    blocked --> ready: dependencies met, or user says "start now"
    ready --> assigned: worker says "next"
    assigned --> needs_user: worker reports needs-user or blocked
    needs_user --> assigned: worker resumes
    assigned --> in_review: worker reports DONE
    in_review --> done: user says "approve"
    in_review --> assigned: user says "send back"
    assigned --> blocked: user says "release"
    needs_user --> blocked: user says "release"
    in_review --> blocked: user says "release"
    done --> [*]

    classDef blocked fill:#ececea,stroke:#8a8a85,color:#1f1f1f
    classDef ready fill:#e3edfc,stroke:#2f6fdb,color:#1f1f1f
    classDef assigned fill:#fbf0dc,stroke:#b7791f,color:#1f1f1f
    classDef needsUser fill:#fbe4e4,stroke:#d14343,color:#1f1f1f
    classDef inReview fill:#efe7fb,stroke:#7c4dcc,color:#1f1f1f
    classDef done fill:#e2f3e7,stroke:#2f8f4e,color:#1f1f1f
    class blocked blocked
    class ready ready
    class assigned assigned
    class needs_user needsUser
    class in_review inReview
    class done done
```

The diagram and the table use the same colors as the status page.

| Status | Meaning | Leaves it when |
| --- | --- | --- |
| ⚪ `blocked` | Waiting on dependencies | Every dependency is `done` (or `in-review`, see below), or you say `start <goal> now` → `ready` |
| 🔵 `ready` | Can be handed out | A worker says "next" and gets it → `assigned` |
| 🟠 `assigned` | A worker is on it | The worker needs you → `needs-user`; it reports DONE → `in-review` |
| 🔴 `needs-user` | The worker is waiting on you, with a reason (a worker reporting "blocked" lands here too, with a `blocked:` reason) | The worker resumes → `assigned` |
| 🟣 `in-review` | Work is done and waits for your review | `approve <goal>` → `done`; `send <goal> back` → `assigned` (same worker) |
| 🟢 `done` | Approved | Final |

- `release <goal>` takes a goal off its worker (gone, or you want someone else on it) from
  `assigned`, `needs-user` or `in-review`. It passes through `blocked` and goes straight on
  to `ready` if its dependencies are still met.
- By default a goal's dependents unblock only when it is `done`. Ask the manager to unblock
  on review and they start once it reaches `in-review`.
- Opening a PR never changes a goal's status.
- Only `blocked` or `ready` goals can be dropped, and only when nothing depends on them.

## Live status page

The manager starts a small local server the first time you create or resume an
orchestration, and gives you its URL (default `http://127.0.0.1:8765/`). The index lists
every orchestration; each one has a page with its dependency graph, goals, workers and
recent events, updated within a second of each change.

A worker reports each PR as soon as it opens it, so the PR column fills in while the goal
is still in progress, and a goal can list several PRs. A bullet after each PR link shows
its health, read from GitHub with the `gh` CLI every minute or so:

- green: ready to merge (checks pass, no review blocking it)
- yellow: waiting (a draft, checks running, or a review required)
- red: needs action (a check failed, changes requested, a merge conflict, or closed unmerged)
- purple: merged
- grey: unknown (`gh` missing, not logged in, offline, or not a GitHub PR)

Hover a bullet for the reason. Set `ORCH_PR_STATUS=off` to skip the GitHub calls; every
bullet is then grey. The server reads it at startup, so set it before the server starts or
restart it (`orch_state.py serve --stop`, then `--ensure`). `status.md` and the static `status.html` have no bullets.

![Epic page: dependency graph, goals, workers and recent events, with PRs gaining health bullets](docs/images/status-pr-bullets.gif)

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
