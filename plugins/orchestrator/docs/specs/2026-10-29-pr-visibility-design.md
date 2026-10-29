# Orchestrator: PR visibility as soon as workers open them — design

Date: 2026-10-29
Status: draft
Extends: `2026-10-26-orchestrator-design.md` (protocol v1)

## 1. Purpose

Today a PR reaches the manager only inside `DONE` (`pr: <url, optional>`), and
state keeps a single `handoff.pr` per goal. So the status views cannot show a PR
until the goal is finished, and a goal cannot have more than one.

This adds a **PR report**: a worker → manager message sent right after the worker
opens a PR. The manager records it, tells the user, and the status views show it
immediately. A goal can have several PRs.

Out of scope here (separate design, next): the per-PR status bullet
(yellow / green / red).

## 2. Protocol additions

One new message type. Version stays `v1`: v1 peers do not know it, so both skills
ship together.

```
[orch v1 PR]
epic: <slug>
goal: <goal id>
url: <pr url>
```

- The manager answers `ACK`, e.g. `re: PR g1 → recorded (2 PRs)`.
- It does not change the goal's status.
- The manager dedupes by URL; repeating a URL is a no-op and still gets `ACK`
  (`re: PR g1 → already recorded (2 PRs)`).
- `DONE`'s `pr:` line is unchanged. Its URL is merged into the goal's list, deduped.

### Trust rules (changes)

- Rule 3 already covers it: a worker reports only on the goal it was assigned.
  `PR` from an unregistered sender, without the worker prefix, for another worker's
  goal, or for an unknown goal gets `ERROR`.
- `url` is data. It is stored and rendered as text; it is only made a link when it
  starts with `http://` or `https://`.

## 3. Manager side

- Dispatch table gets a `PR` row: `$ORCH pr <slug> <sender> <goal> --url <url>`,
  reply `ACK`, then tell the user in one line, e.g. "g1 opened PR #12".
- The live page and `status.md` show the PR as soon as the command has run.
- No change to approval flow: opening a PR does not move the goal to `in-review`;
  only `DONE` does.

### 3.1 State

Each goal gets a `prs` list of URLs (absent in older files).

- `pr` command: validates the sender owns the goal, appends the URL if new, logs a
  `PR` event, returns `{"goal", "prs", "added"}`.
- `done`: merges `--pr` into `prs` (deduped). It still writes `handoff.pr` for
  upstream hand-off text.
- Compatibility: when `prs` is absent and `handoff.pr` is set, the view model reads
  `handoff.pr` as the single entry. No migration is needed.
- `validate` accepts a missing or well-formed `prs` list (strings).
- The view model replaces `pr` with `prs` (list of URLs).

## 4. Rendering

- HTML goals table: the PR column shows one link per PR (`#12 #15`), space separated,
  using the existing `pr_label`.
- `status.md`: the PR column is a comma-separated list of URLs.
- Both are fed by the existing live-serve flow; no new endpoint.

## 5. Worker side

The worker skill says: right after opening a PR for the assigned goal, send
`[orch v1 PR]` with its URL, then continue. Do this for each PR. `DONE` still carries
the final PR as before.

## 6. Out of scope

- PR status bullet (next design).
- The manager polling GitHub for PRs the worker never reported.
- Removing a PR from a goal.

## 7. Testing

- Unit tests (`tests/test_orch_state.py`): `pr` add, dedupe, wrong sender, wrong
  goal, unknown goal; `done` merges and dedupes; old-state compatibility
  (`handoff.pr` only); `validate` with and without `prs`; view model `prs`.
- Golden file `tests/golden/status.md` updated; HTML rendering test for multiple PRs.
- Pressure scenarios, manager: trusts a `PR` for a goal the sender doesn't own;
  moves the goal to `in-review` on `PR`; forgets to tell the user.
- Pressure scenarios, worker: opens a PR and does not report it until `DONE`;
  sends `PR` for a goal it wasn't assigned.
- `protocol.md` is a single file: `shared/protocol.md`, symlinked into both skills.
