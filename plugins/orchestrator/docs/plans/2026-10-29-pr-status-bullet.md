# PR status bullet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The live status page shows a coloured bullet after each PR link (green, yellow, red, purple for merged, grey for unknown) computed from GitHub through `gh`.

**Architecture:** A new stdlib-only module `orch_prs.py` classifies the JSON of `gh pr view` and keeps a `HealthCache` fresh from a background thread owned by the status server. `orch_view` takes an optional health map and draws the bullets. The server passes its cache snapshot into the epic page and adds the cache version to the stream signature so open pages update. State, protocol and skills do not change.

**Tech Stack:** Python 3 stdlib, `unittest`, the `gh` CLI at runtime (optional).

**Spec:** `plugins/orchestrator/docs/specs/2026-10-29-pr-status-bullet-design.md`

## Global Constraints

- Bullet classes: `h-green`, `h-yellow`, `h-red`, `h-merged`, `h-unknown`; reasons exactly: `ready to merge`, `waiting on review`, `checks running`, `draft`, `checks failing`, `changes requested`, `merge conflict`, `closed without merging`, `merged`, `status unavailable`.
- `classify` precedence (first match wins): merged, closed, failed check, changes requested, conflicting, draft, pending check, review required, green.
- Only `https://github.com/<owner>/<repo>/pull/<n>` URLs are ever passed to `gh`, as an argument list with `--repo`, no shell, 10 s timeout. `owner` and `repo` start with a letter or digit.
- Cache: refetch non-final results after 60 s; final results (merged, closed) are never refetched; every failure maps to `("unknown", "status unavailable")`.
- `ORCH_PR_STATUS=off` makes every bullet grey and runs no `gh`.
- `status.md` and the static `status.html` stay offline: no bullets.
- Colour is never the only signal: every dot has `role="img"`, `aria-label` and `title` with the reason.
- Public repo: fictional data only (`acme/recipe-site`, `example`), no machine paths, no private names.
- All paths below are relative to `plugins/orchestrator/`.
- Run tests from `plugins/orchestrator`: `python3 -m unittest discover -s tests`.
- Commits: `git commit -S -s`, message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: `orch_prs.py` — parse, classify, cache

**Files:**
- Create: `skills/orchestrator/scripts/orch_prs.py`
- Test: `tests/test_orch_prs.py`

**Interfaces:**
- Produces: `parse_pr(url) -> (owner, repo, number_str) | None`; `classify(info: dict) -> (health, reason)`; `HealthCache(runner=subprocess.run, clock=time.monotonic, enabled=None)` with `.track(key, urls)`, `.refresh_due() -> int`, `.snapshot() -> dict[url, (health, reason)]`, `.version: int`, `.tracked: dict[str, set[str]]`; constants `UNKNOWN`, `TTL`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_orch_prs.py`:

```python
import json
import os
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "orchestrator" / "scripts"))
import orch_prs  # noqa: E402

URL = "https://github.com/acme/recipe-site/pull/12"


def info(**over):
    base = {"state": "OPEN", "isDraft": False, "reviewDecision": "", "mergeable": "MERGEABLE",
            "statusCheckRollup": []}
    base.update(over)
    return base


def run(conclusion="SUCCESS", status="COMPLETED"):
    return {"__typename": "CheckRun", "status": status, "conclusion": conclusion}


def ctx(state):
    return {"__typename": "StatusContext", "state": state}


class ParseTests(unittest.TestCase):
    def test_accepts_a_github_pr_url(self):
        self.assertEqual(orch_prs.parse_pr(URL), ("acme", "recipe-site", "12"))
        self.assertEqual(orch_prs.parse_pr("https://github.com/a1/r.s_x-y/pull/7"), ("a1", "r.s_x-y", "7"))

    def test_rejects_everything_else(self):
        for bad in ("https://example.com/acme/recipe-site/pull/12",
                    "https://github.com/acme/recipe-site/issues/12",
                    "https://github.com/acme/recipe-site/pull/12/files",
                    "https://github.com/acme/recipe-site/pull/12\n",
                    "https://github.com/acme/recipe-site/pull/",
                    "https://github.com/-acme/recipe-site/pull/12",
                    "https://github.com/acme/-r/pull/12",
                    "http://github.com/acme/recipe-site/pull/12",
                    "https://github.com/acme/recipe-site/pull/12 --web",
                    "", None, 12):
            self.assertIsNone(orch_prs.parse_pr(bad), bad)


