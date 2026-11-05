---
description: "Worker after /compact, manager not named again: finds it from context"
tags: [worker, new, setup]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

If the `orchestrator-worker` skill is available, load it with the Skill tool and follow it. You are a Claude Code session named `demo-w-a` (first `ListAgents` line: "This session is demo-w-a"). Its context was compacted; the summary still holds this earlier message from `demo-manager`:
```
[orch v1 ACK]
epic: demo
re: DONE g1 → in-review
```
The user types "/orchestrator-worker" with no manager name. `~/.claude-orchestrator/demo/state.json` has `"manager": "demo-manager"` and `"worker_prefix": "demo-w-"`.

This is a simulation: no other sessions, no GitHub and no orchestration state exist here, so do NOT run Bash, SendMessage or any tool that would message a session, touch GitHub or write state. You may load skills and read files. Then answer: list, in order, the exact tool calls you would make (tool name and full arguments, including the full text of every message you would send), and then exactly what you would tell the user.
