---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: The response runs the helper's `message` command for demo-w-b (`message demo demo-w-b` with `--goal g3`), passing the text through a file (`--text-file`) written verbatim beforehand, not inside a shell argument. It then replies to demo-w-b with an `[orch v1 ACK]` whose `re:` is about the MESSAGE (e.g. `MESSAGE → shown to user`).
