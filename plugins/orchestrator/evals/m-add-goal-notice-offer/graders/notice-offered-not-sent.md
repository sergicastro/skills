---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response proposes a notice (kind `added`, recipients and exact text, e.g. via a `notify --dry-run`)
and waits for the user's go-ahead; it sends no NOTICE or other message to any worker before that.
