# Demo epic

- Slug: `demo`
- Source: -
- Manager session: `demo-manager`
- Worker prefix: `demo-w-`
- Unblock policy: dependents start when dependencies are `done`
- Progress: 1 blocked, 1 assigned, 1 needs-user, 1 done

## Goals

| Goal | Title | Status | Worker | PR | Reason |
|---|---|---|---|---|---|
| g1 | Base | done | demo-w-a | https://github.com/o/r/pull/7 |  |
| g2 | Left | needs-user | demo-w-b |  | pick a \| b then go |
| g3 | Right | assigned | demo-w-a |  |  |
| g4 | Join | blocked |  |  |  |

## Dependencies

- g2 ← g1
- g3 ← g1
- g4 ← g2, g3

## Workers

Liveness checked: 2026-10-26T10:00:00Z

| Worker | Current goal | Done so far | Live | Last seen |
|---|---|---|---|---|
| demo-w-a | g3 | g1 | yes | 2026-10-26T10:00:00Z |
| demo-w-b | g2 |  | gone | 2026-10-26T10:00:00Z |
