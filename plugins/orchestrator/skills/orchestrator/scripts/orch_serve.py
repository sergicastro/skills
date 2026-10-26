"""Live status server for the orchestrator. Run it through `orch_state.py serve`.

Pages are rendered fresh from the state directory on each request. Server-Sent Event
streams poll the files' mtimes and push the re-rendered <main> when they change.
"""
import fcntl
import http.client
import http.server
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
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
        return bool(orch_state.SLUG_RE.fullmatch(slug)) and (orch_state.root() / slug / "state.json").is_file()

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
                    data = "".join(f"data: {line}\n" for line in re.split(r"\r\n|\r|\n", render())) + "\n"
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


START_TIMEOUT = 5


def server_file():
    return orch_state.root() / ".server.json"


def url(rec):
    return f"http://127.0.0.1:{rec['port']}/"


def probe(port):
    """/healthz JSON from 127.0.0.1:port; {} if something else answers or is too slow;
    None only if the connection is refused."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1) as r:
            return json.loads(r.read().decode())
    except (urllib.error.HTTPError, http.client.HTTPException, ValueError):
        return {}
    except (TimeoutError, socket.timeout):
        return {}  # busy: something is listening but too slow to answer
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
        info = probe(port)
        if ours(info):  # a live server of ours lost its record: re-adopt it
            orch_state.write_atomic(server_file(), json.dumps({"pid": info["pid"], "port": port}) + "\n")
            return {"url": url({"port": port}), "started": False, "pid": info["pid"]}
        server_file().unlink(missing_ok=True)
        if info is not None:
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
        try:
            port = json.loads(server_file().read_text()).get("port")
        except (OSError, ValueError):
            port = None
        if port is None or probe(port) is None:  # refused: the record is stale
            server_file().unlink(missing_ok=True)
            return {"stopped": False, "reason": "no server running"}
        return {"stopped": False, "reason": f"server on port {port} did not answer; record kept"}
    os.kill(rec["pid"], signal.SIGTERM)
    deadline = time.monotonic() + START_TIMEOUT
    while time.monotonic() < deadline and probe(rec["port"]) is not None:
        time.sleep(0.1)
    if probe(rec["port"]) is not None:
        return {"stopped": False, "pid": rec["pid"], "reason": "server still answering after SIGTERM"}
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