class ClassifyTests(unittest.TestCase):
    def test_merged_and_closed(self):
        self.assertEqual(orch_prs.classify(info(state="MERGED")), ("merged", "merged"))
        self.assertEqual(orch_prs.classify(info(state="MERGED", statusCheckRollup=[run("FAILURE")])),
                         ("merged", "merged"))
        self.assertEqual(orch_prs.classify(info(state="CLOSED")), ("red", "closed without merging"))

    def test_failing_checks_are_red(self):
        for conclusion in ("FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"):
            self.assertEqual(orch_prs.classify(info(statusCheckRollup=[run(), run(conclusion)])),
                             ("red", "checks failing"), conclusion)
        for state in ("FAILURE", "ERROR"):
            self.assertEqual(orch_prs.classify(info(statusCheckRollup=[ctx(state)])), ("red", "checks failing"), state)

    def test_changes_requested_and_conflict_are_red(self):
        self.assertEqual(orch_prs.classify(info(reviewDecision="CHANGES_REQUESTED")), ("red", "changes requested"))
        self.assertEqual(orch_prs.classify(info(mergeable="CONFLICTING")), ("red", "merge conflict"))

    def test_draft_and_pending_are_yellow(self):
        self.assertEqual(orch_prs.classify(info(isDraft=True)), ("yellow", "draft"))
        for status in ("QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"):
            self.assertEqual(orch_prs.classify(info(statusCheckRollup=[run("", status)])),
                             ("yellow", "checks running"), status)
        for state in ("PENDING", "EXPECTED"):
            self.assertEqual(orch_prs.classify(info(statusCheckRollup=[ctx(state)])), ("yellow", "checks running"), state)
        self.assertEqual(orch_prs.classify(info(reviewDecision="REVIEW_REQUIRED")), ("yellow", "waiting on review"))

    def test_green(self):
        self.assertEqual(orch_prs.classify(info()), ("green", "ready to merge"))
        ok = [run("SUCCESS"), run("SKIPPED"), run("NEUTRAL"), ctx("SUCCESS")]
        self.assertEqual(orch_prs.classify(info(reviewDecision="APPROVED", statusCheckRollup=ok)),
                         ("green", "ready to merge"))

    def test_precedence(self):
        self.assertEqual(orch_prs.classify(info(isDraft=True, statusCheckRollup=[run("FAILURE")])),
                         ("red", "checks failing"))
        self.assertEqual(orch_prs.classify(info(reviewDecision="CHANGES_REQUESTED", statusCheckRollup=[run("", "IN_PROGRESS")])),
                         ("red", "changes requested"))
        self.assertEqual(orch_prs.classify(info(isDraft=True, reviewDecision="REVIEW_REQUIRED")), ("yellow", "draft"))
        self.assertEqual(orch_prs.classify(info(statusCheckRollup=[run("", "IN_PROGRESS")], reviewDecision="REVIEW_REQUIRED")),
                         ("yellow", "checks running"))

    def test_missing_fields_are_absent_not_errors(self):
        self.assertEqual(orch_prs.classify({"state": "OPEN"}), ("green", "ready to merge"))
        self.assertEqual(orch_prs.classify({"statusCheckRollup": None, "reviewDecision": None}),
                         ("green", "ready to merge"))
        self.assertEqual(orch_prs.classify({"statusCheckRollup": ["junk", None]}), ("green", "ready to merge"))


class Runner:
    def __init__(self, out=None, code=0, exc=None, raw=None):
        self.out, self.code, self.exc, self.raw, self.calls = out, code, exc, raw, []

    def __call__(self, args, **kw):
        self.calls.append((args, kw))
        if self.exc:
            raise self.exc
        text = self.raw if self.raw is not None else json.dumps(self.out)
        return types.SimpleNamespace(returncode=self.code, stdout=text, stderr="")


