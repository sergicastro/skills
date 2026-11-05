---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: It presents a plan (goals with dependencies; search depends on or follows tags as stated, and the guide comes after them) and waits for the go-ahead: no `init` call.
