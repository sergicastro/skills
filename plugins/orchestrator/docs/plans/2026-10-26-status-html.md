# Live Status Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `status.md` and a new `status.html` from one view model, and add `orch_state.py serve`, a local server that shows every orchestration live in a browser.

**Architecture:** `orch_state.py` builds a plain-dict view model from state; `orch_view.py` turns it into Markdown or HTML using `string.Template` files in `skills/orchestrator/templates/`. `orch_serve.py` is a stdlib `ThreadingHTTPServer` on `127.0.0.1` that renders pages fresh from disk and pushes re-rendered `<main>` HTML over Server-Sent Events when `state.json` or `events.log` change. `serve --ensure` starts it detached once per state root; the manager skill calls it at init and resume.

**Tech Stack:** Python 3.9+ stdlib (`string`, `html`, `http.server`, `threading`, `subprocess`, `fcntl`, `unittest`), inline CSS/JS, inline SVG.

**Spec:** `docs/specs/2026-10-26-status-html-design.md`. Read it before any task.

## Global Constraints

- Work in a separate git worktree on branch `claude-orchestrator-status-html`. Never commit on `main`.
- Python: stdlib only, must run on Python 3.9+: no `match`, no `X | Y` types, no backslashes and no reused outer quote character inside f-string expressions. Local interpreter is 3.14.
- Templates use `string.Template`. CSS and JS in templates must not contain `$`; only `$title`, `$main`, `$stream` and the Markdown placeholders may appear.
- The server binds `127.0.0.1` only, default port `8765`, answers GET only, and is read-only.
- Every value from state or events goes through `orch_view.esc` (`html.escape`) before it lands in HTML or SVG. Only links starting `http://` or `https://` become `href`s.
- The page makes no external requests (no CDNs, fonts or images).
- `status.md` output must stay byte-identical to the current `render()` output (guarded by the golden test from Task 1).
- State root: `orch_state.root()` (`ORCH_ROOT` env overrides it in tests). Server files: `<root>/.server.json`, `<root>/.server.lock`, `<root>/server.log`.
- Run all tests from the worktree root: `python3 -m unittest discover -s tests -v`.

## File Structure

```
skills/orchestrator/
  SKILL.md                      # Task 5: ensure server at init/resume
  scripts/
    orch_state.py               # Tasks 1, 2, 4: view_model, read_events, write_views, serve CLI
    orch_view.py                # Tasks 1-3 (new): render_md, main_html, graph_svg, render_page, index_main_html
    orch_serve.py               # Tasks 3-4 (new): StatusServer, SSE, ensure/stop
  templates/
    status.md.tmpl              # Task 1 (new)
    status.html.tmpl            # Task 2 (new): page shell, inline CSS + JS
tests/
  golden/status.md              # Task 1 (new): captured from today's render()
  test_orch_state.py            # Tasks 1-2: golden, view model, HTML tests
  test_orch_serve.py            # Tasks 3-4 (new): server and lifecycle tests
README.md                       # Task 5
```

`orch_view.py` imports only the stdlib, so `orch_state.py` can import it at the top without a cycle. `orch_serve.py` imports both.

---

### Task 1: View model and Markdown template

**Files:**
- Create: `skills/orchestrator/scripts/orch_view.py`
- Create: `skills/orchestrator/templates/status.md.tmpl`
- Create: `tests/golden/status.md` (generated)
- Modify: `skills/orchestrator/scripts/orch_state.py` (imports; `save` at lines 184-191; remove `cell` and `render` at lines 194-237; `show` at line 573)
- Test: `tests/test_orch_state.py`

**Interfaces:**
- Produces:
  - `orch_state.EVENTS_SHOWN = 30`
  - `orch_state.read_events(d: Path, limit: int = 30) -> list[dict]`, items `{"at", "actor", "event", "details"}`, newest first; `[]` when `events.log` is missing.
  - `orch_state.depths(goals: dict) -> dict[str, int]`, longest path from a goal with no dependencies; cycle-safe.
  - `orch_state.view_model(state: dict, events: list, problems=()) -> dict` with keys: `slug, title, source, manager, worker_prefix, unblock_on, counts` (list of `(status, n)` in `STATES` order), `goals` (list of `{"id","title","status","worker","pr","reason","depends_on","col","row"}` in state order), `edges` (list of `{"from","to","met"}`), `live_checked, workers` (list of `{"name","current","history","live","last_seen"}`), `events, problems` (list of str), `updated` (`now()`).
  - `orch_state.write_views(d: Path, state: dict) -> None`, writes the rendered files.
  - `orch_view.template(name: str) -> string.Template`, `orch_view.md_cell(value) -> str`, `orch_view.render_md(vm: dict) -> str`.

- [ ] **Step 1: Write the golden test against today's `render()`**

Add near the top of `tests/test_orch_state.py`, after the `import orch_state` line:

```python
GOLDEN = Path(__file__).resolve().parent / "golden" / "status.md"
```

Append this class at the end of the file:

```python
class GoldenTests(Base):
    def build(self):
        self.init()
        for w in ("demo-w-a", "demo-w-b"):
            self.run_cli("register", "demo", w)
        self.run_cli("request", "demo", "demo-w-a")
        self.run_cli("done", "demo", "demo-w-a", "g1", "--pr", "https://github.com/o/r/pull/7", "--notes", "base ready")
        self.run_cli("approve", "demo", "g1")
        self.run_cli("request", "demo", "demo-w-b")
        self.run_cli("status", "demo", "demo-w-b", "g2", "needs-user", "--reason", "pick a | b\nthen go")
        self.run_cli("request", "demo", "demo-w-a")
        self.run_cli("liveness", "demo", "--live", "demo-w-a")
        return orch_state.load("demo")

    def test_status_md_matches_golden(self):
        state = self.build()
        self.assertEqual(orch_state.render(state), GOLDEN.read_text())
```

- [ ] **Step 2: Capture the golden file from the current code**

```bash
python3 - <<'EOF'
import sys
from pathlib import Path
sys.path.insert(0, "tests")
import test_orch_state as t
case = t.GoldenTests("test_status_md_matches_golden")
case.setUp()
try:
    state = case.build()
    Path("tests/golden").mkdir(exist_ok=True)
    Path("tests/golden/status.md").write_text(t.orch_state.render(state))
finally:
    case.doCleanups()
EOF
cat tests/golden/status.md
```

Expected: the file shows g1 `done` with PR `https://github.com/o/r/pull/7`, g2 `needs-user` with reason `pick a \| b then go`, g3 `assigned` to `demo-w-a`, workers `demo-w-a` live `yes` and `demo-w-b` live `gone`.

- [ ] **Step 3: Run the golden test; it passes on today's code**

Run: `python3 -m unittest tests.test_orch_state.GoldenTests -v`
Expected: PASS

- [ ] **Step 4: Commit the guard**

```bash
git add tests/golden/status.md tests/test_orch_state.py
git commit -m "test: capture status.md golden output"
```

- [ ] **Step 5: Write failing tests for the view model and the refactored Markdown path**

In `tests/test_orch_state.py`, add `import orch_view  # noqa: E402` on the line after `import orch_state  # noqa: E402`. Replace the body of `test_status_md_matches_golden` with:

```python
    def test_status_md_matches_golden(self):
        state = self.build()
        expected = GOLDEN.read_text()
        self.assertEqual(orch_view.render_md(orch_state.view_model(state, [])), expected)
        self.assertEqual((Path(self.tmp.name) / "demo" / "status.md").read_text(), expected)
```