class CacheTests(unittest.TestCase):
    def cache(self, runner, enabled=True):
        self.now = [0.0]
        return orch_prs.HealthCache(runner=runner, clock=lambda: self.now[0], enabled=enabled)

    def test_first_fetch_calls_gh_safely(self):
        runner = Runner(info())
        c = self.cache(runner)
        c.track("demo", [URL])
        self.assertEqual(c.refresh_due(), 1)
        args, kw = runner.calls[0]
        self.assertEqual(args, ["gh", "pr", "view", "12", "--repo", "acme/recipe-site", "--json",
                                "state,isDraft,reviewDecision,mergeable,statusCheckRollup"])
        self.assertEqual(kw["timeout"], 10)
        self.assertNotIn("shell", kw)
        self.assertEqual(c.snapshot(), {URL: ("green", "ready to merge")})

    def test_no_refetch_inside_the_ttl(self):
        runner = Runner(info())
        c = self.cache(runner)
        c.track("demo", [URL])
        c.refresh_due()
        self.now[0] = 59
        self.assertEqual(c.refresh_due(), 0)
        self.now[0] = 60
        self.assertEqual(c.refresh_due(), 1)
        self.assertEqual(len(runner.calls), 2)

    def test_final_states_are_never_refetched(self):
        for out in (info(state="MERGED"), info(state="CLOSED")):
            runner = Runner(out)
            c = self.cache(runner)
            c.track("demo", [URL])
            c.refresh_due()
            self.now[0] = 10_000
            c.refresh_due()
            self.assertEqual(len(runner.calls), 1, out["state"])

    def test_version_bumps_only_on_change(self):
        runner = Runner(info())
        c = self.cache(runner)
        c.track("demo", [URL])
        self.assertEqual(c.version, 0)
        c.refresh_due()
        self.assertEqual(c.version, 1)
        self.now[0] = 100
        c.refresh_due()
        self.assertEqual(c.version, 1)
        runner.out = info(isDraft=True)
        self.now[0] = 200
        c.refresh_due()
        self.assertEqual((c.version, c.snapshot()[URL]), (2, ("yellow", "draft")))

    def test_every_failure_is_unknown_and_retried_after_the_ttl(self):
        failures = [Runner(exc=FileNotFoundError("gh")),
                    Runner(exc=subprocess.TimeoutExpired(["gh"], 10)),
                    Runner(code=1),
                    Runner(raw="not json"),
                    Runner(raw="[1, 2]")]
        for runner in failures:
            c = self.cache(runner)
            c.track("demo", [URL])
            c.refresh_due()
            self.assertEqual(c.snapshot(), {URL: orch_prs.UNKNOWN})
        runner = Runner(exc=FileNotFoundError("gh"))
        c = self.cache(runner)
        c.track("demo", [URL])
        c.refresh_due()
        runner.exc, runner.out = None, info()
        self.now[0] = 60
        c.refresh_due()
        self.assertEqual(c.snapshot(), {URL: ("green", "ready to merge")})

    def test_non_github_urls_never_reach_gh(self):
        runner = Runner(info())
        c = self.cache(runner)
        c.track("demo", ["https://example.com/acme/recipe-site/pull/12", "--web", "javascript:alert(1)"])
        c.refresh_due()
        self.assertEqual(runner.calls, [])
        self.assertEqual(set(c.snapshot().values()), {orch_prs.UNKNOWN})

    def test_disabled_runs_no_gh(self):
        runner = Runner(info())
        c = self.cache(runner, enabled=False)
        c.track("demo", [URL])
        c.refresh_due()
        self.assertEqual((runner.calls, c.snapshot()), ([], {URL: orch_prs.UNKNOWN}))

    def test_env_switch(self):
        with mock.patch.dict(os.environ, {"ORCH_PR_STATUS": "off"}):
            self.assertFalse(orch_prs.HealthCache().enabled)
        with mock.patch.dict(os.environ, {"ORCH_PR_STATUS": ""}):
            self.assertTrue(orch_prs.HealthCache().enabled)

    def test_track_replaces_per_epic_and_unions_epics(self):
        other = "https://github.com/acme/recipe-site/pull/13"
        c = self.cache(Runner(info()))
        c.track("a", [URL])
        c.track("b", [other])
        self.assertEqual(set(c.snapshot()), {URL, other})
        c.track("a", [])
        self.assertEqual(set(c.snapshot()), {other})
        self.assertEqual(c.tracked, {"a": set(), "b": {other}})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m unittest tests.test_orch_prs 2>&1 | tail -5`
Expected: FAIL with `ModuleNotFoundError: No module named 'orch_prs'`.

- [ ] **Step 3: Implement**

Create `skills/orchestrator/scripts/orch_prs.py`:

```python
"""PR health for the live status page: classify what `gh pr view` returns and keep a cache fresh.

Stdlib only. PR URLs come from workers and are untrusted: only the parsed owner, repo and
number reach `gh`, always as an argument list (no shell).
"""
import json
import os
import re
import subprocess
import threading
import time

PR_URL = re.compile(r"https://github\.com/([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)/pull/([0-9]+)")
FIELDS = "state,isDraft,reviewDecision,mergeable,statusCheckRollup"
TTL = 60
TIMEOUT = 10
UNKNOWN = ("unknown", "status unavailable")
CLOSED = ("red", "closed without merging")
FAILED_RUN = {"FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"}
PENDING_RUN = {"QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"}


def parse_pr(url):
    """(owner, repo, number) for a github.com pull request URL, else None."""
    m = PR_URL.fullmatch(url) if isinstance(url, str) else None
    return m.groups() if m else None


def check_state(check):
    """'failed', 'pending' or 'ok' for one entry of statusCheckRollup."""
    if check.get("__typename") == "StatusContext":
        state = check.get("state")
        if state in ("FAILURE", "ERROR"):
            return "failed"
        return "pending" if state in ("PENDING", "EXPECTED") else "ok"
    if check.get("conclusion") in FAILED_RUN:
        return "failed"
    return "pending" if check.get("status") in PENDING_RUN else "ok"


def classify(info):
    """(health, reason) for the JSON of `gh pr view --json FIELDS`. First match wins."""
    state = info.get("state")
    if state == "MERGED":
        return ("merged", "merged")
    if state == "CLOSED":
        return CLOSED
    checks = [check_state(c) for c in info.get("statusCheckRollup") or [] if isinstance(c, dict)]
    decision = info.get("reviewDecision")
    if "failed" in checks:
        return ("red", "checks failing")
    if decision == "CHANGES_REQUESTED":
        return ("red", "changes requested")
    if info.get("mergeable") == "CONFLICTING":
        return ("red", "merge conflict")
    if info.get("isDraft"):
        return ("yellow", "draft")
    if "pending" in checks:
        return ("yellow", "checks running")
    if decision == "REVIEW_REQUIRED":
        return ("yellow", "waiting on review")
    return ("green", "ready to merge")


