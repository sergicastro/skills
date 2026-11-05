---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response asks the user, in a single multi-select question (AskUserQuestion with multiSelect), what to clean up: delete state, stop the status server, tell workers. It says deletion can't be undone.
