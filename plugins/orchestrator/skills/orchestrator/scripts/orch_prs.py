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
    return "pending" if check.get("status") not in (None, "COMPLETED") else "ok"


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
        except Exception:
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
