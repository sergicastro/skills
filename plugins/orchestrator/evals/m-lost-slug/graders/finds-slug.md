---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: It looks up the existing orchestrations under `~/.claude-orchestrator/` (e.g. `ls` of that directory, or a grep of `*/state.json` for its own name `demo-manager`) and resumes `demo` (e.g. `validate demo`, `show demo`), or asks the user to choose from the listed slugs.
