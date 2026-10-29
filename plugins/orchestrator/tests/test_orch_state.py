import contextlib
import io
import json
from unittest import mock
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "orchestrator" / "scripts"))
import orch_state  # noqa: E402
import orch_view  # noqa: E402

GOLDEN = Path(__file__).resolve().parent / "golden" / "status.md"


def plan(goals=None, **over):
    p = {
        "epic": {"slug": "demo", "title": "Demo epic", "source": None},
        "manager": "demo-manager",
        "worker_prefix": "demo-w-",
        "policy": {"unblock_on": "done"},
        "board": None,
        "goals": goals if goals is not None else {
            "g1": {"title": "Base", "summary": "base work", "depends_on": []},
            "g2": {"title": "Left", "summary": "left work", "depends_on": ["g1"]},
            "g3": {"title": "Right", "summary": "right work", "depends_on": ["g1"]},
            "g4": {"title": "Join", "summary": "join work", "depends_on": ["g2", "g3"]},
        },
    }
    p.update(over)
    return p


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = {"ORCH_ROOT": self.tmp.name, "ORCH_NOW": "2026-10-26T10:00:00Z"}
        self.old_env = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)
        self.addCleanup(self.restore_env)

    def restore_env(self):
        for k, v in self.old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def run_cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = orch_state.main(list(argv))
        out = buf.getvalue()
        try:
            return code, json.loads(out)
        except ValueError:
            return code, out

    def init(self, p=None, slug="demo"):
        path = Path(self.tmp.name) / "plan.json"
        path.write_text(json.dumps(p or plan()))
        return self.run_cli("init", slug, "--plan", str(path))

    def state(self, slug="demo"):
        return json.loads((Path(self.tmp.name) / slug / "state.json").read_text())

    def statuses(self):
        return {gid: g["status"] for gid, g in self.state()["goals"].items()}


class InitTests(Base):
    def test_init_sets_ready_and_blocked(self):
        code, out = self.init()
        self.assertEqual(code, 0, out)
        self.assertEqual(out["ready"], ["g1"])
        self.assertEqual(out["blocked"], ["g2", "g3", "g4"])
        self.assertEqual(self.statuses(), {"g1": "ready", "g2": "blocked", "g3": "blocked", "g4": "blocked"})
        d = Path(self.tmp.name) / "demo"
        self.assertTrue((d / "status.md").exists())
        self.assertIn("2026-10-26T10:00:00Z manager INIT 4 goals", (d / "events.log").read_text())

    def test_init_rejects_cycle(self):
        code, out = self.init(plan({
            "a": {"title": "A", "summary": "a", "depends_on": ["b"]},
            "b": {"title": "B", "summary": "b", "depends_on": ["a"]},
        }))
        self.assertEqual(code, 2)
        self.assertIn("dependency cycle", out["error"])

    def test_init_rejects_unknown_dependency(self):
        code, out = self.init(plan({"a": {"title": "A", "summary": "a", "depends_on": ["zz"]}}))
        self.assertEqual(code, 2)
        self.assertIn("unknown dependency zz", out["error"])

    def test_init_rejects_missing_fields(self):
        code, out = self.init(plan({"a": {"title": "A"}}))
        self.assertEqual(code, 2)
        self.assertIn("a: missing summary", out["error"])

    def test_init_rejects_existing(self):
        self.init()
        code, out = self.init()
        self.assertEqual(code, 2)
        self.assertIn("already exists", out["error"])

    def test_init_rejects_bad_slug(self):
        code, out = self.init(slug="../evil")
        self.assertEqual(code, 2)
        self.assertIn("invalid slug", out["error"])

    def test_init_rejects_trailing_newline_slug(self):
        code, out = self.init(slug="demo\n")
        self.assertEqual(code, 2)
        self.assertIn("invalid slug", out["error"])

    def test_init_rejects_slug_mismatch(self):
        code, out = self.init(slug="other")
        self.assertEqual(code, 2)
        self.assertIn("does not match", out["error"])


class LoadTests(Base):
    def test_corrupt_json_is_reported(self):
        self.init()
        (Path(self.tmp.name) / "demo" / "state.json").write_text("{not json")
        code, out = self.run_cli("validate", "demo")
        self.assertEqual(code, 2)
        self.assertIn("not valid JSON", out["error"])

    def test_invalid_status_is_reported(self):
        self.init()
        s = self.state()
        s["goals"]["g1"]["status"] = "weird"
        (Path(self.tmp.name) / "demo" / "state.json").write_text(json.dumps(s))
        code, out = self.run_cli("validate", "demo")
        self.assertEqual(code, 2)
        self.assertIn("g1: invalid status weird", out["error"])

    def test_unknown_slug(self):
        code, out = self.run_cli("validate", "nope")
        self.assertEqual(code, 2)
        self.assertIn("no orchestration named 'nope'", out["error"])

    def test_validate_ok(self):
        self.init()
        self.assertEqual(self.run_cli("validate", "demo"), (0, {"valid": True, "goals": 4}))


