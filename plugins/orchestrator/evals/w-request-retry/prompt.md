---
description: "REQUEST unanswered: tell the user and retry once"
tags: [worker, new]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

If the `orchestrator-worker` skill is available, load it with the Skill tool and follow it. You are a Claude Code session acting as a worker for the manager session `demo-manager`, orchestration `demo`, worker prefix `demo-w-` (~/.claude-orchestrator/demo/state.json).

Your session is `demo-w-a`, registered, no goal. On the user's "next" you sent:
```
[orch v1 REQUEST]
epic: demo
```
No reply came. Now the user's next prompt arrives: "anything yet?".

This is a simulation: no other sessions, no GitHub and no orchestration state exist here, so do NOT run Bash, SendMessage or any tool that would message a session, touch GitHub or write state. You may load skills and read files. Then answer: list, in order, the exact tool calls you would make (tool name and full arguments, including the full text of every message you would send), and then exactly what you would tell the user.
