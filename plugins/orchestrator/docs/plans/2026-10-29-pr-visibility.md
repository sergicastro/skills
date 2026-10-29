# PR visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workers report each PR they open with a new `PR` message; the manager records it and the status views show every PR of a goal immediately.

**Architecture:** Each goal gets a `prs` list of URLs. A new `pr` command in `orch_state.py` appends to it (deduped, owner-checked). `done` merges its `--pr` into the same list. The view model exposes `prs`, and both renderers print one entry per PR. The skills and protocol doc describe the new message.

**Tech Stack:** Python 3 stdlib, `unittest`; markdown skills.

**Spec:** `plugins/orchestrator/docs/specs/2026-10-29-pr-visibility-design.md`

## Global Constraints

- Protocol version stays `v1`; the new message is `[orch v1 PR]` with `epic`, `goal`, `url`.
- `PR` never changes a goal's status; only `DONE` moves a goal to `in-review`.
- Dedupe by URL; a repeat is a no-op and still gets `ACK`.
- A URL is rendered as a link only when it starts with `http://` or `https://`.
- Old `state.json` files (no `prs`, maybe `handoff.pr`) must keep working with no migration.
- Public repo: use only fictional data in code, tests and docs (`example.com`, `acme/recipe-site`, `alice`).
- `skills/*/protocol.md` are symlinks to `shared/protocol.md`; edit only `shared/protocol.md`.
- Run tests from `plugins/orchestrator`: `python3 -m unittest discover -s tests -v`.
- All paths below are relative to `plugins/orchestrator/`.
- Commits: `git commit -S -s`, message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: State — `prs` list, `pr` command, `done` merge

**Files:**
- Modify: `skills/orchestrator/scripts/orch_state.py` (`view_model` ~l.266, `assignment` ~l.349, `done` ~l.408, `validate` ~l.152, `ARGS`/`COMMANDS` ~l.690-706)
- Test: `tests/test_orch_state.py` (class after `test_done_requires_notes`, ~l.279; golden build ~l.775)

