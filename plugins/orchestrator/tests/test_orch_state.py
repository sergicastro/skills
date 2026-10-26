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
                         (0, {"goal": "g1", "status": "done", "newly_ready": ["g2", "g3"]}))
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