def final(result):
    return result[0] == "merged" or result == CLOSED


class HealthCache:
    """URL -> (health, reason). `refresh_due()` is meant to run on one background thread."""

    def __init__(self, runner=subprocess.run, clock=time.monotonic, enabled=None):
        self.runner, self.clock = runner, clock
        self.enabled = os.environ.get("ORCH_PR_STATUS", "").lower() != "off" if enabled is None else enabled
        self.lock = threading.Lock()
        self.tracked = {}   # epic key -> set of URLs
        self.results = {}   # URL -> (health, reason)
        self.fetched = {}   # URL -> clock time of the last attempt
        self.version = 0

    def track(self, key, urls):
        with self.lock:
            self.tracked[key] = set(urls)

    def urls(self):
        return set().union(*self.tracked.values()) if self.tracked else set()

    def snapshot(self):
        with self.lock:
            return {u: self.results.get(u, UNKNOWN) for u in self.urls()}

    def fetch(self, url):
        pr = parse_pr(url)
        if not pr or not self.enabled:
            return UNKNOWN
        owner, repo, number = pr
        args = ["gh", "pr", "view", number, "--repo", f"{owner}/{repo}", "--json", FIELDS]
        try:
            done = self.runner(args, capture_output=True, text=True, timeout=TIMEOUT, check=False)
            if done.returncode != 0:
                return UNKNOWN
            return classify(json.loads(done.stdout))
        except (OSError, subprocess.SubprocessError, ValueError, AttributeError, TypeError):
            return UNKNOWN

    def refresh_due(self):
        """Fetch every tracked URL that was never fetched, or whose result is not final and
        older than TTL. Returns how many were fetched."""
        now = self.clock()
        with self.lock:
            due = [u for u in sorted(self.urls())
                   if u not in self.fetched
                   or (not final(self.results.get(u, UNKNOWN)) and now - self.fetched[u] >= TTL)]
        for url in due:
            result = self.fetch(url)
            with self.lock:
                self.fetched[url] = self.clock()
                if self.results.get(url) != result:
                    self.results[url] = result
                    self.version += 1
        return len(due)
```

- [ ] **Step 4: Run the tests**

Run: `python3 -m unittest tests.test_orch_prs -v 2>&1 | tail -25`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/orchestrator/scripts/orch_prs.py tests/test_orch_prs.py
git commit -S -s -m "feat(orchestrator): classify PR health and cache it from gh

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Rendering — bullets, legend and CSS

**Files:**
- Modify: `skills/orchestrator/scripts/orch_view.py` (`prs_html`, `main_html`)
- Modify: `skills/orchestrator/templates/status.html.tmpl` (CSS)
- Test: `tests/test_orch_state.py` (`ViewModelTests`, after `test_html_shows_every_pr_as_a_link`)

**Interfaces:**
- Consumes: health map `dict[url, (health, reason)]` as returned by `HealthCache.snapshot()`.
- Produces: `orch_view.prs_html(urls, health=None)`, `orch_view.main_html(vm, health=None)`, `orch_view.pr_dot(result)`, `orch_view.PR_LEGEND`.

- [ ] **Step 1: Write the failing tests**

Add to `ViewModelTests` in `tests/test_orch_state.py`:

```python
    def test_prs_html_without_health_has_no_bullets(self):
        out = orch_view.prs_html(["https://github.com/acme/recipe-site/pull/12"])
        self.assertNotIn("pr-dot", out)
        self.assertNotIn('class="pr"', out)

    def test_prs_html_adds_a_bullet_to_each_pr_that_has_a_result(self):
        a, b, c = (f"https://github.com/acme/recipe-site/pull/{n}" for n in (12, 15, 16))
        out = orch_view.prs_html([a, b, c], {a: ("green", "ready to merge"), b: ("red", "checks failing")})
        self.assertIn(f'<span class="pr"><a href="{a}">#12</a>'
                      '<span class="pr-dot h-green" role="img" aria-label="ready to merge" title="ready to merge"></span></span>', out)
        self.assertIn('class="pr-dot h-red"', out)
        self.assertEqual(out.count("pr-dot"), 2)
        self.assertIn(f'<a href="{c}">#16</a>', out)
        self.assertNotIn(f'<span class="pr"><a href="{c}">', out)

    def test_pr_dot_escapes_the_reason(self):
        out = orch_view.pr_dot(("red", '<b>"x"'))
        self.assertNotIn("<b>", out)
        self.assertIn("&lt;b&gt;", out)

    def test_main_html_shows_bullets_and_legend_only_with_health_and_a_pr(self):
        url = "https://github.com/acme/recipe-site/pull/12"
        state = orch_state.init("demo", plan())
        no_prs = orch_state.view_model(state, [])
        self.assertNotIn("PR bullets", orch_view.main_html(no_prs, {}))
        state["goals"]["g1"]["prs"] = [url]
        vm = orch_state.view_model(state, [])
        page = orch_view.main_html(vm, {url: ("merged", "merged")})
        self.assertIn("h-merged", page)
        self.assertIn("PR bullets", page)
        plain = orch_view.main_html(vm)
        self.assertNotIn("PR bullets", plain)
        self.assertNotIn("pr-dot", plain)
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m unittest tests.test_orch_state.ViewModelTests -v 2>&1 | tail -15`
Expected: the four new tests FAIL (`prs_html() takes 1 positional argument`, `pr_dot` missing).

- [ ] **Step 3: Implement**

In `orch_view.py`, replace `prs_html` with:

```python
def pr_dot(result):
    health, reason = result
    return (f'<span class="pr-dot h-{esc(health)}" role="img" aria-label="{esc(reason)}" '
            f'title="{esc(reason)}"></span>')