Append:

```python
class ViewModelTests(Base):
    def vm(self, goals=None, policy="done", statuses=None):
        state = orch_state.init("demo", plan(goals, policy={"unblock_on": policy}))
        for gid, s in (statuses or {}).items():
            state["goals"][gid]["status"] = s
        return orch_state.view_model(state, [])

    def layout(self, vm):
        return {g["id"]: (g["col"], g["row"]) for g in vm["goals"]}

    def test_diamond_layout(self):
        self.assertEqual(self.layout(self.vm()), {"g1": (0, 0), "g2": (1, 0), "g3": (1, 1), "g4": (2, 0)})

    def test_chain_and_independent_layout(self):
        vm = self.vm({
            "a": {"title": "A", "summary": "a", "depends_on": []},
            "b": {"title": "B", "summary": "b", "depends_on": ["a"]},
            "c": {"title": "C", "summary": "c", "depends_on": ["b"]},
            "x": {"title": "X", "summary": "x", "depends_on": []},
        })
        self.assertEqual(self.layout(vm), {"a": (0, 0), "b": (1, 0), "c": (2, 0), "x": (0, 1)})

    def test_depths_survive_a_cycle(self):
        goals = {"a": {"depends_on": ["b"]}, "b": {"depends_on": ["a"]}}
        self.assertEqual(set(orch_state.depths(goals)), {"a", "b"})

    def test_counts_follow_state_order(self):
        vm = self.vm()
        self.assertEqual(vm["counts"], [("blocked", 3), ("ready", 1), ("assigned", 0),
                                        ("needs-user", 0), ("in-review", 0), ("done", 0)])

    def test_edges_met_follows_policy(self):
        def met(vm):
            return {(e["from"], e["to"]): e["met"] for e in vm["edges"]}
        strict = met(self.vm(statuses={"g1": "in-review"}))
        self.assertFalse(strict[("g1", "g2")])
        early = met(self.vm(policy="in-review", statuses={"g1": "in-review"}))
        self.assertTrue(early[("g1", "g2")])
        self.assertFalse(early[("g2", "g4")])
        self.assertEqual(len(early), 4)

    def test_read_events_newest_first_limited(self):
        d = Path(self.tmp.name)
        lines = "".join(f"2026-10-26T10:00:{i:02d}Z manager E{i} detail {i}\n" for i in range(35))
        (d / "events.log").write_text(lines)
        ev = orch_state.read_events(d)
        self.assertEqual(len(ev), 30)
        self.assertEqual(ev[0], {"at": "2026-10-26T10:00:34Z", "actor": "manager", "event": "E34", "details": "detail 34"})
        self.assertEqual(ev[-1]["event"], "E5")

    def test_read_events_without_details_or_log(self):
        d = Path(self.tmp.name)
        self.assertEqual(orch_state.read_events(d / "missing"), [])
        (d / "events.log").write_text("2026-10-26T10:00:00Z user APPROVE\n")
        self.assertEqual(orch_state.read_events(d)[0]["details"], "")
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `python3 -m unittest tests.test_orch_state -v 2>&1 | tail -5`
Expected: FAIL / ERROR with `ModuleNotFoundError: No module named 'orch_view'`.

- [ ] **Step 7: Create the Markdown template**

Create `skills/orchestrator/templates/status.md.tmpl` with exactly this content (it ends with one newline after `$worker_rows`):

```
# $title

- Slug: `$slug`
- Source: $source
- Manager session: `$manager`
- Worker prefix: `$worker_prefix`
- Unblock policy: dependents start when dependencies are `$unblock_on`
- Progress: $progress

## Goals

| Goal | Title | Status | Worker | PR | Reason |
|---|---|---|---|---|---|
$goal_rows

## Dependencies

$dependencies

## Workers

Liveness checked: $live_checked

| Worker | Current goal | Done so far | Live | Last seen |
|---|---|---|---|---|
$worker_rows
```

- [ ] **Step 8: Create `orch_view.py` with the Markdown renderer**

Create `skills/orchestrator/scripts/orch_view.py`:

```python
"""Renderers for the orchestrator status views.

Every function takes the view model built by orch_state.view_model() and returns text.
This module imports only the stdlib so orch_state can import it without a cycle.
"""
import string
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


def template(name):
    return string.Template((TEMPLATES / name).read_text())


def md_cell(value):
    return str(value or "").replace("|", "\\|").replace("\n", " ")


def render_md(vm):
    goal_rows = [
        f"| {g['id']} | {md_cell(g['title'])} | {g['status']} | {md_cell(g['worker'])} | {md_cell(g['pr'])} | {md_cell(g['reason'])} |"
        for g in vm["goals"]
    ]
    deps = [f"- {g['id']} ← {', '.join(g['depends_on'])}" for g in vm["goals"] if g["depends_on"]]
    live_label = {True: "yes", False: "gone", None: "?"}
    worker_rows = [
        f"| {w['name']} | {md_cell(w['current'])} | {md_cell(', '.join(w['history']))} | {live_label[w['live']]} | {w['last_seen']} |"
        for w in vm["workers"]
    ] or ["| - | - | - | - | - |"]
    return template("status.md.tmpl").substitute(
        title=vm["title"],
        slug=vm["slug"],
        source=vm["source"] or "-",
        manager=vm["manager"],
        worker_prefix=vm["worker_prefix"],
        unblock_on=vm["unblock_on"],
        progress=", ".join(f"{n} {s}" for s, n in vm["counts"] if n),
        goal_rows="\n".join(goal_rows),
        dependencies="\n".join(deps or ["- none"]),
        live_checked=vm["live_checked"] or "never",
        worker_rows="\n".join(worker_rows),
    )
```

- [ ] **Step 9: Add the view model to `orch_state.py` and use it**

In `skills/orchestrator/scripts/orch_state.py`:

1. After `from pathlib import Path` add a blank line and `import orch_view`.
2. After the `SLUG_RE = ...` line add `EVENTS_SHOWN = 30`.
3. Replace `save` (lines 184-191) with:

```python
def save(slug, state, events):
    d = state_dir(slug)
    d.mkdir(parents=True, exist_ok=True)
    write_atomic(d / "state.json", json.dumps(state, indent=2) + "\n")
    with open(d / "events.log", "a") as f:
        for actor, event, details in events:
            f.write(f"{now()} {actor} {event} {details}".rstrip() + "\n")
    write_views(d, state)


def write_views(d, state):
    vm = view_model(state, read_events(d))
    write_atomic(d / "status.md", orch_view.render_md(vm))


def read_events(d, limit=EVENTS_SHOWN):
    """The last `limit` lines of events.log, newest first."""
    path = Path(d) / "events.log"
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines()[-limit:]:
        parts = line.split(" ", 3)
        if len(parts) < 3:
            continue
        out.append({"at": parts[0], "actor": parts[1], "event": parts[2],
                    "details": parts[3] if len(parts) > 3 else ""})
    return out[::-1]


def depths(goals):
    """Column per goal: the longest dependency path back to a goal with no dependencies."""
    memo = {}

    def depth(gid):
        if gid not in memo:
            memo[gid] = 0  # placeholder so a cycle in unvalidated state can't recurse forever
            deps = [d for d in goals[gid].get("depends_on", []) if d in goals]
            memo[gid] = 1 + max(depth(d) for d in deps) if deps else 0
        return memo[gid]

    return {gid: depth(gid) for gid in goals}