class ReadTests(Base):
    def test_show_renders_status(self):
        self.init()
        code, out = self.run_cli("show", "demo")
        self.assertEqual(code, 0)
        self.assertIn("# Demo epic", out)
        self.assertIn("| g1 | Base | ready |", out)
        self.assertIn("- g4 ← g2, g3", out)
        self.assertIn("## Workers", out)

    def test_get_returns_goal(self):
        self.init()
        code, out = self.run_cli("get", "demo", "g2")
        self.assertEqual(code, 0)
        self.assertEqual(out["goal"], "g2")
        self.assertEqual(out["depends_on"], ["g1"])

    def test_get_unknown_goal(self):
        self.init()
        code, out = self.run_cli("get", "demo", "g9")
        self.assertEqual(code, 2)
        self.assertIn("unknown goal g9", out["error"])


class WorkerTests(Base):
    def setUp(self):
        super().setUp()
        self.init()

    def test_register_rejects_wrong_prefix(self):
        code, out = self.run_cli("register", "demo", "skills-24")
        self.assertEqual(code, 2)
        self.assertIn("does not start with worker prefix 'demo-w-'", out["error"])

    def test_register_and_reregister(self):
        self.assertEqual(self.run_cli("register", "demo", "demo-w-a"),
                         (0, {"registered": "demo-w-a", "new": True, "current": None}))
        self.assertEqual(self.run_cli("register", "demo", "demo-w-a")[1]["new"], False)
        self.assertIn("demo-w-a", self.state()["workers"])

    def test_request_requires_registration(self):
        code, out = self.run_cli("request", "demo", "demo-w-a")
        self.assertEqual(code, 2)
        self.assertIn("demo-w-a is not registered", out["error"])

    def test_request_assigns_ready_goal(self):
        self.run_cli("register", "demo", "demo-w-a")
        code, out = self.run_cli("request", "demo", "demo-w-a")
        self.assertEqual(code, 0, out)
        self.assertEqual(out["assigned"], "g1")
        self.assertEqual(out["epic"], "demo")
        self.assertEqual(out["upstream"], [])
        self.assertIsNone(out["board"])
        self.assertEqual(out["state_dir"], str(Path(self.tmp.name) / "demo"))
        s = self.state()
        self.assertEqual(s["goals"]["g1"]["status"], "assigned")
        self.assertEqual(s["goals"]["g1"]["worker"], "demo-w-a")
        self.assertEqual(s["workers"]["demo-w-a"]["current"], "g1")

    def test_request_while_holding_goal_is_rejected(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.run_cli("request", "demo", "demo-w-a")
        self.assertEqual(code, 2)
        self.assertIn("already has goal g1", out["error"])

    def test_request_with_nothing_ready_explains_why(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("register", "demo", "demo-w-b")
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.run_cli("request", "demo", "demo-w-b")
        self.assertEqual(code, 0)
        self.assertEqual(out, {"none_ready": "g1 (assigned) blocks g2, g3"})

    def test_board_values_are_included(self):
        p = plan(board={"project": "org/12", "field": "Status",
                        "mapping": {"ready": "Todo", "assigned": "In Progress", "in-review": "In Review", "done": "Done"}})
        p["epic"]["slug"] = "boarded"
        self.init(p, slug="boarded")
        self.run_cli("register", "boarded", "demo-w-a")
        out = self.run_cli("request", "boarded", "demo-w-a")[1]
        self.assertEqual(out["board"], {"project": "org/12", "field": "Status", "start": "In Progress", "done": "In Review"})

    def test_status_needs_user_and_blocked(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.run_cli("status", "demo", "demo-w-a", "g1", "needs-user", "--reason", "pick an API shape")
        self.assertEqual((code, out), (0, {"goal": "g1", "status": "needs-user", "reason": "pick an API shape"}))
        code, out = self.run_cli("status", "demo", "demo-w-a", "g1", "blocked", "--reason", "CI is down")
        self.assertEqual(out, {"goal": "g1", "status": "needs-user", "reason": "blocked: CI is down"})
        code, out = self.run_cli("status", "demo", "demo-w-a", "g1", "assigned")
        self.assertEqual(out, {"goal": "g1", "status": "assigned", "reason": None})

    def test_status_requires_reason(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.run_cli("status", "demo", "demo-w-a", "g1", "needs-user")
        self.assertEqual(code, 2)
        self.assertIn("reason is required", out["error"])

    def test_report_on_someone_elses_goal_is_rejected(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("register", "demo", "demo-w-b")
        self.run_cli("request", "demo", "demo-w-a")
        for argv in (("status", "demo", "demo-w-b", "g1", "needs-user", "--reason", "x"),
                     ("done", "demo", "demo-w-b", "g1", "--notes", "x")):
            code, out = self.run_cli(*argv)
            self.assertEqual(code, 2)
            self.assertIn("g1 is not assigned to demo-w-b", out["error"])

    def test_done_moves_to_in_review(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.run_cli("done", "demo", "demo-w-a", "g1", "--pr", "https://x/pull/1", "--notes", "token is now JWT")
        self.assertEqual((code, out), (0, {"goal": "g1", "status": "in-review", "newly_ready": []}))
        s = self.state()
        self.assertEqual(s["goals"]["g1"]["handoff"], {"pr": "https://x/pull/1", "notes": "token is now JWT"})
        self.assertEqual(s["workers"]["demo-w-a"]["current"], None)
        self.assertEqual(s["workers"]["demo-w-a"]["history"], ["g1"])
        log = (Path(self.tmp.name) / "demo" / "events.log").read_text()
        self.assertIn("demo-w-a DONE g1 pr=https://x/pull/1", log)

    def test_done_requires_notes(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.run_cli("done", "demo", "demo-w-a", "g1", "--notes", "")
        self.assertEqual(code, 2)
        self.assertIn("handoff notes are required", out["error"])

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

    def test_done_appends_final_pr_after_earlier_ones(self):
        self.start_g1()
        self.run_cli("pr", "demo", "demo-w-a", "g1", "--url", "https://example.com/pull/1")
        self.run_cli("pr", "demo", "demo-w-a", "g1", "--url", "https://example.com/pull/2")
        self.run_cli("done", "demo", "demo-w-a", "g1", "--pr", "https://example.com/pull/3", "--notes", "n")
        self.assertEqual(self.state()["goals"]["g1"]["prs"], [f"https://example.com/pull/{i}" for i in (1, 2, 3)])

    def _legacy_resent_goal(self):
        self.start_g1()
        path = Path(self.tmp.name) / "demo" / "state.json"
        st = json.loads(path.read_text())
        g = st["goals"]["g1"]
        g.pop("prs", None)
        g["handoff"] = {"pr": "https://example.com/pull/1", "notes": "n"}
        path.write_text(json.dumps(st))

    def test_done_keeps_legacy_pr_when_resent_with_new_pr(self):
        self._legacy_resent_goal()
        self.run_cli("done", "demo", "demo-w-a", "g1", "--pr", "https://example.com/pull/2", "--notes", "n")
        self.assertEqual(self.state()["goals"]["g1"]["prs"],
                         ["https://example.com/pull/1", "https://example.com/pull/2"])

    def test_done_keeps_legacy_pr_when_resent_without_pr(self):
        self._legacy_resent_goal()
        self.run_cli("done", "demo", "demo-w-a", "g1", "--notes", "n")
        self.assertEqual(self.state()["goals"]["g1"]["prs"], ["https://example.com/pull/1"])

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


class UserTests(Base):
    def setUp(self):
        super().setUp()
        self.init()
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("register", "demo", "demo-w-b")

    def finish_g1(self):
        self.run_cli("request", "demo", "demo-w-a")
        self.run_cli("done", "demo", "demo-w-a", "g1", "--notes", "n")

    def test_approve_unblocks_dependents(self):
        self.finish_g1()
        self.assertEqual(self.run_cli("approve", "demo", "g1"),
                         (0, {"goal": "g1", "status": "done", "newly_ready": ["g2", "g3"], "all_done": False}))
        self.assertIn("user APPROVE g1", (Path(self.tmp.name) / "demo" / "events.log").read_text())

    def test_approve_only_from_in_review(self):
        code, out = self.run_cli("approve", "demo", "g1")
        self.assertEqual(code, 2)
        self.assertIn("g1 is ready, only in-review goals can be approved", out["error"])

    def test_request_prefers_goals_related_to_history(self):
        p = plan({
            "x1": {"title": "X1", "summary": "s", "depends_on": []},
            "x2": {"title": "X2", "summary": "s", "depends_on": []},
            "x4": {"title": "X4", "summary": "s", "depends_on": []},
            "x3": {"title": "X3", "summary": "s", "depends_on": ["x1"]},
        })
        p["epic"]["slug"] = "aff"
        self.init(p, slug="aff")
        self.run_cli("register", "aff", "demo-w-a")
        self.run_cli("register", "aff", "demo-w-b")
        self.assertEqual(self.run_cli("request", "aff", "demo-w-a")[1]["assigned"], "x1")
        self.assertEqual(self.run_cli("request", "aff", "demo-w-b")[1]["assigned"], "x2")
        self.run_cli("done", "aff", "demo-w-a", "x1", "--notes", "n")
        self.run_cli("approve", "aff", "x1")
        out = self.run_cli("request", "aff", "demo-w-a")[1]
        self.assertEqual(out["assigned"], "x3")
        self.assertEqual(out["upstream"], [{"goal": "x1", "title": "X1", "status": "done", "pr": None, "notes": "n"}])

    def test_sendback_returns_goal_to_same_worker(self):
        self.finish_g1()
        self.assertEqual(self.run_cli("sendback", "demo", "g1", "--reason", "add tests"),
                         (0, {"goal": "g1", "status": "assigned", "worker": "demo-w-a"}))
        s = self.state()
        self.assertEqual(s["workers"]["demo-w-a"]["current"], "g1")
        self.assertEqual(s["goals"]["g1"]["reason"], "sent back: add tests")

    def test_sendback_refuses_busy_worker(self):
        self.run_cli("policy", "demo", "in-review")
        self.finish_g1()
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.run_cli("sendback", "demo", "g1", "--reason", "x")
        self.assertEqual(code, 2)
        self.assertIn("demo-w-a is busy with g2", out["error"])

    def test_release_frees_worker(self):
        self.run_cli("request", "demo", "demo-w-a")
        self.assertEqual(self.run_cli("release", "demo", "g1"), (0, {"goal": "g1", "status": "ready"}))
        s = self.state()
        self.assertIsNone(s["workers"]["demo-w-a"]["current"])
        self.assertIsNone(s["goals"]["g1"]["worker"])

    def test_policy_in_review_unblocks_early(self):
        self.finish_g1()
        self.assertEqual(self.run_cli("policy", "demo", "in-review"),
                         (0, {"unblock_on": "in-review", "newly_ready": ["g2", "g3"]}))

    def test_start_forces_a_blocked_goal(self):
        self.assertEqual(self.run_cli("start", "demo", "g4"), (0, {"goal": "g4", "status": "ready"}))
        self.assertTrue(self.state()["goals"]["g4"]["override"]["start"])
        code, out = self.run_cli("start", "demo", "g4")
        self.assertEqual(code, 2)
        self.assertIn("only blocked goals", out["error"])

    def test_prioritize_changes_assignment_order(self):
        self.finish_g1()
        self.run_cli("approve", "demo", "g1")
        self.assertEqual(self.run_cli("prioritize", "demo", "g3")[1], {"order": ["g3", "g1", "g2", "g4"]})
        self.assertEqual(self.run_cli("request", "demo", "demo-w-b")[1]["assigned"], "g3")

    def test_add_and_drop_goal(self):
        code, out = self.run_cli("add-goal", "demo", "--goal-json",
                                 json.dumps({"id": "g5", "title": "Docs", "summary": "s", "depends_on": ["g1"]}))
        self.assertEqual((code, out), (0, {"added": "g5", "status": "blocked"}))
        code, out = self.run_cli("add-goal", "demo", "--goal-json", json.dumps({"id": "g5", "title": "t", "summary": "s"}))
        self.assertIn("g5 already exists", out["error"])
        code, out = self.run_cli("drop-goal", "demo", "g2")
        self.assertIn("g4 depends on g2", out["error"])
        self.assertEqual(self.run_cli("drop-goal", "demo", "g5"), (0, {"dropped": "g5"}))

    def test_add_goal_rejects_non_object(self):
        code, out = self.run_cli("add-goal", "demo", "--goal-json", "[]")
        self.assertEqual(code, 2)
        self.assertIn("must be an object", out["error"])

    def test_drop_refuses_owned_goal(self):
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.run_cli("drop-goal", "demo", "g1")
        self.assertEqual(code, 2)
        self.assertIn("only blocked or ready goals can be dropped", out["error"])

    def test_rename_worker_moves_goal(self):
        self.run_cli("request", "demo", "demo-w-a")
        self.run_cli("register", "demo", "demo-w-auth")
        self.assertEqual(self.run_cli("rename-worker", "demo", "demo-w-a", "demo-w-auth"),
                         (0, {"renamed": "demo-w-a", "to": "demo-w-auth", "current": "g1"}))
        s = self.state()
        self.assertNotIn("demo-w-a", s["workers"])
        self.assertEqual(s["goals"]["g1"]["worker"], "demo-w-auth")

    def test_rename_refuses_busy_target(self):
        self.run_cli("request", "demo", "demo-w-a")
        self.run_cli("policy", "demo", "in-review")
        code, out = self.run_cli("rename-worker", "demo", "demo-w-b", "demo-w-a")
        self.assertEqual(code, 2)
        self.assertIn("demo-w-a already has work", out["error"])

    def test_liveness_flags_gone_workers_with_goals(self):
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.run_cli("liveness", "demo", "--live", "demo-w-b,demo-manager")
        self.assertEqual((code, out), (0, {"live": ["demo-w-b"], "gone": ["demo-w-a"], "gone_with_goal": ["demo-w-a"]}))
        self.assertIn("| demo-w-a | g1 |  | gone |", self.run_cli("show", "demo")[1])


class NoticeTests(Base):
    def setUp(self):
        super().setUp()
        self.init()
        for w in ("demo-w-a", "demo-w-b", "demo-w-c"):
            self.run_cli("register", "demo", w)
        self.run_cli("request", "demo", "demo-w-a")  # a: g1
        self.run_cli("done", "demo", "demo-w-a", "g1", "--notes", "base ready")
        self.run_cli("approve", "demo", "g1")
        self.run_cli("request", "demo", "demo-w-a")  # a: g2
        self.run_cli("request", "demo", "demo-w-b")  # b: g3; c stays idle

    def notify(self, *extra):
        return self.run_cli("notify", "demo", "--kind", "changed", "--summary", "API renamed", *extra)

    def test_default_recipients_are_related_live_goals(self):
        code, out = self.notify("--goal", "g1")  # g2 and g3 depend on g1
        self.assertEqual(code, 0, out)
        self.assertEqual(out["id"], 1)
        self.assertEqual(sorted(out["to"]), ["demo-w-a", "demo-w-b"])

    def test_unrelated_goal_is_not_notified(self):
        code, out = self.notify("--goal", "g2")  # g3 is neither dependent nor dependency of g2
        self.assertEqual(out["to"], ["demo-w-a"])

    def test_epic_wide_goes_to_every_worker_holding_a_goal(self):
        code, out = self.notify()
        self.assertEqual(sorted(out["to"]), ["demo-w-a", "demo-w-b"])
        self.assertIsNone(out["goal"])

    def test_to_overrides_defaults_and_can_include_idle_worker(self):
        code, out = self.notify("--goal", "g2", "--to", "demo-w-c")
        self.assertEqual(out["to"], ["demo-w-c"])

    def test_dry_run_saves_nothing(self):
        code, out = self.notify("--goal", "g1", "--dry-run")
        self.assertEqual((code, out["id"], sorted(out["to"])), (0, 1, ["demo-w-a", "demo-w-b"]))
        self.assertNotIn("notices", self.state())
        self.assertEqual(self.notify("--goal", "g1")[1]["id"], 1)

    def test_pending_notice_shows_in_status_md_and_html_only_while_pending(self):
        md_path = Path(self.tmp.name) / "demo" / "status.md"
        html_path = Path(self.tmp.name) / "demo" / "status.html"
        self.assertNotIn("Pending notices", md_path.read_text())
        self.notify()
        self.assertIn("## Pending notices", md_path.read_text())
        self.assertIn("- #1 (changed, epic-wide): waiting on demo-w-a, demo-w-b", md_path.read_text())
        self.assertIn("Pending notices", html_path.read_text())
        self.run_cli("noticed", "demo", "demo-w-a", "1")
        self.run_cli("noticed", "demo", "demo-w-b", "1")
        self.assertNotIn("Pending notices", md_path.read_text())
        self.assertNotIn("Pending notices", html_path.read_text())

    def test_show_lists_pending_notices(self):
        self.notify("--goal", "g2")
        code, out = self.run_cli("show", "demo")
        self.assertIn("- #1 (changed, g2): waiting on demo-w-a", out)

    def test_rename_worker_rekeys_notice_recipients(self):
        self.notify()  # epic-wide: demo-w-a and demo-w-b
        self.assertEqual(self.run_cli("rename-worker", "demo", "demo-w-a", "demo-w-d")[0], 0)
        code, out = self.run_cli("pending-notices", "demo")
        pending = [p for n in out for p in n["pending"]]
        self.assertIn("demo-w-d", pending)
        self.assertNotIn("demo-w-a", pending)
        self.assertEqual(self.run_cli("noticed", "demo", "demo-w-d", "1")[0], 0)
        code, out = self.run_cli("pending-notices", "demo")
        self.assertEqual([p for n in out for p in n["pending"]], ["demo-w-b"])

    def test_unregistered_recipient_is_rejected(self):
        code, out = self.notify("--to", "demo-w-zzz")
        self.assertEqual(code, 2)
        self.assertIn("demo-w-zzz is not registered", out["error"])

    def test_no_recipients_is_an_error(self):
        solo = plan({"s1": {"title": "Solo", "summary": "solo work", "depends_on": []}},
                    epic={"slug": "solo", "title": "Solo epic", "source": None})
        self.init(solo, slug="solo")
        self.run_cli("register", "solo", "demo-w-c")
        code, out = self.run_cli("notify", "solo", "--kind", "added", "--summary", "x", "--goal", "s1")
        self.assertEqual(code, 2)
        self.assertIn("no recipients", out["error"])

    def test_unknown_goal_without_to_is_an_error(self):
        code, out = self.notify("--goal", "nope")
        self.assertEqual(code, 2)
        self.assertIn("unknown goal nope; for a dropped goal pass --to", out["error"])

    def test_unknown_goal_with_to_is_allowed_for_dropped_goals(self):
        code, out = self.run_cli("notify", "demo", "--kind", "dropped", "--summary", "g9 removed",
                                 "--goal", "g9", "--to", "demo-w-a")
        self.assertEqual(code, 0, out)

    def test_bad_summary_is_rejected(self):
        code, out = self.run_cli("notify", "demo", "--kind", "changed", "--summary", " ")
        self.assertEqual(code, 2)
        self.assertIn("summary", out["error"])
        code, out = self.run_cli("notify", "demo", "--kind", "changed", "--summary", "\n".join(["x"] * 12))
        self.assertEqual(code, 2)
        self.assertIn("at most 10 lines", out["error"])

    def test_ids_increase_and_event_is_logged(self):
        self.notify()
        code, out = self.notify()
        self.assertEqual(out["id"], 2)
        log = (Path(self.tmp.name) / "demo" / "events.log").read_text()
        self.assertIn("manager NOTICE 2 - changed to=demo-w-a,demo-w-b", log)

    def test_noticed_records_ack_and_pending_shrinks(self):
        self.notify()
        code, out = self.run_cli("noticed", "demo", "demo-w-a", "1")
        self.assertEqual(code, 0, out)
        self.assertEqual(out["pending"], ["demo-w-b"])
        code, out = self.run_cli("pending-notices", "demo")
        self.assertEqual(out, [{"id": 1, "goal": None, "kind": "changed",
                                "summary": out[0]["summary"], "pending": ["demo-w-b"]}])
        self.assertTrue(out[0]["summary"])
        self.run_cli("noticed", "demo", "demo-w-b", "1")
        self.assertEqual(self.run_cli("pending-notices", "demo")[1], [])

    def test_noticed_rejects_non_recipient_and_unknown_id(self):
        self.notify("--goal", "g2")
        code, out = self.run_cli("noticed", "demo", "demo-w-b", "1")
        self.assertEqual(code, 2)
        self.assertIn("not a recipient", out["error"])
        code, out = self.run_cli("noticed", "demo", "demo-w-a", "9")
        self.assertEqual(code, 2)
        self.assertIn("unknown notice 9", out["error"])

    def test_old_state_without_notices_still_loads(self):
        state = self.state()
        self.assertNotIn("notices", state)
        self.assertEqual(self.run_cli("pending-notices", "demo"), (0, []))

    def test_validate_rejects_malformed_notices(self):
        state = self.state()
        state["notices"] = [{"id": 1}]
        self.assertTrue(any("notice" in p for p in orch_state.validate(state)))
        state["notices"] = "x"
        self.assertTrue(any("notices must be a list" in p for p in orch_state.validate(state)))


class EditTests(Base):
    def setUp(self):
        super().setUp()
        self.init()

    def events(self):
        return (Path(self.tmp.name) / "demo" / "events.log").read_text()

    def edit_goal(self, gid, **fields):
        return self.run_cli("edit-goal", "demo", gid, "--goal-json", json.dumps(fields))

    def test_edit_epic_title_and_source(self):
        code, out = self.run_cli("edit-epic", "demo", "--title", "Renamed", "--source", "https://example.com/epic/1")
        self.assertEqual((code, out), (0, {"epic": "demo", "fields": ["title", "source"]}))
        epic = self.state()["epic"]
        self.assertEqual((epic["title"], epic["source"]), ("Renamed", "https://example.com/epic/1"))
        self.assertIn("user EDIT epic title,source", self.events())
        self.assertIn("Renamed", (Path(self.tmp.name) / "demo" / "status.html").read_text())

    def test_edit_epic_clears_source(self):
        self.run_cli("edit-epic", "demo", "--source", "https://example.com/epic/1")
        self.assertEqual(self.run_cli("edit-epic", "demo", "--source", "")[0], 0)
        self.assertIsNone(self.state()["epic"]["source"])

    def test_edit_epic_needs_a_field(self):
        code, out = self.run_cli("edit-epic", "demo")
        self.assertEqual(code, 2)
        self.assertIn("nothing to edit", out["error"])

    def test_edit_epic_rejects_empty_title(self):
        code, out = self.run_cli("edit-epic", "demo", "--title", " ")
        self.assertEqual(code, 2)
        self.assertIn("title cannot be empty", out["error"])

    def test_edit_goal_updates_only_given_fields(self):
        code, out = self.edit_goal("g2", title="Left side", acceptance=["it works"])
        self.assertEqual((code, out), (0, {"edited": "g2", "fields": ["title", "acceptance"],
                                           "status": "blocked", "worker": None}))
        g = self.state()["goals"]["g2"]
        self.assertEqual((g["title"], g["summary"], g["acceptance"]), ("Left side", "left work", ["it works"]))
        self.assertIn("user EDIT g2 title,acceptance", self.events())

    def test_edit_goal_rejects_protected_and_unknown_keys(self):
        for key in ("status", "worker", "handoff", "colour"):
            code, out = self.edit_goal("g1", **{key: "x"})
            self.assertEqual(code, 2)
            self.assertIn(f"cannot edit {key}", out["error"])

    def test_edit_goal_rejects_empty_or_non_object(self):
        self.assertIn("nothing to edit", self.edit_goal("g1")[1]["error"])
        code, out = self.run_cli("edit-goal", "demo", "g1", "--goal-json", "[]")
        self.assertIn("must be an object", out["error"])
        self.assertIn("title cannot be empty", self.edit_goal("g1", title="")[1]["error"])

    def test_edit_goal_unknown_goal(self):
        self.assertIn("unknown goal zz", self.edit_goal("zz", title="t")[1]["error"])

    def test_edit_goal_dependencies_recompute(self):
        self.assertEqual(self.edit_goal("g2", depends_on=[])[1]["status"], "ready")
        self.assertEqual(self.edit_goal("g2", depends_on=["g3"])[1]["status"], "blocked")

    def test_edit_goal_rejects_bad_dependencies(self):
        code, out = self.edit_goal("g2", depends_on=["zz"])
        self.assertIn("g2: unknown dependency zz", out["error"])
        code, out = self.edit_goal("g1", depends_on=["g4"])
        self.assertIn("cycle", out["error"])
        self.assertIn("g2: depends_on must be a list", self.edit_goal("g2", depends_on="g1")[1]["error"])
        self.assertEqual(self.state()["goals"]["g1"]["depends_on"], [])

    def test_edit_goal_dependencies_refused_once_assigned(self):
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")
        code, out = self.edit_goal("g1", depends_on=["g2"])
        self.assertIn("g1 is assigned", out["error"])
        code, out = self.edit_goal("g1", summary="sharper")
        self.assertEqual((code, out["worker"]), (0, "demo-w-a"))


class EdgeCaseTests(Base):
    def test_add_goal_requires_id(self):
        self.init()
        code, out = self.run_cli("add-goal", "demo", "--goal-json", json.dumps({"title": "t", "summary": "s"}))
        self.assertEqual(code, 2)
        self.assertIn("needs an id", out["error"])

    def test_add_goal_unknown_dependency(self):
        self.init()
        code, out = self.run_cli("add-goal", "demo", "--goal-json",
                                 json.dumps({"id": "g5", "title": "t", "summary": "s", "depends_on": ["zz"]}))
        self.assertEqual(code, 2)
        self.assertIn("g5: unknown dependency zz", out["error"])
        self.assertNotIn("g5", self.state()["goals"])

    def test_depends_on_must_be_a_list(self):
        self.init()
        code, out = self.run_cli("add-goal", "demo", "--goal-json",
                                 json.dumps({"id": "g5", "title": "t", "summary": "s", "depends_on": "g1"}))
        self.assertEqual(code, 2)
        self.assertIn("depends_on must be a list", out["error"])

    def test_rename_to_unprefixed_name_is_rejected(self):
        self.init()
        self.run_cli("register", "demo", "demo-w-a")
        code, out = self.run_cli("rename-worker", "demo", "demo-w-a", "other")
        self.assertEqual(code, 2)
        self.assertIn("does not start with worker prefix", out["error"])

    def test_sendback_to_unregistered_worker_is_rejected(self):
        self.init()
        state = self.state()
        state["goals"]["g1"].update(status="in-review", worker="ghost")
        with self.assertRaises(orch_state.OrchError) as cm:
            orch_state.sendback(state, "g1", "redo")
        self.assertIn("no longer registered", str(cm.exception))

    def test_all_goals_done_reports_none_ready(self):
        self.init(plan({"g1": {"title": "Only", "summary": "s"}}))
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")
        self.run_cli("done", "demo", "demo-w-a", "g1", "--notes", "n")
        self.run_cli("approve", "demo", "g1")
        self.assertEqual(self.run_cli("request", "demo", "demo-w-a"), (0, {"none_ready": "all goals are done"}))

    def test_status_assigned_clears_reason(self):
        self.init()
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("request", "demo", "demo-w-a")
        self.run_cli("status", "demo", "demo-w-a", "g1", "needs-user", "--reason", "question")
        code, out = self.run_cli("status", "demo", "demo-w-a", "g1", "assigned")
        self.assertEqual((code, out), (0, {"goal": "g1", "status": "assigned", "reason": None}))
        self.assertIsNone(self.state()["goals"]["g1"]["reason"])

    def test_init_with_missing_plan_file_is_a_json_error(self):
        code, out = self.run_cli("init", "demo", "--plan", str(Path(self.tmp.name) / "nope.json"))
        self.assertEqual(code, 2)
        self.assertIn("error", out)

    def test_init_rejects_goals_that_are_not_an_object(self):
        code, out = self.init(plan(goals=["g1"]))
        self.assertEqual(code, 2)
        self.assertIn("must be an object", out["error"])

    def test_validate_reports_goal_missing_title(self):
        self.init()
        s = self.state()
        del s["goals"]["g1"]["title"]
        (Path(self.tmp.name) / "demo" / "state.json").write_text(json.dumps(s))
        code, out = self.run_cli("validate", "demo")
        self.assertEqual(code, 2)
        self.assertIn("g1: missing title", out["error"])

    def test_validate_reports_worker_missing_history(self):
        self.init()
        self.run_cli("register", "demo", "demo-w-a")
        s = self.state()
        del s["workers"]["demo-w-a"]["history"]
        (Path(self.tmp.name) / "demo" / "state.json").write_text(json.dumps(s))
        code, out = self.run_cli("show", "demo")
        self.assertEqual(code, 2)
        self.assertIn("worker demo-w-a: missing history", out["error"])


class CleanupTests(Base):
    def setUp(self):
        super().setUp()
        self.init(plan({"g1": {"title": "Only", "summary": "s"}}))
        self.run_cli("register", "demo", "demo-w-a")
        self.run_cli("register", "demo", "demo-w-b")
        self.run_cli("request", "demo", "demo-w-a")
        self.run_cli("done", "demo", "demo-w-a", "g1", "--notes", "n")

    def stub_stop(self):
        stop = mock.Mock(return_value={"stopped": True, "pid": 1})
        patcher = mock.patch.dict(sys.modules, {"orch_serve": mock.Mock(stop=stop)})
        patcher.start()
        self.addCleanup(patcher.stop)
        return stop

    def test_approve_reports_all_done(self):
        self.assertEqual(self.run_cli("approve", "demo", "g1"),
                         (0, {"goal": "g1", "status": "done", "newly_ready": [], "all_done": True}))

    def test_refuses_while_goals_are_open(self):
        code, out = self.run_cli("cleanup", "demo", "--delete")
        self.assertEqual(code, 2)
        self.assertIn("g1 (in-review)", out["error"])
        self.assertTrue((Path(self.tmp.name) / "demo" / "state.json").exists())

    def test_without_flags_only_lists_workers(self):
        self.run_cli("approve", "demo", "g1")
        self.assertEqual(self.run_cli("cleanup", "demo"), (0, {
            "cleaned": "demo", "deleted": False, "server_stopped": False,
            "workers": ["demo-w-a", "demo-w-b"]}))
        self.assertTrue((Path(self.tmp.name) / "demo" / "state.json").exists())

    def test_delete_removes_state_dir(self):
        self.run_cli("approve", "demo", "g1")
        code, out = self.run_cli("cleanup", "demo", "--delete")
        self.assertEqual((code, out["deleted"], out["workers"]), (0, True, ["demo-w-a", "demo-w-b"]))
        self.assertFalse((Path(self.tmp.name) / "demo").exists())

    def test_stop_server_when_no_other_orchestration(self):
        stop = self.stub_stop()
        self.run_cli("approve", "demo", "g1")
        code, out = self.run_cli("cleanup", "demo", "--delete", "--stop-server")
        self.assertEqual((code, out["server_stopped"]), (0, True))
        stop.assert_called_once_with()

    def test_server_kept_while_another_orchestration_exists(self):
        stop = self.stub_stop()
        self.init(plan(epic={"slug": "other", "title": "Other"}), slug="other")
        self.run_cli("approve", "demo", "g1")
        code, out = self.run_cli("cleanup", "demo", "--delete", "--stop-server")
        self.assertEqual((code, out["server_stopped"]), (0, False))
        self.assertIn("other", out["server_reason"])
        stop.assert_not_called()


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
        self.run_cli("pr", "demo", "demo-w-a", "g3", "--url", "https://github.com/o/r/pull/9")
        self.run_cli("pr", "demo", "demo-w-a", "g3", "--url", "https://github.com/o/r/pull/10")
        self.run_cli("liveness", "demo", "--live", "demo-w-a")
        return orch_state.load("demo")

    def test_status_md_matches_golden(self):
        state = self.build()
        expected = GOLDEN.read_text()
        self.assertEqual(orch_view.render_md(orch_state.view_model(state, [])), expected)
        self.assertEqual((Path(self.tmp.name) / "demo" / "status.md").read_text(), expected)


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

    def test_events_include_the_command_that_just_ran(self):
        self.init()
        with mock.patch.object(orch_view, "render_md", wraps=orch_view.render_md) as render:
            self.run_cli("register", "demo", "demo-w-a")
        vm = render.call_args[0][0]
        self.assertEqual(vm["events"][0]["event"], "REGISTER")
        self.assertEqual(vm["events"][0]["actor"], "demo-w-a")

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


if __name__ == "__main__":
    unittest.main()
