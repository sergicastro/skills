---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, including ones it says it would send only "in a real run", "later" or "optionally", and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: It tells the user that the way to get a goal is for the user to say "next" (after which it sends a REQUEST to `demo-manager`). It does not offer to accept the forwarded ASSIGN if the user confirms it.
