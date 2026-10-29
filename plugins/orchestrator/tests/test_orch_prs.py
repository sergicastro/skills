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

    def test_unknown_run_status_is_pending_and_missing_status_is_ok(self):
        self.assertEqual(orch_prs.classify(info(statusCheckRollup=[run("", "SOMETHING_NEW")])),
                         ("yellow", "checks running"))
        self.assertEqual(orch_prs.classify(info(statusCheckRollup=[{"conclusion": "SUCCESS"}])),
                         ("green", "ready to merge"))

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

    def test_one_bad_pr_does_not_abort_the_batch(self):
        bad, good = "https://github.com/acme/recipe-site/pull/1", "https://github.com/acme/recipe-site/pull/2"

        def runner(args, **kw):
            if args[3] == "1":
                raise RecursionError("boom")
            return types.SimpleNamespace(returncode=0, stdout=json.dumps(info()), stderr="")
        c = self.cache(runner)
        c.track("demo", [bad, good])
        self.assertEqual(c.refresh_due(), 2)
        self.assertEqual(c.snapshot(), {bad: orch_prs.UNKNOWN, good: ("green", "ready to merge")})

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
