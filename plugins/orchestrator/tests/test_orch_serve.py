import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
from unittest import mock
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_orch_state import Base  # noqa: E402

import orch_serve  # noqa: E402
import orch_view  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[1] / "skills" / "orchestrator" / "scripts" / "orch_state.py"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


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
            with e:
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
        for path in ("/nope", "/..%2f..%2fetc%2fpasswd", "/events/nope", "/demo/", "/events/..%2fdemo", "/demo%0a", "/events/demo%0a"):
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

    def test_stream_survives_carriage_return(self):
        path = Path(self.tmp.name) / "demo" / "state.json"
        state = json.loads(path.read_text())
        state["goals"]["g1"]["title"] = "a\revent: x"
        path.write_text(json.dumps(state))
        resp = urllib.request.urlopen(self.base + "/events/demo", timeout=5)
        self.addCleanup(resp.close)
        raw = b""
        while not raw.endswith(b"\n\n") or b"data:" not in raw:
            line = resp.readline()
            self.assertNotEqual(line, b"", "stream closed")
            raw += line
        self.assertNotIn(b"\r", raw)
        for line in raw.decode().split("\n"):
            self.assertTrue(line == "" or line.startswith(("data: ", "retry: ")), line)
        message = "\n".join(l[len("data: "):] for l in raw.decode().split("\n") if l.startswith("data: "))
        self.assertIn("<td>a\nevent: x</td>", message)

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

    def test_ensure_readopts_live_server_without_record(self):
        _, first = self.cli("--ensure", "--port", self.port)
        rec = Path(self.tmp.name) / ".server.json"
        rec.unlink()
        code, again = self.cli("--ensure", "--port", self.port)
        self.assertEqual(code, 0, again)
        self.assertFalse(again["started"])
        self.assertEqual(again["pid"], first["pid"])
        self.assertEqual(json.loads(rec.read_text()), {"pid": first["pid"], "port": int(self.port)})

    def test_stop_keeps_record_when_server_survives(self):
        _, first = self.cli("--ensure", "--port", self.port)
        killed = []
        with mock.patch.object(orch_serve, "START_TIMEOUT", 0.3), \
                mock.patch.object(orch_serve.os, "kill", lambda pid, sig: killed.append(pid)):
            out = orch_serve.stop()
        self.assertEqual(killed, [first["pid"]])
        self.assertFalse(out["stopped"])
        self.assertTrue((Path(self.tmp.name) / ".server.json").exists())

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


if __name__ == "__main__":
    unittest.main()