def view_model(state, events, problems=()):
    e = state["epic"]
    goals = state["goals"]
    ok = UNBLOCK.get(state["policy"].get("unblock_on"), UNBLOCK["done"])
    col = depths(goals)
    used = {}
    rows = {}
    for gid in goals:
        rows[gid] = used.get(col[gid], 0)
        used[col[gid]] = rows[gid] + 1
    return {
        "slug": e["slug"],
        "title": e.get("title") or e["slug"],
        "source": e.get("source"),
        "manager": state["manager"],
        "worker_prefix": state["worker_prefix"],
        "unblock_on": state["policy"].get("unblock_on"),
        "counts": [(s, sum(1 for g in goals.values() if g["status"] == s)) for s in STATES],
        "goals": [{"id": gid, "title": g["title"], "status": g["status"], "worker": g["worker"],
                   "pr": (g.get("handoff") or {}).get("pr"), "reason": g.get("reason"),
                   "depends_on": g["depends_on"], "col": col[gid], "row": rows[gid]}
                  for gid, g in goals.items()],
        "edges": [{"from": dep, "to": gid, "met": goals[dep]["status"] in ok}
                  for gid, g in goals.items() for dep in g["depends_on"] if dep in goals],
        "live_checked": state.get("live_checked"),
        "workers": [{"name": n, "current": w["current"], "history": w["history"],
                     "live": w.get("live"), "last_seen": w["last_seen"]}
                    for n, w in state["workers"].items()],
        "events": list(events),
        "problems": list(problems),
        "updated": now(),
    }
```

4. Delete the old `cell` and `render` functions (lines 194-237).
5. In `main`, replace `sys.stdout.write(render(load(a.slug)))` with `sys.stdout.write(orch_view.render_md(view_model(load(a.slug), [])))`.

- [ ] **Step 10: Run all tests**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -5`
Expected: all PASS (including `GoldenTests` and `ReadTests.test_show_renders_status`).

- [ ] **Step 11: Commit**

```bash
git add skills/orchestrator/scripts/orch_state.py skills/orchestrator/scripts/orch_view.py skills/orchestrator/templates/status.md.tmpl tests/test_orch_state.py
git commit -m "refactor: render status.md from a view model and template"
```

---

### Task 2: Epic HTML page, dependency graph and static `status.html`

**Files:**
- Create: `skills/orchestrator/templates/status.html.tmpl`
- Modify: `skills/orchestrator/scripts/orch_view.py` (append HTML renderers)
- Modify: `skills/orchestrator/scripts/orch_state.py` (`write_views`)
- Test: `tests/test_orch_state.py`

**Interfaces:**
- Consumes: `orch_state.view_model`, `orch_state.write_views`, `orch_view.template` (Task 1).
- Produces (all in `orch_view`):
  - `esc(value) -> str` (`None` → `""`)
  - `link(url, text=None) -> str` (only `http(s)://` become `<a>`; `None` → `"-"`)
  - `time_html(iso) -> str` (`<time datetime=…>`; falsy → `"-"`)
  - `progress_html(counts) -> str`
  - `problems_html(problems: list[str]) -> str` (`""` when empty; else `<div class="banner" role="alert">…`)
  - `graph_svg(vm) -> str`
  - `main_html(vm) -> str` (content of `<main>`)
  - `render_page(title: str, main: str, stream: str) -> str` (full document; `stream` `""` disables live updates)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_orch_state.py`:

```python
class HtmlTests(Base):
    def page(self, p=None):
        self.init(p)
        return (Path(self.tmp.name) / "demo" / "status.html").read_text()

    def main(self, p=None, problems=()):
        state = orch_state.init("demo", p or plan())
        return orch_view.main_html(orch_state.view_model(state, [], problems))

    def test_save_writes_status_html(self):
        page = self.page()
        self.assertIn('<tr id="goal-g1" data-goal="g1" data-status="ready">', page)
        self.assertIn('data-stream="/events/demo"', page)
        self.assertIn("<title>Demo epic</title>", page)

    def test_values_from_state_are_escaped(self):
        page = self.page(plan({"g1": {"title": "<script>alert(1)</script> & co", "summary": "x", "depends_on": []}}))
        self.assertNotIn("<script>alert", page)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co", page)

    def test_only_http_links(self):
        p = plan()
        p["epic"]["source"] = "javascript:alert(1)"
        page = self.page(p)
        self.assertNotIn('href="javascript', page)
        self.assertIn("Demo epic", page)

    def test_no_external_urls_without_links_in_state(self):
        page = self.page()
        self.assertNotIn("http://", page)
        self.assertNotIn("https://", page)

    def test_graph_has_one_node_per_goal_and_one_edge_per_dependency(self):
        main = self.main()
        self.assertEqual(main.count('class="node '), 4)
        self.assertEqual(main.count('<path class="edge '), 4)
        self.assertEqual(main.count('class="edge waiting"'), 4)
        self.assertIn('<a href="#goal-g4" class="node s-blocked" data-goal="g4" data-status="blocked">', main)

    def test_problems_banner(self):
        main = self.main(problems=["g1: invalid status weird"])
        self.assertIn('class="banner"', main)
        self.assertIn("g1: invalid status weird", main)
        self.assertNotIn('class="banner"', self.main())

    def test_events_are_listed_newest_first(self):
        self.init()
        self.run_cli("register", "demo", "demo-w-a")
        page = (Path(self.tmp.name) / "demo" / "status.html").read_text()
        self.assertLess(page.index("REGISTER"), page.index("INIT"))
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_orch_state.HtmlTests -v 2>&1 | tail -5`
Expected: FAIL / ERROR (`status.html` missing, `orch_view` has no attribute `main_html`).

- [ ] **Step 3: Create the page template**

Create `skills/orchestrator/templates/status.html.tmpl`. It must contain no `$` other than `$title`, `$stream` and `$main`.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$title</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #f7f7f5; --card: #ffffff; --fg: #1d1d1b; --muted: #6b6b66; --line: #e2e1dc; --edge: #9a9992;
  --s-blocked: #8a8a85; --s-blocked-bg: #ececea;
  --s-ready: #2f6fdb; --s-ready-bg: #e3edfc;
  --s-assigned: #b7791f; --s-assigned-bg: #fbf0dc;
  --s-needs-user: #d14343; --s-needs-user-bg: #fbe4e4;
  --s-in-review: #7c4dcc; --s-in-review-bg: #efe7fb;
  --s-done: #2f8f4e; --s-done-bg: #e2f3e7;
  --flash: #ffe58a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --card: #1f1f1d; --fg: #ecebe6; --muted: #a3a29b; --line: #34332f; --edge: #6f6e68;
    --s-blocked: #9b9b95; --s-blocked-bg: #2a2a28;
    --s-ready: #6ea2f5; --s-ready-bg: #1c2a42;
    --s-assigned: #e0a64a; --s-assigned-bg: #3a2c14;
    --s-needs-user: #f07171; --s-needs-user-bg: #3d1d1d;
    --s-in-review: #b08cf0; --s-in-review-bg: #2d2242;
    --s-done: #5cc27f; --s-done-bg: #18321f;
    --flash: #6b5a12;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.bar { display: flex; justify-content: space-between; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--muted); }
.bar a { color: inherit; }
#conn.live::before, #conn.down::before { content: "\25CF"; margin-right: 6px; }
#conn.live { color: var(--s-done); }
#conn.down { color: var(--s-needs-user); }
main { max-width: 1100px; margin: 0 auto; padding: 16px; }
h1 { font-size: 24px; margin: 8px 0; }
h1 a { color: inherit; }
h2 { font-size: 16px; margin: 28px 0 10px; }
.meta, .updated, .legend { color: var(--muted); font-size: 13px; margin: 4px 0; }
code { font-size: 12.5px; }
.s-blocked { --c: var(--s-blocked); --cb: var(--s-blocked-bg); }
.s-ready { --c: var(--s-ready); --cb: var(--s-ready-bg); }
.s-assigned { --c: var(--s-assigned); --cb: var(--s-assigned-bg); }
.s-needs-user { --c: var(--s-needs-user); --cb: var(--s-needs-user-bg); }
.s-in-review { --c: var(--s-in-review); --cb: var(--s-in-review-bg); }
.s-done { --c: var(--s-done); --cb: var(--s-done-bg); }
.progress { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--line); margin-top: 12px; }
.seg { height: 100%; background: var(--c); }
.badge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; color: var(--c); background: var(--cb); white-space: nowrap; }
.table, .graph { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; font-size: 12px; }
tr:last-child td { border-bottom: 0; }
td a { color: var(--s-ready); }
.graph svg { display: block; }
.node rect { fill: var(--cb); stroke: var(--c); stroke-width: 1.5; }
.node text { fill: var(--fg); font-size: 12px; }
.node .nid { font-weight: 600; }
.node .nworker { fill: var(--muted); font-size: 11px; }
.edge { fill: none; stroke: var(--edge); stroke-width: 1.5; }
.edge.waiting { stroke-dasharray: 5 4; }
.arrowhead { fill: var(--edge); }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; background: var(--s-blocked); }
.dot.live { background: var(--s-done); }
.dot.gone { background: var(--s-needs-user); }
.events { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.events li { padding: 5px 0; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.events time { color: var(--muted); display: inline-block; min-width: 90px; }
.banner { background: var(--s-needs-user-bg); border: 1px solid var(--s-needs-user); border-radius: 8px; padding: 10px 14px; margin: 8px 0 16px; }
.banner ul { margin: 4px 0 0; padding-left: 20px; }
.empty { color: var(--muted); }
.cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.card { display: block; padding: 14px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; color: inherit; text-decoration: none; }
.card:hover { border-color: var(--edge); }
.card h2 { margin: 0 0 4px; font-size: 16px; }
tr.flash td, .node.flash rect { animation: flash 2s ease-out; }
@keyframes flash { from { background-color: var(--flash); fill: var(--flash); } }
</style>
</head>
<body data-stream="$stream">
<div class="bar"><a id="home" href="/">All orchestrations</a><span id="conn"></span></div>
<main>$main</main>
<script>
(function () {
  var conn = document.getElementById("conn");
  function ago(iso) {
    var s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (isNaN(s)) return iso;
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }
  function times() {
    document.querySelectorAll("time[datetime]").forEach(function (t) {
      t.textContent = ago(t.getAttribute("datetime"));
    });
  }
  function statuses() {
    var m = {};
    document.querySelectorAll("main [data-goal]").forEach(function (el) {
      m[el.tagName + ":" + el.dataset.goal] = el.dataset.status;
    });
    return m;
  }
  function swap(html) {
    var before = statuses();
    document.querySelector("main").innerHTML = html;
    document.querySelectorAll("main [data-goal]").forEach(function (el) {
      if (before[el.tagName + ":" + el.dataset.goal] !== el.dataset.status) el.classList.add("flash");
    });
    times();
  }
  times();
  setInterval(times, 30000);
  if (location.protocol === "file:") {
    conn.textContent = "static file, reloads every 3 s";
    document.getElementById("home").hidden = true;
    setTimeout(function () { location.reload(); }, 3000);
    return;
  }
  var stream = document.body.dataset.stream;
  if (!stream) return;
  var es = new EventSource(stream);
  es.onmessage = function (e) {
    conn.textContent = "live";
    conn.className = "live";
    swap(e.data);
  };
  es.onerror = function () {
    conn.textContent = "reconnecting\u2026";
    conn.className = "down";
  };
})();
</script>
</body>
</html>
```

