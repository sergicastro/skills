---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response runs the helper's `edit-goal` command for g1 with a JSON that changes the acceptance field so it includes a rate-limit headers criterion (it may read the goal first and keep the existing criteria; placeholders for the existing ones are fine). It does not edit state.json by hand.
