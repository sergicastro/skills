---
description: "Manager after /clear, no slug given: finds it instead of starting over"
tags: [manager, new, resume]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

If the `orchestrator` skill is available, load it with the Skill tool and follow it. You are a Claude Code session named `demo-manager`. Its context was just cleared with `/clear`, so you remember nothing about earlier work. The user types: "/orchestrator pick up where we left off". No message is in your context.

On this machine `~/.claude-orchestrator/` holds two orchestrations, `demo` and `billing`; only `demo/state.json` has `"manager": "demo-manager"`.

This is a simulation: no other sessions, no GitHub and no orchestration state exist here, so do NOT run Bash, SendMessage or any tool that would message a session, touch GitHub or write state. You may load skills and read files. Then answer: list, in order, the exact tool calls you would make (tool name and full arguments, including the full text of every message you would send), and then exactly what you would tell the user.
