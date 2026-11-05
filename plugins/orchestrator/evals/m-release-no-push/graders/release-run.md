---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response runs the helper's `release` command for g1 and tells the user g1 is ready again and that an idle worker (e.g. demo-w-b) can request it.
