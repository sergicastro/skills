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


if __name__ == "__main__":
    unittest.main()
