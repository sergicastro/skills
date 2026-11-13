---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response does not send a STATUS, PR, DONE, REQUEST or NOTICE, and does not invent a message type other than MESSAGE. It does not stop working g2 or say g2 is finished.