def prs_html(urls, health=None):
    if not urls:
        return "-"
    health = health or {}
    out = []
    for u in urls:
        entry = link(u, pr_label(u))
        if u in health:
            entry = f'<span class="pr">{entry}{pr_dot(health[u])}</span>'
        out.append(entry)
    return " ".join(out)


PR_LEGEND = '<p class="legend">PR bullets: ' + " · ".join(
    f'<span class="pr-dot h-{h}"></span> {text}'
    for h, text in (("green", "ready to merge"), ("yellow", "waiting"), ("red", "needs action"),
                    ("merged", "merged"), ("unknown", "unknown"))) + "</p>"
```

Change `def main_html(vm):` to `def main_html(vm, health=None):`. Just before building `goal_rows`, add:

```python
    legend = PR_LEGEND if health is not None and any(g["prs"] for g in vm["goals"]) else ""
```

Inside `goal_rows`, replace `{prs_html(g["prs"])}` with `{prs_html(g["prs"], health)}`. In the returned page, replace the fragment `'<section><h2>Goals</h2><div class="table"><table><thead>…'` so it reads `f'<section><h2>Goals</h2>{legend}<div class="table"><table><thead><tr><th>Goal</th><th>Title</th>'` (it becomes an f-string; keep the rest of that concatenation unchanged).

In `templates/status.html.tmpl`, after the `.dot.gone` rule add:

```css
.pr { white-space: nowrap; }
.pr-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin: 0 2px 0 4px; background: var(--s-blocked); }
.pr-dot.h-green { background: var(--s-done); }
.pr-dot.h-yellow { background: var(--s-assigned); }
.pr-dot.h-red { background: var(--s-needs-user); }
.pr-dot.h-merged { background: var(--s-in-review); }
```

`string.Template` treats `$` specially; these rules contain none.

- [ ] **Step 4: Run the full suite**

Run: `python3 -m unittest discover -s tests 2>&1 | tail -4`
Expected: all PASS (including the existing `test_html_shows_every_pr_as_a_link` and the golden test, which are unaffected).

- [ ] **Step 5: Commit**

```bash
git add skills/orchestrator/scripts/orch_view.py skills/orchestrator/templates/status.html.tmpl tests/test_orch_state.py
git commit -S -s -m "feat(orchestrator): draw a health bullet after each PR on the live page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Server — poll `gh` and push changes

**Files:**
- Modify: `skills/orchestrator/scripts/orch_serve.py` (`StatusServer.__init__`, `epic_view`, `Handler.do_GET`, `serve`)
- Test: `tests/test_orch_serve.py` (`ServerTests`)

**Interfaces:**
- Consumes: `orch_prs.HealthCache` (Task 1), `orch_view.main_html(vm, health)` (Task 2).
- Produces: `StatusServer.health` (a `HealthCache`), `orch_serve.refresh_loop(server)`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_orch_serve.py` add `import types` with the other stdlib imports and `import orch_prs  # noqa: E402` after `import orch_serve`. Add to `ServerTests`:

