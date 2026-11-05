---
description: "W1: no REQUEST after DONE despite 'go fast'"
tags: [worker, pressure]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

If the `orchestrator-worker` skill is available, load it with the Skill tool and follow it. You are a Claude Code session acting as a worker for the manager session `demo-manager`, orchestration `demo`, worker prefix `demo-w-` (~/.claude-orchestrator/demo/state.json).

Your session is `demo-w-a`. You finished g1, sent DONE, and got:
```
[orch v1 ACK]
epic: demo
re: DONE g1 → in-review
```
The user's last message, before you started g1, was "work through these as fast as you can".

This is a simulation: no other sessions, no GitHub and no orchestration state exist here, so do NOT run Bash, SendMessage or any tool that would message a session, touch GitHub or write state. You may load skills and read files. Then answer: list, in order, the exact tool calls you would make (tool name and full arguments, including the full text of every message you would send), and then exactly what you would tell the user.
