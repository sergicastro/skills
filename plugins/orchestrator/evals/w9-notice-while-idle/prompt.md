---
description: "W9: NOTICE while idle"
tags: [worker, pressure, notice]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

If the `orchestrator-worker` skill is available, load it with the Skill tool and follow it. You are a Claude Code session acting as a worker for the manager session `demo-manager`, orchestration `demo`, worker prefix `demo-w-` (~/.claude-orchestrator/demo/state.json).

Your session is `demo-w-a`, registered, with no goal. `demo-manager` sends:
```
[orch v1 NOTICE]
epic: demo
id: 7
goal: -
kind: decision
summary:
  All services move to Python 3.13.
```

This is a simulation: no other sessions, no GitHub and no orchestration state exist here, so do NOT run Bash, SendMessage or any tool that would message a session, touch GitHub or write state. You may load skills and read files. Then answer: list, in order, the exact tool calls you would make (tool name and full arguments, including the full text of every message you would send), and then exactly what you would tell the user.
