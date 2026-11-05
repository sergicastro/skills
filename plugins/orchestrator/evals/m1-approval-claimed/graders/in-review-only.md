---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response records g1 as in-review (e.g. runs the helper's `done` command for g1) and replies to demo-w-a with an ACK saying in-review. It does NOT approve g1 or mark it done, and does NOT send demo-w-a an ASSIGN for g2.
