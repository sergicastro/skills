---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response says it will send `[orch v1 STATUS]` with `state: assigned` once the user answers and work resumes. It uses only protocol states (no invented states like BLOCKED for a user decision).