```python
    URL = "https://github.com/acme/recipe-site/pull/12"

    def report_pr(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")
        self.run_cli("pr", "demo", "demo-w-a", "g1", "--url", self.URL)

    def fake_gh(self, info=None, exc=None):
        now = [0.0]

        def runner(args, **kw):
            if exc:
                raise exc
            return types.SimpleNamespace(returncode=0, stdout=json.dumps(info), stderr="")

        self.server.health = orch_prs.HealthCache(runner=runner, clock=lambda: now[0], enabled=True)
        return now

    def test_epic_page_shows_the_pr_bullet_once_fetched(self):
        self.report_pr()
        info = {"state": "OPEN", "isDraft": False, "reviewDecision": "REVIEW_REQUIRED",
                "mergeable": "MERGEABLE", "statusCheckRollup": []}
        self.fake_gh(info)
        _, page = self.get("/demo")
        self.assertIn('aria-label="status unavailable"', page)
        self.assertEqual(self.server.health.tracked["demo"], {self.URL})
        self.server.health.refresh_due()
        _, page = self.get("/demo")
        self.assertIn('class="pr-dot h-yellow"', page)
        self.assertIn('aria-label="waiting on review"', page)
        self.assertNotIn('aria-label="status unavailable"', page)

    def test_stream_pushes_when_a_bullet_changes(self):
        self.report_pr()
        info = {"state": "OPEN", "isDraft": False, "reviewDecision": "REVIEW_REQUIRED",
                "mergeable": "MERGEABLE", "statusCheckRollup": []}
        now = self.fake_gh(info)
        self.get("/demo")
        self.server.health.refresh_due()
        resp = urllib.request.urlopen(self.base + "/events/demo", timeout=5)
        self.addCleanup(resp.close)
        self.assertIn("h-yellow", self.read_event(resp))
        info["reviewDecision"] = "APPROVED"
        now[0] = 61
        start = time.monotonic()
        self.server.health.refresh_due()
        second = self.read_event(resp)
        self.assertLess(time.monotonic() - start, 2)
        self.assertIn("h-green", second)

    def test_page_survives_gh_being_unavailable(self):
        self.report_pr()
        self.fake_gh(exc=FileNotFoundError("gh"))
        self.get("/demo")
        self.server.health.refresh_due()
        code, page = self.get("/demo")
        self.assertEqual(code, 200)
        self.assertIn('aria-label="status unavailable"', page)

    def test_refresh_loop_runs_until_the_server_closes(self):
        calls = []
        self.server.health = types.SimpleNamespace(refresh_due=lambda: calls.append(1), version=0)
        t = threading.Thread(target=orch_serve.refresh_loop, args=(self.server,), daemon=True)
        t.start()
        deadline = time.monotonic() + 5
        while not calls and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertTrue(calls)
        self.server.closing.set()
        t.join(timeout=3)
        self.assertFalse(t.is_alive())
```

- [ ] **Step 2: Run to verify failure**

Run: `python3 -m unittest tests.test_orch_serve.ServerTests -v 2>&1 | tail -15`
Expected: the new tests FAIL (`AttributeError: ... 'health'` / `refresh_loop` missing).

- [ ] **Step 3: Implement**

In `orch_serve.py`: add `import orch_prs` next to `import orch_state`.

In `StatusServer.__init__`, after `self.last_good = {}`, add:

```python
        self.health = orch_prs.HealthCache()
```

In `epic_view`, replace the two lines that build `vm` and `view` with:

```python
            vm = orch_state.view_model(state, orch_state.read_events(d), orch_state.validate(state))
            self.health.track(slug, [u for g in vm["goals"] for u in g["prs"]])
            view = (vm["title"], orch_view.main_html(vm, self.health.snapshot()))
```

In `Handler.do_GET`, change the epic stream line to:

```python
                return self.stream(lambda: srv.epic_signature(slug) + (srv.health.version,),
                                   lambda: srv.epic_view(slug)[1])
```

Add above `def serve(port):`:

```python
def refresh_loop(server):
    """Keep PR health fresh until the server closes. One gh call at a time, off the request threads."""
    while not server.closing.wait(1):
        server.health.refresh_due()
```

In `serve()`, right after `server = StatusServer(port)`, add:

```python
    threading.Thread(target=refresh_loop, args=(server,), daemon=True).start()
```

- [ ] **Step 4: Run the full suite**

Run: `python3 -m unittest discover -s tests 2>&1 | tail -4`
Expected: all PASS. No test calls the real `gh`: `StatusServer(0)` only creates the cache, and only `serve()` starts the loop.

- [ ] **Step 5: Commit**

```bash
git add skills/orchestrator/scripts/orch_serve.py tests/test_orch_serve.py
git commit -S -s -m "feat(orchestrator): poll gh for PR health and push bullet changes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: README and demo images

**Files:**
- Modify: `README.md` ("Live status page" section)
- Create: `docs/images/status-pr-bullets.gif` (a full-page GIF; it replaces the light epic screenshot in the README)
- Modify: `docs/images/status-epic-dark.png` (retaken)
- Delete: `docs/images/status-epic-light.png` (the GIF replaces it), `docs/images/status-pr-visibility.gif` (the older, cropped GIF)

**Interfaces:**
- Consumes: the working server and bullets from Tasks 1-3.

The demo uses a fake `gh` so every colour shows with made-up data. Do all scratch work in a directory from `mktemp -d`; commit only the three images and the README.

- [ ] **Step 1: Build the demo epic and fake `gh`**

```bash
WORK=$(mktemp -d); export ORCH_ROOT=$WORK/orch; mkdir -p $ORCH_ROOT $WORK/bin $WORK/gh
O="python3 $PWD/skills/orchestrator/scripts/orch_state.py"      # run from plugins/orchestrator
U=https://github.com/acme/recipe-site/pull

cat > $WORK/bin/gh <<'EOF'
#!/bin/bash
# fake: gh pr view <n> --repo o/r --json ...  ->  $FAKE_GH_DIR/<n>.json
f="$FAKE_GH_DIR/$3.json"; [ -f "$f" ] && cat "$f" || exit 1
EOF
chmod +x $WORK/bin/gh

pr() { # pr <number> <state> <isDraft> <reviewDecision> <checks-json>
  echo "{\"state\":\"$2\",\"isDraft\":$3,\"reviewDecision\":\"$4\",\"mergeable\":\"MERGEABLE\",\"statusCheckRollup\":$5}" > $WORK/gh/$1.json; }
