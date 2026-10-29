#!/usr/bin/env python3
"""State helper for the orchestrator skill. Only the manager session runs it.

Usage: orch_state.py <command> <slug> [args]
       orch_state.py cleanup <slug> [--delete] [--stop-server]
       orch_state.py serve [--port N] [--ensure | --stop]

Every command prints one JSON object to stdout and exits 0, except `show`, which
prints status.md. A rejected operation prints {"error": "..."} and exits 2.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

import orch_view

VERSION = 1
STATES = ("blocked", "ready", "assigned", "needs-user", "in-review", "done")
UNBLOCK = {"done": ("done",), "in-review": ("in-review", "done")}
NOTICE_KINDS = ("changed", "decision", "dependency-merged", "dropped", "added")
NOTICE_LIVE = ("assigned", "needs-user", "in-review")
NOTICE_MAX_LINES = 10
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
EVENTS_SHOWN = 30


class OrchError(Exception):
    pass


def now():
    return os.environ.get("ORCH_NOW") or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def root():
    return Path(os.environ.get("ORCH_ROOT") or Path.home() / ".claude-orchestrator")


def state_dir(slug):
    if not SLUG_RE.fullmatch(slug):
        raise OrchError(f"invalid slug {slug!r}: use lowercase letters, digits and dashes")
    return root() / slug


def new_goal(gid, raw):
    missing = [k for k in ("title", "summary") if not raw.get(k)]
    if missing:
        raise OrchError(f"{gid}: missing {', '.join(missing)}")
    deps = raw.get("depends_on", [])
    if not isinstance(deps, list) or not all(isinstance(d, str) for d in deps):
        raise OrchError(f"{gid}: depends_on must be a list of goal ids")
    return {
        "title": raw["title"],
        "summary": raw["summary"],
        "acceptance": raw.get("acceptance", []),
        "depends_on": deps,
        "repo": raw.get("repo"),
        "links": raw.get("links", []),
        "status": "blocked",
        "worker": None,
        "reason": None,
        "handoff": None,
        "override": None,
    }


def find_cycle(goals):
    color = {}
    stack = []

    def visit(gid):
        color[gid] = 1
        stack.append(gid)
        for dep in goals[gid].get("depends_on", []):
            if dep not in goals:
                continue
            if color.get(dep) == 1:
                return stack[stack.index(dep):] + [dep]
            if dep not in color:
                found = visit(dep)
                if found:
                    return found
        color[gid] = 2
        stack.pop()
        return None

    for gid in goals:
        if gid not in color:
            found = visit(gid)
            if found:
                return found
    return None


def validate(state):
    problems = []
    if state.get("version") != VERSION:
        problems.append(f"unsupported version {state.get('version')!r}")
    for key in ("epic", "manager", "worker_prefix", "policy", "goals", "workers"):
        if state.get(key) is None:
            problems.append(f"missing {key}")
    if problems:
        return problems
    if not state["epic"].get("slug"):
        problems.append("missing epic.slug")
    if state["policy"].get("unblock_on") not in UNBLOCK:
        problems.append(f"invalid policy.unblock_on {state['policy'].get('unblock_on')!r}")
    if not isinstance(state["goals"], dict) or not isinstance(state["workers"], dict):
        return problems + ["goals and workers must be objects"]
    if not state["goals"]:
        problems.append("no goals")
    goals = state["goals"]
    for gid, g in goals.items():
        if not isinstance(g, dict):
            problems.append(f"{gid}: goal must be an object")
            continue
        absent = [k for k in ("title", "status", "depends_on", "worker") if k not in g]
        if absent:
            problems.append(f"{gid}: missing {', '.join(absent)}")
            continue
        if not isinstance(g["depends_on"], list):
            problems.append(f"{gid}: depends_on must be a list")
            continue
        prs = g.get("prs", [])
        if not isinstance(prs, list) or not all(isinstance(p, str) for p in prs):
            problems.append(f"{gid}: prs must be a list of strings")
            continue
        if g.get("status") not in STATES:
            problems.append(f"{gid}: invalid status {g.get('status')}")
        for dep in g.get("depends_on", []):
            if dep not in goals:
                problems.append(f"{gid}: unknown dependency {dep}")
        if g.get("status") in ("assigned", "needs-user", "in-review") and g.get("worker") not in state["workers"]:
            problems.append(f"{gid}: {g.get('status')} but worker {g.get('worker')!r} is not registered")
    if problems:
        return problems
    cycle = find_cycle(goals)
    if cycle:
        problems.append("dependency cycle: " + " -> ".join(cycle))
    for name, w in state["workers"].items():
        if not name.startswith(state["worker_prefix"]):
            problems.append(f"worker {name} lacks prefix {state['worker_prefix']}")
        absent = [k for k in ("current", "history", "last_seen") if not isinstance(w, dict) or k not in w]
        if absent:
            problems.append(f"worker {name}: missing {', '.join(absent)}")
            continue
        cur = w.get("current")
        if cur is not None and (cur not in goals or goals[cur].get("worker") != name):
            problems.append(f"worker {name}: current goal {cur} does not belong to it")
    notices = state.get("notices", [])
    if not isinstance(notices, list):
        problems.append("notices must be a list")
    else:
        for n in notices:
            if not (isinstance(n, dict) and isinstance(n.get("id"), int) and n.get("kind") in NOTICE_KINDS
                    and n.get("summary") and isinstance(n.get("to"), dict)):
                problems.append(f"malformed notice {n!r}")
    return problems


def recompute(state):
    """Move unowned goals between blocked and ready. Returns the goals that became ready."""
    ok = UNBLOCK[state["policy"]["unblock_on"]]
    goals = state["goals"]
    newly = []
    for gid, g in goals.items():
        if g["status"] not in ("blocked", "ready"):
            continue
        forced = (g.get("override") or {}).get("start")
        met = forced or all(goals[d]["status"] in ok for d in g["depends_on"])
        new = "ready" if met else "blocked"
        if new == "ready" and g["status"] == "blocked":
            newly.append(gid)
        g["status"] = new
    return newly


def load(slug):
    path = state_dir(slug) / "state.json"
    if not path.exists():
        raise OrchError(f"no orchestration named {slug!r} under {root()}")
    try:
        state = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise OrchError(f"state.json is not valid JSON: {e}")
    problems = validate(state)
    if problems:
        raise OrchError("state.json failed validation: " + "; ".join(problems))
    return state


def write_atomic(path, text):
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".")
    with os.fdopen(fd, "w") as f:
        f.write(text)
    os.replace(tmp, path)


def save(slug, state, events):
    d = state_dir(slug)
    d.mkdir(parents=True, exist_ok=True)
    write_atomic(d / "state.json", json.dumps(state, indent=2) + "\n")
    with open(d / "events.log", "a") as f:
        for actor, event, details in events:
            f.write(f"{now()} {actor} {event} {details}".rstrip() + "\n")
    write_views(d, state)


def write_views(d, state):
    vm = view_model(state, read_events(d))
    write_atomic(d / "status.md", orch_view.render_md(vm))
    page = orch_view.render_page(vm["title"], orch_view.main_html(vm), f"/events/{vm['slug']}")
    write_atomic(d / "status.html", page)


def read_events(d, limit=EVENTS_SHOWN):
    """The last `limit` lines of events.log, newest first."""
    path = Path(d) / "events.log"
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines()[-limit:]:
        parts = line.split(" ", 3)
        if len(parts) < 3:
            continue
        out.append({"at": parts[0], "actor": parts[1], "event": parts[2],
                    "details": parts[3] if len(parts) > 3 else ""})
    return out[::-1]


def depths(goals):
    """Column per goal: the longest dependency path back to a goal with no dependencies."""
    memo = {}

    def depth(gid):
        if gid not in memo:
            memo[gid] = 0  # placeholder so a cycle in unvalidated state can't recurse forever
            deps = [d for d in goals[gid].get("depends_on", []) if d in goals]
            memo[gid] = 1 + max(depth(d) for d in deps) if deps else 0
        return memo[gid]

    return {gid: depth(gid) for gid in goals}


def goal_prs(g):
    """All PR URLs of a goal. Older state files only have handoff.pr."""
    prs = list(g.get("prs") or [])
    legacy = (g.get("handoff") or {}).get("pr")
    if legacy and legacy not in prs:
        prs.insert(0, legacy)
    return prs


def view_model(state, events, problems=()):
    e = state["epic"]
    goals = state["goals"]
    ok = UNBLOCK.get(state["policy"].get("unblock_on"), UNBLOCK["done"])
    col = depths(goals)
    used = {}
    rows = {}
    for gid in goals:
        rows[gid] = used.get(col[gid], 0)
        used[col[gid]] = rows[gid] + 1
    return {
        "slug": e["slug"],
        "title": e.get("title") or e["slug"],
        "source": e.get("source"),
        "manager": state["manager"],
        "worker_prefix": state["worker_prefix"],
        "unblock_on": state["policy"].get("unblock_on"),
        "counts": [(s, sum(1 for g in goals.values() if g["status"] == s)) for s in STATES],
        "goals": [{"id": gid, "title": g["title"], "status": g["status"], "worker": g["worker"],
                   "prs": goal_prs(g), "reason": g.get("reason"),
                   "depends_on": g["depends_on"], "col": col[gid], "row": rows[gid]}
                  for gid, g in goals.items()],
        "edges": [{"from": dep, "to": gid, "met": goals[dep]["status"] in ok}
                  for gid, g in goals.items() for dep in g["depends_on"] if dep in goals],
        "live_checked": state.get("live_checked"),
        "workers": [{"name": n, "current": w["current"], "history": w["history"],
                     "live": w.get("live"), "last_seen": w["last_seen"]}
                    for n, w in state["workers"].items()],
        "events": list(events),
        "problems": list(problems),
        "notices": pending_notices(state),
        "updated": now(),
    }


def goal(state, gid):
    if gid not in state["goals"]:
        raise OrchError(f"unknown goal {gid}")
    return state["goals"][gid]


def init(slug, plan):
    if (state_dir(slug) / "state.json").exists():
        raise OrchError(f"orchestration {slug!r} already exists")
    epic = plan.get("epic") or {}
    if epic.get("slug") != slug:
        raise OrchError(f"plan epic.slug {epic.get('slug')!r} does not match {slug!r}")
    raw_goals = plan.get("goals") or {}
    if not isinstance(raw_goals, dict):
        raise OrchError("plan goals must be an object keyed by goal id")
    goals = {gid: new_goal(gid, raw) for gid, raw in raw_goals.items()}
    state = {
        "version": VERSION,
        "epic": epic,
        "manager": plan.get("manager"),
        "worker_prefix": plan.get("worker_prefix"),
        "policy": plan.get("policy") or {"unblock_on": "done"},
        "board": plan.get("board"),
        "goals": goals,
        "workers": {},
    }
    problems = validate(state)
    if problems:
        raise OrchError("plan failed validation: " + "; ".join(problems))
    recompute(state)
    return state


def require_worker(state, name):
    if name not in state["workers"]:
        raise OrchError(f"{name} is not registered")
    w = state["workers"][name]
    w["last_seen"] = now()
    return w


def owned_goal(state, worker, gid):
    g = goal(state, gid)
    if g["worker"] != worker or g["status"] not in ("assigned", "needs-user"):
        raise OrchError(f"{gid} is not assigned to {worker}")
    return g


def register(state, name):
    prefix = state["worker_prefix"]
    if not name.startswith(prefix):
        raise OrchError(f"{name} does not start with worker prefix {prefix!r}")
    w = state["workers"].get(name)
    if w:
        w["last_seen"] = now()
        return {"registered": name, "new": False, "current": w["current"]}, [(name, "REGISTER", "again")]
    state["workers"][name] = {"registered": now(), "current": None, "history": [], "last_seen": now(), "live": None}
    return {"registered": name, "new": True, "current": None}, [(name, "REGISTER", "")]


def assignment(state, gid):
    goals = state["goals"]
    g = goals[gid]
    upstream = []
    for dep in g["depends_on"]:
        handoff = goals[dep]["handoff"] or {}
        upstream.append({"goal": dep, "title": goals[dep]["title"], "status": goals[dep]["status"],
                         "pr": ", ".join(goal_prs(goals[dep])) or None, "notes": handoff.get("notes")})
    board = state.get("board")
    if board:
        board = {"project": board["project"], "field": board["field"],
                 "start": board["mapping"].get("assigned"), "done": board["mapping"].get("in-review")}
    slug = state["epic"]["slug"]
    return {"assigned": gid, "epic": slug, "title": g["title"], "summary": g["summary"],
            "acceptance": g["acceptance"], "repo": g["repo"], "links": g["links"],
            "upstream": upstream, "board": board, "state_dir": str(state_dir(slug))}


def none_ready_reason(state):
    goals = state["goals"]
    ok = UNBLOCK[state["policy"]["unblock_on"]]
    waiting = {}
    for gid, g in goals.items():
        if g["status"] == "blocked":
            for dep in g["depends_on"]:
                # report only the nearest unfinished dependency, not blocked ones in between
                if goals[dep]["status"] not in ok and goals[dep]["status"] != "blocked":
                    waiting.setdefault(dep, []).append(gid)
    if waiting:
        return "; ".join(f"{dep} ({goals[dep]['status']}) blocks {', '.join(b)}" for dep, b in waiting.items())
    remaining = [gid for gid, g in goals.items() if g["status"] != "done"]
    if not remaining:
        return "all goals are done"
    return "every open goal is already taken or in review: " + ", ".join(remaining)


def request(state, name):
    w = require_worker(state, name)
    if w["current"]:
        cur = w["current"]
        raise OrchError(f"{name} already has goal {cur} ({state['goals'][cur]['status']})")
    goals = state["goals"]
    ready = [gid for gid, g in goals.items() if g["status"] == "ready"]
    if not ready:
        return {"none_ready": none_ready_reason(state)}, [(name, "REQUEST", "none-ready")]
    related = [gid for gid in ready if set(goals[gid]["depends_on"]) & set(w["history"])]
    gid = (related or ready)[0]
    g = goals[gid]
    g["status"], g["worker"], g["reason"] = "assigned", name, None
    w["current"] = gid
    return assignment(state, gid), [(name, "REQUEST", ""), ("manager", "ASSIGN", f"{gid} -> {name}")]


def report_status(state, name, gid, new, reason):
    require_worker(state, name)
    g = owned_goal(state, name, gid)
    if new != "assigned" and not reason:
        raise OrchError("a reason is required for needs-user and blocked")
    if new == "assigned":
        g["status"], g["reason"] = "assigned", None
    else:
        g["status"] = "needs-user"
        g["reason"] = reason if new == "needs-user" else f"blocked: {reason}"
    return {"goal": gid, "status": g["status"], "reason": g["reason"]}, [(name, "STATUS", f"{gid} {new} {reason or ''}")]


def report_pr(state, name, gid, url):
    require_worker(state, name)
    g = owned_goal(state, name, gid)
    url = (url or "").strip()
    if not url:
        raise OrchError("url is required")
    prs = goal_prs(g)
    added = url not in prs
    if added:
        prs.append(url)
    g["prs"] = prs
    return {"goal": gid, "prs": prs, "added": added}, [(name, "PR", f"{gid} {url}")]


def done(state, name, gid, pr, notes):
    w = require_worker(state, name)
    g = owned_goal(state, name, gid)
    if not notes:
        raise OrchError("handoff notes are required")
    g["status"], g["reason"] = "in-review", None
    g["handoff"] = {"pr": pr, "notes": notes}
    if pr:
        g["prs"] = goal_prs(g)
    w["current"] = None
    if gid not in w["history"]:
        w["history"].append(gid)
    newly = recompute(state)
    return {"goal": gid, "status": "in-review", "newly_ready": newly}, [(name, "DONE", f"{gid} pr={pr or '-'}")]


def approve(state, gid):
    g = goal(state, gid)
    if g["status"] != "in-review":
        raise OrchError(f"{gid} is {g['status']}, only in-review goals can be approved")
    g["status"] = "done"
    newly = recompute(state)
    all_done = all(o["status"] == "done" for o in state["goals"].values())
    return {"goal": gid, "status": "done", "newly_ready": newly, "all_done": all_done}, [("user", "APPROVE", gid)]


def sendback(state, gid, reason):
    g = goal(state, gid)
    if g["status"] != "in-review":
        raise OrchError(f"{gid} is {g['status']}, only in-review goals can be sent back")
    name = g["worker"]
    w = state["workers"].get(name)
    if w is None:
        raise OrchError(f"{name} is no longer registered; use release to make {gid} available again")
    if w["current"]:
        raise OrchError(f"{name} is busy with {w['current']}; use release to make {gid} available to others")
    g["status"], g["reason"] = "assigned", f"sent back: {reason}"
    w["current"] = gid
    recompute(state)
    return {"goal": gid, "status": "assigned", "worker": name}, [("user", "SENDBACK", f"{gid} {reason}")]


def release(state, gid):
    g = goal(state, gid)
    if g["status"] not in ("assigned", "needs-user", "in-review"):
        raise OrchError(f"{gid} is {g['status']}, nothing to release")
    w = state["workers"].get(g["worker"])
    if w and w["current"] == gid:
        w["current"] = None
    g["status"], g["worker"], g["reason"] = "blocked", None, None
    recompute(state)
    return {"goal": gid, "status": g["status"]}, [("user", "RELEASE", gid)]


def default_recipients(state, gid):
    """Registered workers holding a live goal that is `gid`, depends on it or is a dependency of it.
    gid None means epic-wide: every worker holding a live goal."""
    goals = state["goals"]
    if gid is None:
        related = set(goals)
    else:
        related = {gid, *goals[gid]["depends_on"]} | {g for g, v in goals.items() if gid in v["depends_on"]}
    names = []
    for g in related:
        v = goals[g]
        if v["status"] in NOTICE_LIVE and v["worker"] in state["workers"] and v["worker"] not in names:
            names.append(v["worker"])
    return sorted(names)


def notify(state, kind, summary, gid, to, dry_run=False):
    if kind not in NOTICE_KINDS:
        raise OrchError(f"invalid kind {kind!r}: use one of {', '.join(NOTICE_KINDS)}")
    if not summary or not summary.strip():
        raise OrchError("summary is required")
    if len(summary.strip().splitlines()) > NOTICE_MAX_LINES:
        raise OrchError(f"summary must be at most {NOTICE_MAX_LINES} lines")
    if to:
        for name in to:
            if name not in state["workers"]:
                raise OrchError(f"{name} is not registered")
        names = list(dict.fromkeys(to))
    else:
        if gid is not None:
            try:
                goal(state, gid)
            except OrchError as e:
                raise OrchError(f"{e}; for a dropped goal pass --to")
        names = default_recipients(state, gid)
        if not names:
            raise OrchError("no recipients: no live worker is affected; pass --to to choose some")
    notices = state.setdefault("notices", [])
    nid = max((n["id"] for n in notices), default=0) + 1
    notices.append({"id": nid, "goal": gid, "kind": kind, "summary": summary.strip(), "sent": now(),
                    "to": {n: {"acked": None} for n in names}})
    result = {"id": nid, "goal": gid, "kind": kind, "summary": summary.strip(), "to": names}
    if dry_run:
        return result, []
    return result, [("manager", "NOTICE", f"{nid} {gid or '-'} {kind} to={','.join(names)}")]


def noticed(state, name, nid):
    w = require_worker(state, name)
    n = next((n for n in state.get("notices", []) if n["id"] == nid), None)
    if n is None:
        raise OrchError(f"unknown notice {nid}")
    if name not in n["to"]:
        raise OrchError(f"{name} is not a recipient of notice {nid}")
    n["to"][name]["acked"] = now()
    w["last_seen"] = now()
    pending = [k for k, v in n["to"].items() if not v["acked"]]
    return {"id": nid, "acked": name, "pending": pending}, [(name, "NOTICED", str(nid))]


def pending_notices(state):
    out = []
    for n in state.get("notices", []):
        pending = [k for k, v in n["to"].items() if not v["acked"]]
        if pending:
            out.append({"id": n["id"], "goal": n["goal"], "kind": n["kind"],
                        "summary": n["summary"], "pending": pending})
    return out


def set_policy(state, unblock_on):
    state["policy"]["unblock_on"] = unblock_on
    newly = recompute(state)
    return {"unblock_on": unblock_on, "newly_ready": newly}, [("user", "OVERRIDE", f"policy unblock_on={unblock_on}")]


def force_start(state, gid):
    g = goal(state, gid)
    if g["status"] != "blocked":
        raise OrchError(f"{gid} is {g['status']}; only blocked goals can be force-started")
    g["override"] = {"start": True, "at": now()}
    recompute(state)
    return {"goal": gid, "status": g["status"]}, [("user", "OVERRIDE", f"start {gid}")]


def prioritize(state, gids):
    for gid in gids:
        goal(state, gid)
    order = list(gids) + [gid for gid in state["goals"] if gid not in gids]
    state["goals"] = {gid: state["goals"][gid] for gid in order}
    return {"order": order}, [("user", "PRIORITIZE", " ".join(gids))]


def add_goal(state, raw):
    if not isinstance(raw, dict):
        raise OrchError("goal JSON must be an object")
    gid = raw.get("id")
    if not gid:
        raise OrchError("goal JSON needs an id")
    if gid in state["goals"]:
        raise OrchError(f"{gid} already exists")
    new = new_goal(gid, raw)
    for dep in new["depends_on"]:
        if dep not in state["goals"]:
            raise OrchError(f"{gid}: unknown dependency {dep}")
    state["goals"][gid] = new
    recompute(state)
    return {"added": gid, "status": state["goals"][gid]["status"]}, [("user", "ADD", gid)]


def drop_goal(state, gid):
    g = goal(state, gid)
    if g["status"] not in ("blocked", "ready"):
        raise OrchError(f"{gid} is {g['status']}; only blocked or ready goals can be dropped")
    dependents = [other for other, o in state["goals"].items() if gid in o["depends_on"]]
    if dependents:
        raise OrchError(f"{', '.join(dependents)} depends on {gid}; change those first")
    del state["goals"][gid]
    return {"dropped": gid}, [("user", "DROP", gid)]


EDITABLE = ("title", "summary", "acceptance", "repo", "links", "depends_on")


def edit_epic(state, title, source):
    fields = {}
    if title is not None:
        if not title.strip():
            raise OrchError("title cannot be empty")
        fields["title"] = title
    if source is not None:
        fields["source"] = source or None
    if not fields:
        raise OrchError("nothing to edit: pass --title and/or --source")
    state["epic"].update(fields)
    return {"epic": state["epic"]["slug"], "fields": list(fields)}, [("user", "EDIT", "epic " + ",".join(fields))]


def edit_goal(state, gid, raw):
    if not isinstance(raw, dict):
        raise OrchError("goal JSON must be an object")
    g = goal(state, gid)
    if not raw:
        raise OrchError(f"nothing to edit: pass any of {', '.join(EDITABLE)}")
    for key in raw:
        if key not in EDITABLE:
            raise OrchError(f"cannot edit {key}: editable fields are {', '.join(EDITABLE)}")
    for key in ("title", "summary"):
        if key in raw and not str(raw[key] or "").strip():
            raise OrchError(f"{gid}: {key} cannot be empty")
    if "depends_on" in raw:
        deps = raw["depends_on"]
        if not isinstance(deps, list) or not all(isinstance(d, str) for d in deps):
            raise OrchError(f"{gid}: depends_on must be a list of goal ids")
        if g["status"] not in ("blocked", "ready"):
            raise OrchError(f"{gid} is {g['status']}; dependencies can only change while blocked or ready")
        for dep in deps:
            if dep not in state["goals"]:
                raise OrchError(f"{gid}: unknown dependency {dep}")
        cycle = find_cycle(dict(state["goals"], **{gid: dict(g, depends_on=deps)}))
        if cycle:
            raise OrchError("dependency cycle: " + " -> ".join(cycle))
    g.update(raw)
    recompute(state)
    return ({"edited": gid, "fields": list(raw), "status": g["status"], "worker": g["worker"]},
            [("user", "EDIT", f"{gid} " + ",".join(raw))])


def rename_worker(state, old, new):
    w = require_worker(state, old)
    if not new.startswith(state["worker_prefix"]):
        raise OrchError(f"{new} does not start with worker prefix {state['worker_prefix']!r}")
    existing = state["workers"].get(new)
    if existing and (existing["current"] or existing["history"]):
        raise OrchError(f"{new} already has work recorded; refusing to merge")
    del state["workers"][old]
    state["workers"][new] = w
    for g in state["goals"].values():
        if g["worker"] == old:
            g["worker"] = new
    for n in state.get("notices", []):
        if old in n["to"]:
            n["to"][new] = n["to"].pop(old)
    return {"renamed": old, "to": new, "current": w["current"]}, [("user", "RENAME", f"{old} -> {new}")]


def liveness(state, live_csv):
    alive = {n.strip() for n in live_csv.split(",") if n.strip()}
    for name, w in state["workers"].items():
        w["live"] = name in alive
    state["live_checked"] = now()
    live = [n for n, w in state["workers"].items() if w["live"]]
    gone = [n for n, w in state["workers"].items() if not w["live"]]
    with_goal = [n for n in gone if state["workers"][n]["current"]]
    return {"live": live, "gone": gone, "gone_with_goal": with_goal}, [("manager", "LIVENESS", ",".join(gone) or "all-live")]


def cleanup(slug, delete, stop_server):
    state = load(slug)
    open_goals = [f"{gid} ({g['status']})" for gid, g in state["goals"].items() if g["status"] != "done"]
    if open_goals:
        raise OrchError("not every goal is done: " + ", ".join(open_goals))
    out = {"cleaned": slug, "deleted": False, "server_stopped": False, "workers": list(state["workers"])}
    if delete:
        shutil.rmtree(state_dir(slug))
        out["deleted"] = True
    if stop_server:
        r = root()
        others = sorted(p.name for p in r.iterdir() if p.name != slug and (p / "state.json").is_file())
        if others:
            out["server_reason"] = "other orchestrations remain: " + ", ".join(others)
        else:
            import orch_serve
            res = orch_serve.stop()
            out["server_stopped"] = res.get("stopped", False)
            if not out["server_stopped"]:
                out["server_reason"] = res.get("reason")
    return out


ARGS = {
    "init": [(["--plan"], {"required": True, "help": "path to the confirmed plan JSON"})],
    "validate": [],
    "show": [],
    "get": [(["goal"], {})],
}

COMMANDS = {
    "validate": lambda s, a: ({"valid": True, "goals": len(s["goals"])}, []),
    "get": lambda s, a: (dict({"goal": a.goal}, **goal(s, a.goal)), []),
}


ARGS.update({
    "register": [(["worker"], {})],
    "request": [(["worker"], {})],
    "status": [(["worker"], {}), (["goal"], {}),
               (["state"], {"choices": ["needs-user", "blocked", "assigned"]}), (["--reason"], {})],
    "done": [(["worker"], {}), (["goal"], {}), (["--pr"], {}), (["--notes"], {"required": True})],
    "pr": [(["worker"], {}), (["goal"], {}), (["--url"], {"required": True})],
})

COMMANDS.update({
    "register": lambda s, a: register(s, a.worker),
    "request": lambda s, a: request(s, a.worker),
    "status": lambda s, a: report_status(s, a.worker, a.goal, a.state, a.reason),
    "done": lambda s, a: done(s, a.worker, a.goal, a.pr, a.notes),
    "pr": lambda s, a: report_pr(s, a.worker, a.goal, a.url),
})


ARGS.update({
    "approve": [(["goal"], {})],
    "sendback": [(["goal"], {}), (["--reason"], {"required": True})],
    "release": [(["goal"], {})],
    "policy": [(["unblock_on"], {"choices": list(UNBLOCK)})],
    "start": [(["goal"], {})],
    "prioritize": [(["goals"], {"nargs": "+"})],
    "add-goal": [(["--goal-json"], {"required": True})],
    "drop-goal": [(["goal"], {})],
    "edit-epic": [(["--title"], {}), (["--source"], {"help": "an empty string removes the link"})],
    "edit-goal": [(["goal"], {}), (["--goal-json"], {"required": True, "help": "only the fields to change"})],
    "rename-worker": [(["old"], {}), (["new"], {})],
    "liveness": [(["--live"], {"default": "", "help": "comma-separated session names from ListAgents"})],
    "notify": [(["--kind"], {"required": True, "choices": list(NOTICE_KINDS)}),
               (["--summary"], {"required": True}),
               (["--goal"], {"help": "goal the notice is about; omit for an epic-wide notice"}),
               (["--to"], {"default": "", "help": "comma-separated worker names; default: affected workers"}),
               (["--dry-run"], {"action": "store_true", "help": "show recipients and id without recording anything"})],
    "noticed": [(["worker"], {}), (["id"], {"type": int})],
    "pending-notices": [],
})

COMMANDS.update({
    "approve": lambda s, a: approve(s, a.goal),
    "sendback": lambda s, a: sendback(s, a.goal, a.reason),
    "release": lambda s, a: release(s, a.goal),
    "policy": lambda s, a: set_policy(s, a.unblock_on),
    "start": lambda s, a: force_start(s, a.goal),
    "prioritize": lambda s, a: prioritize(s, a.goals),
    "add-goal": lambda s, a: add_goal(s, json.loads(a.goal_json)),
    "drop-goal": lambda s, a: drop_goal(s, a.goal),
    "edit-epic": lambda s, a: edit_epic(s, a.title, a.source),
    "edit-goal": lambda s, a: edit_goal(s, a.goal, json.loads(a.goal_json)),
    "rename-worker": lambda s, a: rename_worker(s, a.old, a.new),
    "liveness": lambda s, a: liveness(s, a.live),
    "notify": lambda s, a: notify(s, a.kind, a.summary, a.goal, [x for x in a.to.split(",") if x], a.dry_run),
    "noticed": lambda s, a: noticed(s, a.worker, a.id),
    "pending-notices": lambda s, a: (pending_notices(s), []),
})


def build_parser():
    p = argparse.ArgumentParser(prog="orch_state.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, args in ARGS.items():
        sp = sub.add_parser(name)
        sp.add_argument("slug")
        for flags, kwargs in args:
            sp.add_argument(*flags, **kwargs)
    sp = sub.add_parser("cleanup", help="tidy up an orchestration whose goals are all done")
    sp.add_argument("slug")
    sp.add_argument("--delete", action="store_true", help="delete the state directory")
    sp.add_argument("--stop-server", action="store_true", help="stop the status server if no other orchestration remains")
    sp = sub.add_parser("serve", help="live status pages for every orchestration")
    sp.add_argument("--port", type=int, default=8765)
    mode = sp.add_mutually_exclusive_group()
    mode.add_argument("--ensure", action="store_true", help="start in the background unless already running")
    mode.add_argument("--stop", action="store_true", help="stop the background server")
    return p


def main(argv=None):
    a = build_parser().parse_args(argv)
    try:
        if a.cmd == "serve":
            import orch_serve  # only serve needs the http and process machinery
            if not (a.ensure or a.stop):
                orch_serve.serve(a.port)
                return 0
            out = orch_serve.ensure(a.port) if a.ensure else orch_serve.stop()
        elif a.cmd == "init":
            state = init(a.slug, json.loads(Path(a.plan).read_text()))
            save(a.slug, state, [("manager", "INIT", f"{len(state['goals'])} goals")])
            out = {
                "initialized": a.slug,
                "state_dir": str(state_dir(a.slug)),
                "ready": [g for g, v in state["goals"].items() if v["status"] == "ready"],
                "blocked": [g for g, v in state["goals"].items() if v["status"] == "blocked"],
            }
        elif a.cmd == "cleanup":
            out = cleanup(a.slug, a.delete, a.stop_server)
        elif a.cmd == "show":
            sys.stdout.write(orch_view.render_md(view_model(load(a.slug), [])))
            return 0
        else:
            state = load(a.slug)
            out, events = COMMANDS[a.cmd](state, a)
            if events:
                problems = validate(state)
                if problems:
                    raise OrchError("refusing to save invalid state: " + "; ".join(problems))
                save(a.slug, state, events)
    except (OrchError, json.JSONDecodeError, KeyError, TypeError, AttributeError, OSError) as e:
        print(json.dumps({"error": str(e)}))
        return 2
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    # let orch_serve's `import orch_state` reuse this module instead of loading a second copy
    sys.modules.setdefault("orch_state", sys.modules["__main__"])
    sys.exit(main())
