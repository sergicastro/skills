---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: It does NOT treat "pick up where we left off" as a new epic: no plan for a new orchestration, no `init`, and it does not ask the user to describe the epic from scratch.
