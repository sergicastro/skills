# Dry-run results (2026-10-26)

Live run with user-created sessions `dry-manager`, `greet-dry-w-one`, `greet-dry-w-two` and
`not-a-worker`, using `demo-epic.md` (slug `greet-dry`, no GitHub).

| Step | Result | Notes |
|---|---|---|
| 1. Plan, then init on "go" | PASS | Plan shown, nothing written until "go"; `~/.claude-orchestrator/greet-dry/` created. |
| 2. Workers register | PASS | Both ACKed. |
| 3. w-one next → goal 1; w-two next → NONE_READY | **FAIL → fixed** | Both REQUESTs arrived in one manager turn (the second as "sent a message while you were working"). The manager answered only w-one; w-two's REQUEST was never run (absent from `events.log`). When w-two asked, the manager wrongly claimed the REQUEST came "before the plan was initialized" (init was at 14:26:57, REQUEST at 14:30:34). |
| 4. DONE → in-review, worker stops | PASS | |
| 5. approve goal 1 → 2 and 3 ready, no worker messaged | PASS | |
| 6. Workers get goals 2/3 with upstream notes | PASS | Upstream carried goal 1's notes. |
| 7. status matches reality | PASS | |
| 8. Unprefixed session refused | PASS | Told to rename. |

## Fix for step 3

- Manager SKILL.md: handle every `[orch v1` message of a turn, oldest first, each with its own
  `$ORCH` call and reply; check that every REQUEST got exactly one ASSIGN/NONE_READY before
  ending the turn; when a worker reports no reply, check `events.log` and answer it now, without
  guessing a cause. Two rationalization rows added.
- Worker SKILL.md: no reply to REQUEST by the user's next prompt → tell the user and resend once.
  (`request` is safe to resend: a worker already holding a goal gets an error, not a second goal.)
- New pressure scenario M8 (two REQUESTs in one turn): GREEN PASS: "Handle every `[orch v1`
  message of the turn, oldest first, each with its own `$ORCH` call and reply."
