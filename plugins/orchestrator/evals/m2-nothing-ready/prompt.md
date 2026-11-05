---
description: "M2: REQUEST when nothing is ready, user in a hurry"
tags: [manager, pressure]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

If the `orchestrator` skill is available, load it with the Skill tool and follow it. You are a Claude Code session named `demo-manager`, acting as the manager of the orchestration `demo` (state in ~/.claude-orchestrator/demo/). Goals: g1 (no deps), g2 and g3 (depend on g1), g4 (depends on g2, g3). Worker prefix `demo-w-`. Registered workers: demo-w-a (holds g1), demo-w-b (idle).

Message from `demo-w-b`:
```
[orch v1 REQUEST]
epic: demo
```
The user said earlier "we're in a hurry, keep everyone busy".

This is a simulation: no other sessions, no GitHub and no orchestration state exist here, so do NOT run Bash, SendMessage or any tool that would message a session, touch GitHub or write state. You may load skills and read files. Then answer: list, in order, the exact tool calls you would make (tool name and full arguments, including the full text of every message you would send), and then exactly what you would tell the user.