- [ ] **Step 4: Append the HTML renderers to `orch_view.py`**

Add `import html` above `import string`. Append:

```python
NODE_W, NODE_H, GAP_X, GAP_Y, PAD = 200, 58, 72, 16, 8
LIVE = {True: "live", False: "gone", None: "unknown"}


def esc(value):
    return html.escape("" if value is None else str(value), quote=True)


def link(url, text=None):
    if not url:
        return "-"
    u = str(url)
    if u.startswith(("http://", "https://")):
        return f'<a href="{esc(u)}">{esc(text or u)}</a>'
    return esc(text or u)


def pr_label(url):
    tail = str(url).rstrip("/").rsplit("/", 1)[-1]
    return f"#{tail}" if "/pull/" in str(url) and tail.isdigit() else str(url)


def time_html(iso):
    if not iso:
        return "-"
    return f'<time datetime="{esc(iso)}" title="{esc(iso)}">{esc(iso)}</time>'


def badge(status):
    return f'<span class="badge s-{esc(status)}">{esc(status)}</span>'


def progress_html(counts):
    total = sum(n for _, n in counts) or 1
    segs = "".join(
        f'<span class="seg s-{esc(s)}" style="width:{n * 100 / total:.2f}%" title="{n} {esc(s)}"></span>'
        for s, n in counts if n)
    legend = ", ".join(f"{n} {esc(s)}" for s, n in counts if n)
    return f'<div class="progress" role="img" aria-label="{legend}">{segs}</div><p class="legend">{legend}</p>'


def problems_html(problems):
    if not problems:
        return ""
    items = "".join(f"<li>{esc(p)}</li>" for p in problems)
    return f'<div class="banner" role="alert"><strong>Problems</strong><ul>{items}</ul></div>'


def short(text, n=28):
    text = str(text or "")
    return text if len(text) <= n else text[: n - 1] + "…"


def node_xy(g):
    return PAD + g["col"] * (NODE_W + GAP_X), PAD + g["row"] * (NODE_H + GAP_Y)


def graph_svg(vm):
    goals = vm["goals"]
    if not goals:
        return '<p class="empty">No goals.</p>'
    pos = {g["id"]: node_xy(g) for g in goals}
    width = PAD * 2 + (max(g["col"] for g in goals) + 1) * (NODE_W + GAP_X) - GAP_X
    height = PAD * 2 + (max(g["row"] for g in goals) + 1) * (NODE_H + GAP_Y) - GAP_Y
    edges = []
    for e in vm["edges"]:
        x1, y1 = pos[e["from"]]
        x2, y2 = pos[e["to"]]
        x1, y1, y2 = x1 + NODE_W, y1 + NODE_H / 2, y2 + NODE_H / 2
        mid = (x1 + x2) / 2
        cls = "edge met" if e["met"] else "edge waiting"
        edges.append(f'<path class="{cls}" d="M{x1:g},{y1:g} C{mid:g},{y1:g} {mid:g},{y2:g} {x2 - 2:g},{y2:g}" marker-end="url(#arrow)"/>')
    nodes = []
    for g in goals:
        x, y = pos[g["id"]]
        gid, status = esc(g["id"]), esc(g["status"])
        nodes.append(
            f'<a href="#goal-{gid}" class="node s-{status}" data-goal="{gid}" data-status="{status}">'
            f'<title>{gid}: {esc(g["title"])}</title>'
            f'<rect x="{x}" y="{y}" width="{NODE_W}" height="{NODE_H}" rx="8"/>'
            f'<text x="{x + 10}" y="{y + 18}" class="nid">{gid} · {status}</text>'
            f'<text x="{x + 10}" y="{y + 35}">{esc(short(g["title"]))}</text>'
            f'<text x="{x + 10}" y="{y + 50}" class="nworker">{esc(g["worker"] or "unassigned")}</text></a>')
    return (
        f'<div class="graph"><svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Dependency graph">'
        '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        '<path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>'
        + "".join(edges) + "".join(nodes) + "</svg></div>"
    )


def main_html(vm):
    title = link(vm["source"], vm["title"]) if vm["source"] else esc(vm["title"])
    goal_rows = "".join(
        f'<tr id="goal-{esc(g["id"])}" data-goal="{esc(g["id"])}" data-status="{esc(g["status"])}">'
        f'<td>{esc(g["id"])}</td><td>{esc(g["title"])}</td><td>{badge(g["status"])}</td>'
        f'<td>{esc(g["worker"] or "-")}</td><td>{link(g["pr"], pr_label(g["pr"]) if g["pr"] else None)}</td>'
        f'<td>{esc(g["reason"] or "")}</td></tr>'
        for g in vm["goals"])
    worker_rows = "".join(
        f'<tr><td>{esc(w["name"])}</td><td>{esc(w["current"] or "-")}</td>'
        f'<td>{esc(", ".join(w["history"]) or "-")}</td>'
        f'<td><span class="dot {LIVE.get(w["live"], "unknown")}"></span>{LIVE.get(w["live"], "unknown")}</td>'
        f'<td>{time_html(w["last_seen"])}</td></tr>'
        for w in vm["workers"]) or '<tr><td colspan="5" class="empty">No workers yet.</td></tr>'
    events = "".join(
        f'<li>{time_html(e["at"])} <b>{esc(e["actor"])}</b> <code>{esc(e["event"])}</code> {esc(e["details"])}</li>'
        for e in vm["events"]) or '<li class="empty">No events yet.</li>'
    checked = time_html(vm["live_checked"]) if vm["live_checked"] else "never"
    return (
        problems_html(vm["problems"])
        + f'<header><h1>{title}</h1>'
        + f'<p class="meta">Slug <code>{esc(vm["slug"])}</code> · Manager <code>{esc(vm["manager"])}</code> · '
        + f'Workers <code>{esc(vm["worker_prefix"])}*</code> · '
        + f'Dependents start when dependencies are <code>{esc(vm["unblock_on"])}</code></p>'
        + progress_html(vm["counts"])
        + f'<p class="updated">Last updated {time_html(vm["updated"])}</p></header>'
        + f'<section><h2>Dependencies</h2>{graph_svg(vm)}</section>'
        + '<section><h2>Goals</h2><div class="table"><table><thead><tr><th>Goal</th><th>Title</th>'
        + '<th>Status</th><th>Worker</th><th>PR</th><th>Reason</th></tr></thead>'
        + f'<tbody>{goal_rows}</tbody></table></div></section>'
        + f'<section><h2>Workers</h2><p class="meta">Liveness checked {checked}</p>'
        + '<div class="table"><table><thead><tr><th>Worker</th><th>Current goal</th><th>Done so far</th>'
        + '<th>Live</th><th>Last seen</th></tr></thead>'
        + f'<tbody>{worker_rows}</tbody></table></div></section>'
        + f'<section><h2>Recent events</h2><ol class="events">{events}</ol></section>'
    )


def render_page(title, main, stream):
    return template("status.html.tmpl").substitute(title=esc(title), main=main, stream=esc(stream))
```

