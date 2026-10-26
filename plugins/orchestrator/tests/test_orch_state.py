import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "skills" / "orchestrator" / "scripts"))
import orch_state  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
