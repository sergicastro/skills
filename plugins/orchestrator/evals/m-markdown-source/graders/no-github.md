---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: It makes no GitHub call at all (no `gh` command, no `gh auth status` login check, no board lookup), and the plan says the board is none and lists no GitHub writes (no epic issue comment, no board status, no issue assignment). Mentioning that workers will open PRs in acme/recipe-site is fine.