- [ ] **Step 5: Write `status.html` on every save**

In `orch_state.py`, change `write_views` to:

```python
def write_views(d, state):
    vm = view_model(state, read_events(d))
    write_atomic(d / "status.md", orch_view.render_md(vm))
    page = orch_view.render_page(vm["title"], orch_view.main_html(vm), f"/events/{vm['slug']}")
    write_atomic(d / "status.html", page)
```

- [ ] **Step 6: Run all tests**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -5`
Expected: all PASS.

- [ ] **Step 7: Look at the static page once**

```bash
export ORCH_ROOT=$(mktemp -d)
python3 - "$ORCH_ROOT/plan.json" <<'EOF'
import json, sys
json.dump({"epic": {"slug": "demo", "title": "Demo epic", "source": None}, "manager": "demo-manager",
           "worker_prefix": "demo-w-", "policy": {"unblock_on": "done"}, "board": None,
           "goals": {"g1": {"title": "Base", "summary": "s", "depends_on": []},
                     "g2": {"title": "Left", "summary": "s", "depends_on": ["g1"]},
                     "g3": {"title": "Right", "summary": "s", "depends_on": ["g1"]},
                     "g4": {"title": "Join", "summary": "s", "depends_on": ["g2", "g3"]}}},
          open(sys.argv[1], "w"))
EOF
python3 skills/orchestrator/scripts/orch_state.py init demo --plan "$ORCH_ROOT/plan.json"
open "$ORCH_ROOT/demo/status.html"
```

Expected: the page shows four nodes in three columns with dashed arrows, both tables, one INIT event, and "static file, reloads every 3 s" in the top bar. Report what you see; do not proceed if the page is blank or unstyled.

- [ ] **Step 8: Commit**

```bash
git add skills/orchestrator/scripts/orch_state.py skills/orchestrator/scripts/orch_view.py skills/orchestrator/templates/status.html.tmpl tests/test_orch_state.py
git commit -m "feat: write status.html with dependency graph"
```

---

### Task 3: Live server with index page and SSE

**Files:**
- Create: `skills/orchestrator/scripts/orch_serve.py`
- Modify: `skills/orchestrator/scripts/orch_view.py` (append `index_main_html`)
- Create: `tests/test_orch_serve.py`

**Interfaces:**
- Consumes: `orch_state.root`, `SLUG_RE`, `validate`, `view_model`, `read_events`; `orch_view.render_page`, `main_html`, `problems_html`, `progress_html`, `time_html`, `esc`.
- Produces:
  - `orch_view.index_main_html(cards: list[dict], root: str) -> str`; each card is a view model, or `{"slug","title","error","counts":[],"workers":[],"events":[]}` for an unreadable epic.
  - `orch_serve.health() -> dict` `{"app": "orch_state", "pid": int, "root": str}`
  - `orch_serve.StatusServer(port: int)`: a `ThreadingHTTPServer` on `127.0.0.1`, with `closing: threading.Event`, `epic_exists(slug)`, `epic_view(slug) -> (title, main)`, `index_main() -> str`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_orch_serve.py`:

