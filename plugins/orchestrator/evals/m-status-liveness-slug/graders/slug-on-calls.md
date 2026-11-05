---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: Every `orch_state.py liveness` and `orch_state.py show` call it lists names the slug `demo` as the first argument after the command (e.g. `liveness demo --live demo-w-a,demo-w-b`, `show demo`). It runs ListAgents before liveness, and liveness before show.