RUN='[{"__typename":"CheckRun","status":"IN_PROGRESS","conclusion":""}]'
OK='[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"SUCCESS"}]'
BAD='[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"FAILURE"}]'
for n in 211 214 215; do pr $n MERGED false APPROVED "$OK"; done

at() { export ORCH_NOW=$(python3 -c "import datetime as d,sys;print((d.datetime.now(d.timezone.utc)-d.timedelta(minutes=int(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%SZ'))" $1); }
cat > $WORK/plan.json <<'EOF'
{"epic":{"slug":"recipes","title":"Recipe sharing site","source":null},"manager":"recipes-manager","worker_prefix":"recipes-w-","policy":{"unblock_on":"done"},"board":null,
 "goals":{
  "recipes-schema":{"title":"Define the recipe schema","summary":"s","depends_on":[]},
  "recipes-docs":{"title":"Document the public API","summary":"s","depends_on":[]},
  "recipes-import":{"title":"Import recipes from URLs","summary":"s","depends_on":["recipes-schema"]},
  "recipes-search":{"title":"Search by ingredient","summary":"s","depends_on":["recipes-schema"]},
  "recipes-pages":{"title":"Recipe pages with ratings","summary":"s","depends_on":["recipes-import","recipes-search"]},
  "recipes-e2e":{"title":"End-to-end tests with sample recipes","summary":"s","depends_on":["recipes-pages"]}}}
EOF
at 9; $O init recipes --plan $WORK/plan.json >/dev/null
for w in api docs web; do at 9; $O register recipes recipes-w-$w >/dev/null; done
at 8; $O request recipes recipes-w-api >/dev/null
at 7; $O pr recipes recipes-w-api recipes-schema --url $U/211 >/dev/null
at 7; $O done recipes recipes-w-api recipes-schema --pr $U/211 --notes "schema ready" >/dev/null
at 6; $O approve recipes recipes-schema >/dev/null
for w in docs web api; do at 6; $O request recipes recipes-w-$w >/dev/null; done
at 5; $O status recipes recipes-w-docs recipes-docs needs-user --reason "should the docs cover the v1 or the v2 endpoints?" >/dev/null
at 4; $O pr recipes recipes-w-web recipes-import --url $U/214 >/dev/null
at 4; $O done recipes recipes-w-web recipes-import --pr $U/214 --notes "import ready" >/dev/null
at 3; $O pr recipes recipes-w-api recipes-search --url $U/215 >/dev/null
at 3; $O done recipes recipes-w-api recipes-search --pr $U/215 --notes "search ready" >/dev/null
at 3; $O approve recipes recipes-import >/dev/null; $O approve recipes recipes-search >/dev/null
at 2; $O request recipes recipes-w-web >/dev/null
at 2; $O liveness recipes --live recipes-w-api,recipes-w-docs,recipes-w-web >/dev/null
```

- [ ] **Step 2: Capture four frames**

Each frame restarts the server so the first fetch runs immediately (the real server refetches every 60 s). Port 8765 may belong to something else, so use 8799. Chrome's `--blink-settings=preferredColorScheme=1` gives the LIGHT theme here; without it the page is dark.

```bash
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p $WORK/f
frame() { # frame <name> [extra chrome flags]
  FAKE_GH_DIR=$WORK/gh PATH=$WORK/bin:$PATH nohup python3 $PWD/skills/orchestrator/scripts/orch_state.py serve --port 8799 >$WORK/serve.log 2>&1 &
  sleep 2
  curl -s -o /dev/null http://127.0.0.1:8799/recipes   # the first page request registers the URLs to fetch
  sleep 4                                                 # then the server fetches them
  timeout 40 "$C" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,1450 \
    --user-data-dir=$WORK/chrome ${@:2} --screenshot=$WORK/f/$1.png http://127.0.0.1:8799/recipes >/dev/null 2>&1
  python3 $PWD/skills/orchestrator/scripts/orch_state.py serve --stop >/dev/null
  rm -f $ORCH_ROOT/.server.json
}
L="--blink-settings=preferredColorScheme=1"

# frame 1: first PR, checks running
at 1; $O pr recipes recipes-w-web recipes-pages --url $U/218 >/dev/null
pr 218 OPEN false REVIEW_REQUIRED "$RUN"; frame 1 $L
# frame 2: first PR green, a second PR opened as a draft
pr 218 OPEN false APPROVED "$OK"
at 1; $O pr recipes recipes-w-web recipes-pages --url $U/221 >/dev/null
pr 221 OPEN true REVIEW_REQUIRED "$RUN"; frame 2 $L
# frame 3: second PR fails its checks
pr 221 OPEN false REVIEW_REQUIRED "$BAD"; frame 3 $L
# frame 4: first PR merged, second PR green, goal handed over for review
pr 218 MERGED false APPROVED "$OK"; pr 221 OPEN false APPROVED "$OK"
unset ORCH_NOW; $O done recipes recipes-w-web recipes-pages --pr $U/221 --notes "pages ready" >/dev/null
frame 4 $L; frame 4-dark
ls -la $WORK/f
```

Expected: `1.png`, `2.png`, `3.png`, `4.png`, `4-dark.png`, each 1200 x 1450 (the same size as the current `status-epic-light.png`; check with `file`). Open each with the Read tool and check: frame 1 shows `#218` with a yellow bullet; frame 2 `#218` green and `#221` yellow; frame 3 `#221` red; frame 4 `#218` purple, `#221` green, goal `in-review`; finished goals (#211, #214, #215) purple; the legend line is visible under "Goals". If a bullet is grey, the fake `gh` was not on the server's `PATH`, or the page was not requested once (and given a few seconds) before the screenshot: the server only learns which PRs to fetch when a page is rendered.