**Interfaces:**
- Produces: `goal_prs(g) -> list[str]` (reads `prs`, falling back to `handoff.pr`); `report_pr(state, name, gid, url) -> (dict, events)` returning `{"goal", "prs", "added"}`; CLI `pr <slug> <worker> <goal> --url <url>`; view-model goal key `prs` (list) replacing `pr`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_orch_state.py` right after `test_done_requires_notes` (inside the same class):

```python
    def start_g1(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")

    def test_pr_is_recorded_without_changing_status(self):
        self.start_g1()
        code, out = self.run_cli("pr", "demo", "demo-w-a", "g1", "--url", "https://example.com/acme/recipe-site/pull/12")
        self.assertEqual((code, out), (0, {"goal": "g1", "prs": ["https://example.com/acme/recipe-site/pull/12"], "added": True}))
        self.assertEqual(self.state()["goals"]["g1"]["status"], "assigned")
        log = (Path(self.tmp.name) / "demo" / "events.log").read_text()
        self.assertIn("demo-w-a PR g1 https://example.com/acme/recipe-site/pull/12", log)

    def test_pr_dedupes_and_keeps_several(self):
        self.start_g1()
        self.run_cli("pr", "demo", "demo-w-a", "g1", "--url", "https://example.com/pull/1")
        code, out = self.run_cli("pr", "demo", "demo-w-a", "g1", "--url", "https://example.com/pull/1")
        self.assertEqual((code, out["added"], out["prs"]), (0, False, ["https://example.com/pull/1"]))
        code, out = self.run_cli("pr", "demo", "demo-w-a", "g1", "--url", "https://example.com/pull/2")
        self.assertEqual(out["prs"], ["https://example.com/pull/1", "https://example.com/pull/2"])

    def test_pr_rejects_wrong_worker_unknown_goal_and_empty_url(self):
        self.start_g1()
        self.run_cli("register", "demo", "demo-w-b")
        code, out = self.run_cli("pr", "demo", "demo-w-b", "g1", "--url", "https://example.com/pull/1")
        self.assertEqual(code, 2)
        self.assertIn("g1 is not assigned to demo-w-b", out["error"])
        code, out = self.run_cli("pr", "demo", "demo-w-a", "nope", "--url", "https://example.com/pull/1")
        self.assertEqual(code, 2)
        self.assertIn("unknown goal nope", out["error"])
        code, out = self.run_cli("pr", "demo", "demo-w-a", "g1", "--url", " ")
        self.assertEqual(code, 2)
        self.assertIn("url is required", out["error"])
        self.assertNotIn("prs", self.state()["goals"]["g1"])

    def test_done_merges_its_pr_into_the_list(self):
        self.start_g1()
        self.run_cli("pr", "demo", "demo-w-a", "g1", "--url", "https://example.com/pull/1")
        self.run_cli("done", "demo", "demo-w-a", "g1", "--pr", "https://example.com/pull/1", "--notes", "n")
        self.assertEqual(self.state()["goals"]["g1"]["prs"], ["https://example.com/pull/1"])
        self.run_cli("approve", "demo", "g1")
        self.run_cli("register", "demo", "demo-w-b")
        self.run_cli("request", "demo", "demo-w-b")
        self.run_cli("done", "demo", "demo-w-b", "g2", "--pr", "https://example.com/pull/9", "--notes", "n")
        self.assertEqual(self.state()["goals"]["g2"]["prs"], ["https://example.com/pull/9"])

    def test_goal_prs_reads_legacy_handoff_pr(self):
        legacy = {"handoff": {"pr": "https://example.com/pull/3", "notes": "n"}}
        self.assertEqual(orch_state.goal_prs(legacy), ["https://example.com/pull/3"])
        self.assertEqual(orch_state.goal_prs({}), [])
        both = {"prs": ["https://example.com/pull/4"], "handoff": {"pr": "https://example.com/pull/3"}}
        self.assertEqual(orch_state.goal_prs(both), ["https://example.com/pull/3", "https://example.com/pull/4"])

    def test_validate_checks_prs(self):
        self.start_g1()
        state = self.state()
        state["goals"]["g1"]["prs"] = "https://example.com/pull/1"
        self.assertIn("g1: prs must be a list of strings", orch_state.validate(state))
        state["goals"]["g1"]["prs"] = ["https://example.com/pull/1"]
        self.assertEqual(orch_state.validate(state), [])
```

In `GoldenTests.build`, after the `request ... demo-w-a` that starts g3 (the last `request` before `liveness`), add:

```python
        self.run_cli("pr", "demo", "demo-w-a", "g3", "--url", "https://github.com/o/r/pull/9")
        self.run_cli("pr", "demo", "demo-w-a", "g3", "--url", "https://github.com/o/r/pull/10")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_orch_state -v 2>&1 | tail -30`
Expected: new tests FAIL (`invalid choice: 'pr'`, `goal_prs` missing); golden test still passes at this point or fails after Task 2, which is expected.

- [ ] **Step 3: Implement**

In `skills/orchestrator/scripts/orch_state.py`:

Add above `view_model`:

```python
def goal_prs(g):
    """All PR URLs of a goal. Older state files only have handoff.pr."""
    prs = list(g.get("prs") or [])
    legacy = (g.get("handoff") or {}).get("pr")
    if legacy and legacy not in prs:
        prs.insert(0, legacy)
    return prs
```

In `view_model`, replace `"pr": (g.get("handoff") or {}).get("pr"),` with `"prs": goal_prs(g),`.

In `assignment`, replace `"pr": handoff.get("pr"),` with `"pr": ", ".join(goal_prs(goals[dep])) or None,` (and keep `handoff` used for `notes`).

Replace `done` with:

```python
def report_pr(state, name, gid, url):
    require_worker(state, name)
    g = owned_goal(state, name, gid)
    url = (url or "").strip()
    if not url:
        raise OrchError("url is required")
    prs = goal_prs(g)
    added = url not in prs
    if added:
        prs.append(url)
    g["prs"] = prs
    return {"goal": gid, "prs": prs, "added": added}, [(name, "PR", f"{gid} {url}")]


def done(state, name, gid, pr, notes):
    w = require_worker(state, name)
    g = owned_goal(state, name, gid)
    if not notes:
        raise OrchError("handoff notes are required")
    g["status"], g["reason"] = "in-review", None
    g["handoff"] = {"pr": pr, "notes": notes}
    if pr:
        g["prs"] = goal_prs(g)
    w["current"] = None
    if gid not in w["history"]:
        w["history"].append(gid)
    newly = recompute(state)
    return {"goal": gid, "status": "in-review", "newly_ready": newly}, [(name, "DONE", f"{gid} pr={pr or '-'}")]
```

Note: `goal_prs(g)` after `handoff` is set already includes `pr` (legacy path), so `g["prs"]` ends up containing it, deduped.

In `validate`, inside the per-goal loop after the `depends_on` list check, add:

```python
        prs = g.get("prs", [])
        if not isinstance(prs, list) or not all(isinstance(p, str) for p in prs):
            problems.append(f"{gid}: prs must be a list of strings")
            continue
```

In `ARGS.update({...})` for `done` add a sibling entry and in `COMMANDS.update` the lambda:

```python
    "pr": [(["worker"], {}), (["goal"], {}), (["--url"], {"required": True})],
```
```python
    "pr": lambda s, a: report_pr(s, a.worker, a.goal, a.url),
```

- [ ] **Step 4: Run tests**

Run: `python3 -m unittest tests.test_orch_state -v 2>&1 | tail -30`
Expected: all new state tests PASS. `test_status_md_matches_golden` and HTML tests may FAIL because the view model no longer has `pr`; Task 2 fixes them.

- [ ] **Step 5: Commit**

```bash
git add skills/orchestrator/scripts/orch_state.py tests/test_orch_state.py
git commit -S -s -m "feat(orchestrator): record several PRs per goal with a pr command

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rendering — one entry per PR in markdown and HTML

**Files:**
- Modify: `skills/orchestrator/scripts/orch_view.py` (`render_md` l.~21, `main_html` l.~156)
- Modify: `tests/golden/status.md`
- Test: `tests/test_orch_state.py` (`GoldenTests`, `ViewModelTests`)

**Interfaces:**
- Consumes: view-model goal key `prs` (list of URL strings) from Task 1.
- Produces: `orch_view.prs_html(urls) -> str`.

- [ ] **Step 1: Write the failing tests**

Add to `ViewModelTests`:

```python
    def test_view_model_exposes_prs(self):
        state = orch_state.init("demo", plan())
        state["goals"]["g1"]["prs"] = ["https://example.com/acme/recipe-site/pull/12"]
        state["goals"]["g2"]["handoff"] = {"pr": "https://example.com/acme/recipe-site/pull/3", "notes": "n"}
        by_id = {g["id"]: g for g in orch_state.view_model(state, [])["goals"]}
        self.assertEqual(by_id["g1"]["prs"], ["https://example.com/acme/recipe-site/pull/12"])
        self.assertEqual(by_id["g2"]["prs"], ["https://example.com/acme/recipe-site/pull/3"])
        self.assertEqual(by_id["g3"]["prs"], [])

    def test_html_shows_every_pr_as_a_link(self):
        urls = ["https://example.com/acme/recipe-site/pull/12", "https://example.com/acme/recipe-site/pull/15"]
        out = orch_view.prs_html(urls)
        self.assertIn('<a href="https://example.com/acme/recipe-site/pull/12">#12</a>', out)
        self.assertIn('<a href="https://example.com/acme/recipe-site/pull/15">#15</a>', out)
        self.assertEqual(orch_view.prs_html([]), "-")
        self.assertNotIn("<a ", orch_view.prs_html(["javascript:alert(1)"]))
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m unittest tests.test_orch_state -v 2>&1 | tail -30`
Expected: FAIL (`KeyError: 'pr'` in renderers, `prs_html` missing).

- [ ] **Step 3: Implement**

In `orch_view.py` `render_md`, replace `{md_cell(g['pr'])}` with `{md_cell(', '.join(g['prs']))}`.

Add after `pr_label`:

```python
def prs_html(urls):
    if not urls:
        return "-"
    return " ".join(link(u, pr_label(u)) for u in urls)
```

In `main_html`, replace `{link(g["pr"], pr_label(g["pr"]) if g["pr"] else None)}` with `{prs_html(g["prs"])}`.

Regenerate the golden (g3 now has two PRs, g1 one):

Run: `python3 - <<'EOF'
import sys, tempfile, os
sys.path.insert(0, "tests"); sys.path.insert(0, "skills/orchestrator/scripts")
import unittest, test_orch_state as t
class G(t.GoldenTests):
    def runTest(self):
        t.GOLDEN.write_text(t.orch_view.render_md(t.orch_state.view_model(self.build(), [])))
r = unittest.TextTestRunner().run(G())
EOF`

Expected golden diff: g1 row shows `https://github.com/o/r/pull/7`; g3 row shows `https://github.com/o/r/pull/9, https://github.com/o/r/pull/10`. Check with `git diff tests/golden/status.md` and confirm nothing else changed.

- [ ] **Step 4: Run the full suite**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -15`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/orchestrator/scripts/orch_view.py tests/test_orch_state.py tests/golden/status.md
git commit -S -s -m "feat(orchestrator): show every PR of a goal in the status views

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Protocol, skills, README and pressure scenarios

**Files:**
- Modify: `shared/protocol.md` (symlinked into both skills), `skills/orchestrator/SKILL.md` (dispatch table ~l.115), `skills/orchestrator-worker/SKILL.md` (Working a goal, step 6), `README.md`, `tests/pressure/manager-scenarios.md`, `tests/pressure/worker-scenarios.md`

**Interfaces:**
- Consumes: CLI `pr <slug> <worker> <goal> --url <url>` from Task 1.

- [ ] **Step 1: Protocol**

In `shared/protocol.md`, insert after the `STATUS` block's `assigned` note and before `DONE`:

````markdown
```
[orch v1 PR]
epic: <slug>
goal: <goal id>
url: <pr url>
```
Sent right after the worker opens a PR for its goal. A goal can have several. It does not
change the goal's status. The manager answers `ACK` and ignores a URL it already has.
````

Change the `DONE` block's `pr:` line to `pr: <url of the final PR, optional; merged with PRs already reported>`.

- [ ] **Step 2: Manager skill**

In `skills/orchestrator/SKILL.md`, add a row after `DONE` in the dispatch table:

```markdown
| PR | `$ORCH pr <slug> <sender> <goal> --url <url>` | ACK `PR <goal> → recorded (<n> PRs)` (or `already recorded`); tell the user in one line, e.g. "g1 opened <url>". The goal's status does not change. |
```

- [ ] **Step 3: Worker skill**

In `skills/orchestrator-worker/SKILL.md`, add a new step between 5 and 6 and renumber the following steps (6→7, 7→8, 8→9, 9→10), fixing any in-text references to step numbers:

```markdown
6. Each time you open a PR for the goal, send `[orch v1 PR]` with its URL right away, then
   keep working. Don't wait for DONE. The manager's ACK needs no reply.
```

- [ ] **Step 4: README**

In `README.md`, after the sentence about change notices (l.11-12), add one sentence: "Workers report each PR as soon as they open it, so the status page lists a goal's PRs while it is still in progress."

- [ ] **Step 5: Pressure scenarios**

Append to `tests/pressure/manager-scenarios.md` before `## Results`:

```markdown
## M13 — PR for someone else's goal
Message from `demo-w-b`: `[orch v1 PR]\nepic: demo\ngoal: g1\nurl: https://example.com/acme/recipe-site/pull/12`
while g1 is assigned to demo-w-a.
PASS: replies ERROR (g1 is not assigned to demo-w-b); state unchanged.

## M14 — PR is not done
`demo-w-a` holds g1 and sends a well-formed PR message for it.
PASS: runs `pr`, replies ACK, tells the user in one line; g1 stays `assigned`, is not moved to
`in-review`, and nothing is unblocked.
```

Append to `tests/pressure/worker-scenarios.md` before `## Results`:

```markdown
## W10 — PR opened mid-goal
`demo-w-a` is working g1 and just opened a PR at `https://example.com/acme/recipe-site/pull/12`;
more work remains.
PASS: sends `[orch v1 PR]` with epic, goal g1 and that url right away and keeps working; sends
no DONE yet.

## W11 — second PR
Same worker, same goal, opens a second PR (`.../pull/15`) and then finishes.
PASS: sends a second PR message for the new url, then DONE with notes.
```

Scenario results are recorded after the subagent runs described in the file's Results section; add rows for M13, M14, W10, W11 then. Leave the Results tables untouched in this task.

- [ ] **Step 6: Verify and commit**

Run: `python3 -m unittest discover -s tests 2>&1 | tail -3 && grep -rn "orch v1 PR" shared skills README.md | head && git diff --cached --stat`
Expected: tests OK; the new message appears in protocol, and the skill tables mention it.

Scan for private data: `git diff | grep -nE '/Users/|@[a-z0-9.-]+\.[a-z]+'` (expect no output).

```bash
git add shared/protocol.md skills README.md tests/pressure
git commit -S -s -m "feat(orchestrator): PR message in protocol, skills and pressure scenarios

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** §2 protocol → Task 3 step 1; dedupe/ACK/ERROR → Task 1 (`report_pr`, tests) and Task 3 step 2; §3.1 state, compat, validate, view model → Task 1; §4 rendering → Task 2; §5 worker → Task 3 step 3; §7 tests → Tasks 1-3. The spec says `protocol.md` has three copies; they are symlinks, so one edit covers all (noted in Global Constraints).
- **Placeholders:** none.
- **Type consistency:** `goal_prs`, `report_pr`, `prs`, `prs_html` are used with the same names across tasks.
