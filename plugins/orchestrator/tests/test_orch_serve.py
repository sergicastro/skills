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