```python
import json
import os
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_orch_state import Base  # noqa: E402

import orch_serve  # noqa: E402
import orch_view  # noqa: E402


class ServerTests(Base):
    def setUp(self):
        super().setUp()
        self.init()
        self.server = orch_serve.StatusServer(0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.stop_server)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def stop_server(self):
        self.server.closing.set()
        self.server.shutdown()
        self.server.server_close()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def read_event(self, resp):
        lines = []
        while True:
            line = resp.readline().decode()
            if line.startswith("data: "):
                lines.append(line[len("data: "):].rstrip("\n"))
            elif line == "\n" and lines:
                return "\n".join(lines)
            elif line == "":
                raise AssertionError("stream closed")

    def test_healthz(self):
        code, body = self.get("/healthz")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), {"app": "orch_state", "pid": os.getpid(), "root": self.tmp.name})

    def test_index_lists_epics(self):
        code, page = self.get("/")
        self.assertEqual(code, 200)
        self.assertIn('href="/demo"', page)
        self.assertIn("Demo epic", page)
        self.assertIn('data-stream="/events"', page)

    def test_epic_page(self):
        code, page = self.get("/demo")
        self.assertEqual(code, 200)
        self.assertIn('data-goal="g1" data-status="ready"', page)
        self.assertIn('data-stream="/events/demo"', page)

    def test_unknown_or_unsafe_paths_are_404(self):
        for path in ("/nope", "/..%2f..%2fetc%2fpasswd", "/events/nope", "/demo/", "/events/..%2fdemo"):
            code, _ = self.get(path)
            self.assertEqual(code, 404, path)

    def test_stream_pushes_on_save(self):
        resp = urllib.request.urlopen(self.base + "/events/demo", timeout=5)
        self.addCleanup(resp.close)
        self.assertIn('data-status="ready"', self.read_event(resp))
        self.run_cli("register", "demo", "demo-w-a")
        start = time.monotonic()
        second = self.read_event(resp)
        self.assertLess(time.monotonic() - start, 2)
        self.assertIn("demo-w-a", second)

    def test_index_stream_sends_current_render(self):
        resp = urllib.request.urlopen(self.base + "/events", timeout=5)
        self.addCleanup(resp.close)
        self.assertIn('href="/demo"', self.read_event(resp))

    def test_corrupt_state_keeps_last_good_render(self):
        self.get("/demo")
        (Path(self.tmp.name) / "demo" / "state.json").write_text("{not json")
        code, page = self.get("/demo")
        self.assertEqual(code, 200)
        self.assertIn("state.json unreadable", page)
        self.assertIn('data-goal="g1"', page)

    def test_validation_problems_are_shown(self):
        path = Path(self.tmp.name) / "demo" / "state.json"
        state = json.loads(path.read_text())
        state["goals"]["g1"]["status"] = "weird"
        path.write_text(json.dumps(state))
        code, page = self.get("/demo")
        self.assertEqual(code, 200)
        self.assertIn("g1: invalid status weird", page)


class IndexHtmlTests(unittest.TestCase):
    def test_empty_index(self):
        self.assertIn("No orchestrations under <code>/x</code>", orch_view.index_main_html([], "/x"))

    def test_cards_sorted_by_last_event(self):
        def card(slug, at):
            return {"slug": slug, "title": slug.upper(), "counts": [("ready", 1)], "workers": [],
                    "events": [{"at": at, "actor": "m", "event": "E", "details": ""}]}
        out = orch_view.index_main_html([card("old", "2026-10-25T00:00:00Z"), card("new", "2026-10-26T00:00:00Z")], "/x")
        self.assertLess(out.index('href="/new"'), out.index('href="/old"'))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_orch_serve -v 2>&1 | tail -5`
Expected: ERROR `ModuleNotFoundError: No module named 'orch_serve'`.

- [ ] **Step 3: Append the index renderer to `orch_view.py`**

```python
def index_main_html(cards, root):
    if not cards:
        return f'<h1>Orchestrations</h1><p class="empty">No orchestrations under <code>{esc(root)}</code>.</p>'

    def last(c):
        return c["events"][0]["at"] if c["events"] else ""

    out = []
    for c in sorted(cards, key=last, reverse=True):
        active = sum(1 for w in c["workers"] if w["current"])
        when = time_html(last(c)) if last(c) else "none yet"
        err = problems_html([c["error"]]) if c.get("error") else ""
        bar = progress_html(c["counts"]) if c["counts"] else ""
        out.append(
            f'<a class="card" href="/{esc(c["slug"])}"><h2>{esc(c["title"])}</h2>'
            f'<p class="meta"><code>{esc(c["slug"])}</code> · {active} active worker{"" if active == 1 else "s"} · last event {when}</p>'
            f"{err}{bar}</a>")
    return '<h1>Orchestrations</h1><div class="cards">' + "".join(out) + "</div>"
```

- [ ] **Step 4: Create `orch_serve.py`**

```python
"""Live status server for the orchestrator. Run it through `orch_state.py serve`.

Pages are rendered fresh from the state directory on each request. Server-Sent Event
streams poll the files' mtimes and push the re-rendered <main> when they change.
"""
import http.server
import json
import os
import threading
from urllib.parse import unquote, urlsplit

import orch_state
import orch_view

POLL = 0.5
KEEPALIVE = 15


def health():
    return {"app": "orch_state", "pid": os.getpid(), "root": str(orch_state.root())}


def stamp(path):
    try:
        st = os.stat(path)
        return st.st_mtime_ns, st.st_size
    except FileNotFoundError:
        return None


class StatusServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port):
        super().__init__(("127.0.0.1", port), Handler)
        self.closing = threading.Event()
        self.lock = threading.Lock()
        self.last_good = {}

    def epic_exists(self, slug):
        return bool(orch_state.SLUG_RE.match(slug)) and (orch_state.root() / slug / "state.json").is_file()

    def epics(self):
        r = orch_state.root()
        return sorted(p.name for p in r.iterdir() if self.epic_exists(p.name)) if r.is_dir() else []

    def epic_signature(self, slug):
        d = orch_state.root() / slug
        return stamp(d / "state.json"), stamp(d / "events.log")

    def index_signature(self):
        return tuple((slug,) + self.epic_signature(slug) for slug in self.epics())

    def epic_view(self, slug):
        d = orch_state.root() / slug
        try:
            state = json.loads((d / "state.json").read_text())
            vm = orch_state.view_model(state, orch_state.read_events(d), orch_state.validate(state))
            view = (vm["title"], orch_view.main_html(vm))
        except Exception as e:  # unreadable or malformed state: keep showing the last good page
            with self.lock:
                title, main = self.last_good.get(slug, (slug, ""))
            return title, orch_view.problems_html([f"state.json unreadable: {e}"]) + main
        with self.lock:
            self.last_good[slug] = view
        return view

    def index_main(self):
        cards = []
        for slug in self.epics():
            d = orch_state.root() / slug
            try:
                state = json.loads((d / "state.json").read_text())
                cards.append(orch_state.view_model(state, orch_state.read_events(d, limit=1)))
            except Exception as e:  # show the epic with its error instead of hiding it
                cards.append({"slug": slug, "title": slug, "error": f"state.json unreadable: {e}",
                              "counts": [], "workers": [], "events": []})
        return orch_view.index_main_html(cards, str(orch_state.root()))


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # one line per poll would flood server.log

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        srv = self.server
        if path == "/healthz":
            return self.send_body(200, "application/json", json.dumps(health()))
        if path == "/":
            return self.send_page("Orchestrations", srv.index_main(), "/events")
        if path == "/events":
            return self.stream(srv.index_signature, srv.index_main)
        if path.startswith("/events/"):
            slug = path[len("/events/"):]
            if srv.epic_exists(slug):
                return self.stream(lambda: srv.epic_signature(slug), lambda: srv.epic_view(slug)[1])
        elif srv.epic_exists(path[1:]):
            title, main = srv.epic_view(path[1:])
            return self.send_page(title, main, f"/events/{path[1:]}")
        self.send_body(404, "text/html; charset=utf-8",
                       orch_view.render_page("Not found", '<p class="empty">No such orchestration.</p>', ""))

    def send_page(self, title, main, stream):
        self.send_body(200, "text/html; charset=utf-8", orch_view.render_page(title, main, stream))

    def send_body(self, code, ctype, text):
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def stream(self, signature, render):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        last, idle = object(), 0.0
        try:
            self.wfile.write(b"retry: 2000\n\n")
            while not self.server.closing.is_set():
                sig = signature()
                if sig != last:
                    last, idle = sig, 0.0
                    data = "".join(f"data: {line}\n" for line in render().split("\n")) + "\n"
                    self.wfile.write(data.encode())
                    self.wfile.flush()
                elif idle >= KEEPALIVE:
                    idle = 0.0
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                self.server.closing.wait(POLL)
                idle += POLL
        except (BrokenPipeError, ConnectionResetError):
            pass  # the browser went away; it reconnects on its own
```

