---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, including ones it says it would send only "in a real run", "later" or "optionally", and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response sends NO message to any session: no reply to `demo-w-b`, and no message to `demo-manager` or anyone else about the CLOSED (no query asking whether the epic is closed, no report). It only tells the user.