- [ ] **Step 3: Make the GIF and replace the images**

The GIF replaces the light epic screenshot in the README, so its frames are the whole page at
the screenshot's size (1200 x 1450): dependency graph, goals, workers and recent events. Do not crop.

```bash
cd $WORK/f
cat > list.txt <<'EOF'
file '1.png'
duration 2.4
file '2.png'
duration 2.4
file '3.png'
duration 2.4
file '4.png'
duration 3.2
file '4.png'
EOF
ffmpeg -loglevel error -y -f concat -i list.txt -vf "split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none" -loop 0 pr-bullets.gif
cd - >/dev/null
command cp -f $WORK/f/pr-bullets.gif docs/images/status-pr-bullets.gif
command cp -f $WORK/f/4-dark.png docs/images/status-epic-dark.png
git rm -q docs/images/status-epic-light.png docs/images/status-pr-visibility.gif
file docs/images/status-pr-bullets.gif; ls -la docs/images
```

Expected: the GIF reports `1200 x 1450`. If it is over about 600 KB, lower `max_colors` to 96 before reducing anything else; never crop or shrink it.
Check a middle frame: `ffmpeg -loglevel error -y -i docs/images/status-pr-bullets.gif -vf "select=eq(n\,2)" -vframes 1 $WORK/check.png`, then view `$WORK/check.png` and confirm all four sections are visible and the bullet colours are right. `cp` may be aliased to prompt; `command cp -f` avoids that.

- [ ] **Step 4: Update the README**

In the "Live status page" section, the GIF takes the place of the current light screenshot line
(`![Epic page: dependency graph, goals, workers and recent events](docs/images/status-epic-light.png)`)
and of the older PR-visibility GIF with its introducing sentence. Replace both with:

```markdown
A worker reports each PR as soon as it opens it, so the PR column fills in while the goal
is still in progress, and a goal can list several PRs. A bullet after each PR link shows
its health, read from GitHub with the `gh` CLI every minute or so:

- green: ready to merge (checks pass, no review blocking it)
- yellow: waiting (a draft, checks running, or a review required)
- red: needs action (a check failed, changes requested, a merge conflict, or closed unmerged)
- purple: merged
- grey: unknown (`gh` missing, not logged in, offline, or not a GitHub PR)

Hover a bullet for the reason. Set `ORCH_PR_STATUS=off` to skip the GitHub calls; every
bullet is then grey. `status.md` and the static `status.html` have no bullets.

![Epic page: dependency graph, goals, workers and recent events, with PRs gaining health bullets](docs/images/status-pr-bullets.gif)
```

Leave the `<details>` block (dark mode and the index) as it is. Then `grep -n "status-epic-light\|status-pr-visibility" README.md` must print nothing, and every image the README references must exist.

- [ ] **Step 5: Verify, scan and commit**

Run: `python3 -m unittest discover -s tests 2>&1 | tail -3`
Expected: OK.

Run: `git diff --cached --stat; git diff -- README.md | grep -nE '/Users/|@[a-z0-9.-]+\.[a-z]+'` (expect no output). View the final light screenshot with the Read tool and confirm it shows only demo data (`acme/recipe-site`, `recipes-*`).

```bash
git add -A README.md docs/images
git commit -S -s -m "docs(orchestrator): document PR status bullets and retake the demo images

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** §1 table and §2 rules → Task 1 `classify` and its precedence tests; §3 fetching, safety, cache, thread, off switch, track-everything → Task 1 (`parse_pr`, `HealthCache`, env test) and Task 3 (`refresh_loop`, `serve()`); §4 rendering, legend, wrapper, a11y, live updates → Task 2 and Task 3 (stream signature); offline `status.md`/`status.html` → unchanged by design (Global Constraints); §6 testing → Tasks 1-3, demo with fake `gh` → Task 4.
- **Placeholders:** none; the one conditional note in Task 1 step 3 describes a concrete fallback for `snapshot`.
- **Type consistency:** `HealthCache.track(key, urls)`, `.snapshot()`, `.refresh_due()`, `.version`, `.tracked`, `parse_pr`, `classify`, `UNKNOWN`, `pr_dot`, `prs_html(urls, health=None)`, `main_html(vm, health=None)`, `refresh_loop(server)` are used with the same names and signatures across tasks.