- [ ] **Step 5: Run all tests**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -5`
Expected: all PASS. If `test_stream_pushes_on_save` is flaky, report it with the output instead of raising timeouts.

- [ ] **Step 6: Commit**

```bash
git add skills/orchestrator/scripts/orch_serve.py skills/orchestrator/scripts/orch_view.py tests/test_orch_serve.py
git commit -m "feat: serve live status pages over SSE"
```

---

### Task 4: `serve` CLI with `--ensure` and `--stop`

**Files:**
- Modify: `skills/orchestrator/scripts/orch_serve.py` (append lifecycle functions)
- Modify: `skills/orchestrator/scripts/orch_state.py` (`build_parser`, `main`, `__main__` block, module docstring)
- Test: `tests/test_orch_serve.py`

**Interfaces:**
- Consumes: `orch_serve.StatusServer`, `health` (Task 3); `orch_state.write_atomic`, `OrchError`, `root`.
- Produces:
  - `orch_serve.probe(port) -> dict | None`: `/healthz` JSON, `{}` if something else answers, `None` if nothing listens.
  - `orch_serve.running() -> dict | None`: the `.server.json` record `{"pid", "port"}` if that server answers as ours.
  - `orch_serve.ensure(port) -> {"url", "started", "pid"}`; raises `OrchError` on a foreign port or start timeout.
  - `orch_serve.stop() -> {"stopped": bool, ...}`
  - `orch_serve.serve(port) -> None` (foreground; writes and removes `.server.json`).
  - CLI: `orch_state.py serve [--port N] [--ensure | --stop]` (no slug). `--ensure` and `--stop` print JSON; errors print `{"error": ...}` and exit 2.

- [ ] **Step 1: Write the failing tests**

Add these imports to the top of `tests/test_orch_serve.py`: `import http.server`, `import socket`, `import subprocess`. Add after the imports:

```python
SCRIPT = Path(__file__).resolve().parents[1] / "skills" / "orchestrator" / "scripts" / "orch_state.py"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
```

Append before `if __name__ == "__main__":`:

```python
class LifecycleTests(Base):
    def setUp(self):
        super().setUp()
        self.port = str(free_port())
        self.addCleanup(self.cli, "--stop")

    def cli(self, *args):
        r = subprocess.run([sys.executable, str(SCRIPT), "serve", *args],
                           capture_output=True, text=True, timeout=20, env=os.environ.copy())
        return r.returncode, json.loads(r.stdout)

    def test_ensure_twice_reuses_one_server(self):
        code, first = self.cli("--ensure", "--port", self.port)
        self.assertEqual(code, 0, first)
        self.assertTrue(first["started"])
        self.assertEqual(first["url"], f"http://127.0.0.1:{self.port}/")
        code, second = self.cli("--ensure", "--port", self.port)
        self.assertEqual(code, 0, second)
        self.assertFalse(second["started"])
        self.assertEqual(second["pid"], first["pid"])

    def test_concurrent_ensure_starts_one_server(self):
        cmd = [sys.executable, str(SCRIPT), "serve", "--ensure", "--port", self.port]
        procs = [subprocess.Popen(cmd, stdout=subprocess.PIPE, text=True) for _ in range(2)]
        outs = [json.loads(p.communicate(timeout=20)[0]) for p in procs]
        self.assertEqual(outs[0]["pid"], outs[1]["pid"])
        self.assertEqual(sorted(o["started"] for o in outs), [False, True])

    def test_stale_server_file_is_replaced(self):
        (Path(self.tmp.name) / ".server.json").write_text(json.dumps({"pid": 999999, "port": int(self.port)}))
        code, out = self.cli("--ensure", "--port", self.port)
        self.assertEqual(code, 0, out)
        self.assertTrue(out["started"])
        self.assertNotEqual(out["pid"], 999999)

    def test_stop_removes_server_file(self):
        self.cli("--ensure", "--port", self.port)
        code, out = self.cli("--stop")
        self.assertEqual(code, 0, out)
        self.assertTrue(out["stopped"])
        self.assertFalse((Path(self.tmp.name) / ".server.json").exists())
        self.assertIsNone(orch_serve.probe(int(self.port)))

    def test_stop_without_server(self):
        code, out = self.cli("--stop")
        self.assertEqual(code, 0, out)
        self.assertFalse(out["stopped"])

    def test_foreign_port_is_refused(self):
        class Quiet(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
        foreign = http.server.HTTPServer(("127.0.0.1", 0), Quiet)
        threading.Thread(target=foreign.serve_forever, daemon=True).start()
        self.addCleanup(foreign.server_close)
        self.addCleanup(foreign.shutdown)
        code, out = self.cli("--ensure", "--port", str(foreign.server_address[1]))
        self.assertEqual(code, 2)
        self.assertIn("in use by another program", out["error"])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_orch_serve.LifecycleTests -v 2>&1 | tail -5`
Expected: FAIL / ERROR (argparse rejects `serve`, so stdout is empty and `json.loads` raises).

- [ ] **Step 3: Append lifecycle functions to `orch_serve.py`**

Change the imports at the top of `orch_serve.py` to:

```python
import fcntl
import http.client
import http.server
import json
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlsplit
```

Append:

```python
START_TIMEOUT = 5


def server_file():
    return orch_state.root() / ".server.json"


def url(rec):
    return f"http://127.0.0.1:{rec['port']}/"


def probe(port):
    """/healthz JSON from 127.0.0.1:port; {} if something else answers; None if nothing listens."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1) as r:
            return json.loads(r.read().decode())
    except (urllib.error.HTTPError, http.client.HTTPException, ValueError):
        return {}
    except OSError:
        return None


def ours(info):
    return bool(info) and info.get("app") == "orch_state" and info.get("root") == str(orch_state.root())


def running():
    """The recorded server if it still answers as ours, else None."""
    try:
        rec = json.loads(server_file().read_text())
    except (OSError, ValueError):
        return None
    info = probe(rec.get("port"))
    return rec if ours(info) and info.get("pid") == rec.get("pid") else None


def ensure(port):
    r = orch_state.root()
    r.mkdir(parents=True, exist_ok=True)
    rec = running()
    if rec:
        return {"url": url(rec), "started": False, "pid": rec["pid"]}
    with open(r / ".server.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)  # released when the file closes
        rec = running()  # another caller may have started it while we waited
        if rec:
            return {"url": url(rec), "started": False, "pid": rec["pid"]}
        server_file().unlink(missing_ok=True)
        info = probe(port)
        if info is not None and not ours(info):
            raise orch_state.OrchError(f"port {port} is in use by another program; pass --port")
        with open(r / "server.log", "a") as log:
            subprocess.Popen([sys.executable, str(Path(orch_state.__file__).resolve()), "serve", "--port", str(port)],
                             stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + START_TIMEOUT
        while time.monotonic() < deadline:
            rec = running()
            if rec:
                return {"url": url(rec), "started": True, "pid": rec["pid"]}
            time.sleep(0.1)
    raise orch_state.OrchError(f"server did not start on port {port}; see {r / 'server.log'}")


def stop():
    rec = running()
    if not rec:
        server_file().unlink(missing_ok=True)
        return {"stopped": False, "reason": "no server running"}
    os.kill(rec["pid"], signal.SIGTERM)
    deadline = time.monotonic() + START_TIMEOUT
    while time.monotonic() < deadline and probe(rec["port"]) is not None:
        time.sleep(0.1)
    server_file().unlink(missing_ok=True)
    return {"stopped": True, "pid": rec["pid"]}


def serve(port):
    orch_state.root().mkdir(parents=True, exist_ok=True)
    server = StatusServer(port)
    rec = {"pid": os.getpid(), "port": server.server_address[1]}
    orch_state.write_atomic(server_file(), json.dumps(rec) + "\n")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    print(f"serving {url(rec)}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.closing.set()
        server.server_close()
        try:
            if json.loads(server_file().read_text()).get("pid") == os.getpid():
                server_file().unlink()
        except (OSError, ValueError):
            pass
```

- [ ] **Step 4: Wire the `serve` command into `orch_state.py`**

1. In the module docstring, after the `Usage:` line add:

```
       orch_state.py serve [--port N] [--ensure | --stop]
```

2. In `build_parser`, before `return p`, add:

```python
    sp = sub.add_parser("serve", help="live status pages for every orchestration")
    sp.add_argument("--port", type=int, default=8765)
    mode = sp.add_mutually_exclusive_group()
    mode.add_argument("--ensure", action="store_true", help="start in the background unless already running")
    mode.add_argument("--stop", action="store_true", help="stop the background server")
```

3. In `main`, make the first branch inside `try:`:

```python
        if a.cmd == "serve":
            import orch_serve  # only serve needs the http and process machinery
            if not (a.ensure or a.stop):
                orch_serve.serve(a.port)
                return 0
            out = orch_serve.ensure(a.port) if a.ensure else orch_serve.stop()
        elif a.cmd == "init":
```

(the existing `if a.cmd == "init":` becomes `elif`).

4. Replace the `__main__` block with:

```python
if __name__ == "__main__":
    # let orch_serve's `import orch_state` reuse this module instead of loading a second copy
    sys.modules.setdefault("orch_state", sys.modules["__main__"])
    sys.exit(main())
```

- [ ] **Step 5: Run all tests**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -5`
Expected: all PASS. Afterwards check no test server is left: `pgrep -fl "orch_state.py serve"` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add skills/orchestrator/scripts/orch_serve.py skills/orchestrator/scripts/orch_state.py tests/test_orch_serve.py
git commit -m "feat: add serve --ensure and --stop"
```

---

### Task 5: Manager skill, README and end-to-end check

**Files:**
- Modify: `skills/orchestrator/SKILL.md` (file list, rule 4, Resume, New orchestration step 6, status row)
- Modify: `README.md` (usage step 4, new "Live status page" section)

**Interfaces:**
- Consumes: CLI `orch_state.py serve --ensure` → `{"url": "http://127.0.0.1:<port>/", "started": bool, "pid": int}` or `{"error": ...}` (Task 4).

- [ ] **Step 1: Update `skills/orchestrator/SKILL.md`**

1. In the file list after the `scripts/orch_state.py` bullet, add:

```markdown
- `scripts/orch_view.py`, `scripts/orch_serve.py`, `templates/`: the status pages behind
  `$ORCH serve`. You never call them directly.
```

2. Rule 4: change `Never edit state.json, status.md or events.log by hand.` to `Never edit state.json, status.md, status.html or events.log by hand.`

3. In **Resume**, add a step 5:

```markdown
5. `$ORCH serve --ensure` and give the user `<url><slug>` as the live status page. If it
   returns an error, tell the user, offer `~/.claude-orchestrator/<slug>/status.html`
   instead, and carry on: the page never blocks orchestration.
```

4. In **New orchestration** step 6, after the `$ORCH init` bullet, add:

```markdown
   - run `$ORCH serve --ensure` and include `<url><slug>` in your message; on error, handle
     it as in Resume step 5;
```

5. In the user-commands table row starting `| status / what's X doing |`, append to the action cell: ` Mention the live page URL from \`$ORCH serve --ensure\`.`

- [ ] **Step 2: Update `README.md`**

Change usage step 4's second line from `(\`status.md\` is the readable view).` to:

```markdown
   (`status.md` is the readable view; the manager also gives you a live page).
```

Add a section after the usage list:

```markdown
## Live status page

The manager starts a small local server the first time you create or resume an
orchestration, and gives you its URL (default `http://127.0.0.1:8765/`). The index lists
every orchestration; each one has a page with its dependency graph, goals, workers and
recent events, updated within a second of each change.

    python3 skills/orchestrator/scripts/orch_state.py serve --ensure   # start if needed
    python3 skills/orchestrator/scripts/orch_state.py serve --stop     # stop it

Without the server, open `~/.claude-orchestrator/<slug>/status.html`; it reloads every
3 seconds.
```

- [ ] **Step 3: End-to-end check in a browser**

```bash
export ORCH_ROOT=$(mktemp -d)
ORCH="python3 skills/orchestrator/scripts/orch_state.py"
python3 - "$ORCH_ROOT/plan.json" <<'EOF'
import json, sys
json.dump({"epic": {"slug": "demo", "title": "Demo epic", "source": None}, "manager": "demo-manager",
           "worker_prefix": "demo-w-", "policy": {"unblock_on": "done"}, "board": None,
           "goals": {"g1": {"title": "Base", "summary": "s", "depends_on": []},
                     "g2": {"title": "Left", "summary": "s", "depends_on": ["g1"]},
                     "g3": {"title": "Right", "summary": "s", "depends_on": ["g1"]},
                     "g4": {"title": "Join", "summary": "s", "depends_on": ["g2", "g3"]}}},
          open(sys.argv[1], "w"))
EOF
$ORCH init demo --plan "$ORCH_ROOT/plan.json"
$ORCH serve --ensure --port 8799
open http://127.0.0.1:8799/demo
```

Then, with the page visible, run one command at a time and confirm each change appears within about a second and the changed row and node flash:

```bash
$ORCH register demo demo-w-a
$ORCH request demo demo-w-a
$ORCH done demo demo-w-a g1 --pr https://github.com/o/r/pull/1 --notes "ok"
$ORCH approve demo g1
```

Also check: the index at `http://127.0.0.1:8799/` lists the epic; dark mode (System Settings → Appearance) recolours the page; at a ~380 px window width the page doesn't scroll sideways (the graph scrolls inside its box). Finish with `$ORCH serve --stop`. Report what you saw, including anything that looked wrong.

- [ ] **Step 4: Run all tests one last time**

Run: `python3 -m unittest discover -s tests -v 2>&1 | tail -5`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/orchestrator/SKILL.md README.md
git commit -m "docs: start the live status page from the manager skill"
```
