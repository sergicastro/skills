# claude-orchestrator

A pair of Claude Code skills that coordinate several user-created Claude sessions
working on related goals from one epic or task list:

- `orchestrator` — the manager session: plans goals and dependencies, keeps the
  state file, and hands out goals when workers ask for them.
- `orchestrator-worker` — a worker session: registers with the manager, asks for a
  goal when the user says so, works it, and reports back.

See `docs/specs/` for the design.
