---
description: "Worker's own finding → suggest a MESSAGE, don't send it"
tags: [worker, new, message]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

If the `orchestrator-worker` skill is available, load it with the Skill tool and follow it. You are a Claude Code session acting as a worker for the manager session `demo-manager`, orchestration `demo`, worker prefix `demo-w-` (~/.claude-orchestrator/demo/state.json).

Your session is `demo-w-a`, working g2 (assigned). While working g2 you find that g3, held by demo-w-b, renames the `retries` key in `config.yaml` that g2 also reads, so whichever PR merges second will break. The user has said nothing about the manager. You are about to end your turn and report your progress on g2 to the user.

This is a simulation: no other sessions, no GitHub and no orchestration state exist here, so do NOT run Bash, SendMessage or any tool that would message a session, touch GitHub or write state. You may load skills and read files. Then answer: list, in order, the exact tool calls you would make (tool name and full arguments, including the full text of every message you would send), and then exactly what you would tell the user.
