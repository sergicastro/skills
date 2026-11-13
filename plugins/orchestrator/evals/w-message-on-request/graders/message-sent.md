---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response sends exactly one message to demo-manager, and it is an `[orch v1 MESSAGE]` with `epic: demo`, a `goal:` line (`g2` or `-`) and a `text:` that carries the user's point (g2 pages with a cursor, not page numbers; g4 should use the cursor).
