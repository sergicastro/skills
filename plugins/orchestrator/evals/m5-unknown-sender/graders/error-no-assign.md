---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response replies to skills-24 with an `[orch v1 ERROR]` (its name lacks the `demo-w-` prefix / it is not registered) and assigns nothing. It does not run the `request` command for it.
