I loaded the `orchestrator` skill and read its `protocol.md`. Below, `$ORCH` stands for `python3 ~/.claude/plugins/orchestrator/skills/orchestrator/scripts/orch_state.py`. Nothing was run, sent or written.

## Tool calls, in order

I'd handle the two REQUESTs oldest first: demo-w-b's, then demo-w-c's. Each gets its own `$ORCH request` call and its own reply, one at a time, never in parallel. The two requests share the ready goals, so the second call depends on what the first one took.

**1. Bash**
```
$ORCH request demo demo-w-b
```
I'd expect it to return an assignment for `g2` (the first ready goal, if nothing was reprioritised), with g2's title, summary, acceptance, repo, links, board, state_dir and upstream g1 data.

**2. SendMessage** to `demo-w-b`, built from that reply. The `<…>` parts get filled from the `$ORCH` reply, since no state exists here:
```
[orch v1 ASSIGN]
epic: demo
goal: g2
title: <g2 title>
summary:
  <g2 summary>
acceptance:
  - <g2 criterion 1>
  - <g2 criterion 2>
repo: <g2 repo, or ->
links:
  - <g2 link>
upstream:
  - g1 (done): pr <g1 PR urls, comma-separated, or ->; notes: <g1 handoff notes>
board: none
state_dir: ~/.claude-orchestrator/demo   (read-only for workers)
```

**3. Bash**, run after step 2 has been sent:
```
$ORCH request demo demo-w-c
```
I'd expect it to return `g3`, because g2 is now assigned to demo-w-b.

**4. SendMessage** to `demo-w-c`:
```
[orch v1 ASSIGN]
epic: demo
goal: g3
title: <g3 title>
summary:
  <g3 summary>
acceptance:
  - <g3 criterion 1>
  - <g3 criterion 2>
repo: <g3 repo, or ->
links:
  - <g3 link>
upstream:
  - g1 (done): pr <g1 PR urls, comma-separated, or ->; notes: <g1 handoff notes>
board: none
state_dir: ~/.claude-orchestrator/demo   (read-only for workers)
```

If either `request` returned `none_ready` instead, I'd send `[orch v1 NONE_READY]` with `epic: demo` and `reason: <its none_ready text>`. If it returned `{"error": …}`, I'd send `[orch v1 ERROR]` with `epic: demo`, `re: REQUEST` and `reason: <error text>`.

Before ending the turn I'd check that each REQUEST got exactly one reply: demo-w-b got one ASSIGN and demo-w-c got one ASSIGN. There's no GitHub step because the board is none.

## What I'd tell the user

> Two workers asked for work this turn:
> - **demo-w-b** → assigned **g2** (depends on g1, which you approved)
> - **demo-w-c** → assigned **g3** (depends on g1, which you approved)
>
> No goal is ready now. **g4** stays blocked until g2 and g3 are both done (you approve them). demo-w-a has nothing in progress, but there's nothing for it to take until g4 unblocks. I'll tell you when g2 and g3 come back for review.