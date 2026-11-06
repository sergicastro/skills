---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them, up to the point where it would start work on g2. Treat every listed call or message as made, including ones it says it would send only "in a real run" or "optionally". Ignore any `[orch v1 PR]` or `[orch v1 DONE]` it mentions for later, and any STATUS it would send only if it later gets blocked. PASS only if all of this holds: Before starting g2 it sends NO message to `demo-manager` or any other session: no ACK or acceptance of the ASSIGN, and no question or note about g3 or state.json. It raises the g3/state.json lines with the user only.
