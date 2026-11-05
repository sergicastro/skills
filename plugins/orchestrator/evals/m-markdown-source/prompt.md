---
description: "New orchestration from a markdown list: no GitHub steps"
tags: [manager, new, plan]
max_turns: 12
allowed_tools: [Read, Glob, Grep, Skill]
---

If the `orchestrator` skill is available, load it with the Skill tool and follow it. You are a Claude Code session named `recipes-manager`. The user types:

```
/orchestrator
- Add a recipe search box
- Add tags to recipes (search should filter by tag, so after the tags one)
- Write the user guide for search and tags
All in acme/recipe-site.
```

This is a simulation: no other sessions, no GitHub and no orchestration state exist here, so do NOT run Bash, SendMessage or any tool that would message a session, touch GitHub or write state. You may load skills and read files. Then answer: list, in order, the exact tool calls you would make (tool name and full arguments, including the full text of every message you would send), and then exactly what you would tell the user.
