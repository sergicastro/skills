#!/usr/bin/env python3
"""State helper for the orchestrator skill. Only the manager session runs it.

Usage: orch_state.py <command> <slug> [args]

Every command prints one JSON object to stdout and exits 0, except `show`, which
prints status.md. A rejected operation prints {"error": "..."} and exits 2.
"""
import argparse
import datetime
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import orch_view

VERSION = 1
STATES = ("blocked", "ready", "assigned", "needs-user", "in-review", "done")
UNBLOCK = {"done": ("done",), "in-review": ("in-review", "done")}
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
EVENTS_SHOWN = 30


class OrchError(Exception):
    pass


def now():
    return os.environ.get("ORCH_NOW") or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def root():
    return Path(os.environ.get("ORCH_ROOT") or Path.home() / ".claude-orchestrator")


def state_dir(slug):
    if not SLUG_RE.match(slug):
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
                   "pr": (g.get("handoff") or {}).get("pr"), "reason": g.get("reason"),
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
                         "pr": handoff.get("pr"), "notes": handoff.get("notes")})
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


def done(state, name, gid, pr, notes):
    w = require_worker(state, name)
    g = owned_goal(state, name, gid)
    if not notes:
        raise OrchError("handoff notes are required")
    g["status"], g["reason"] = "in-review", None
    g["handoff"] = {"pr": pr, "notes": notes}
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
    return {"goal": gid, "status": "done", "newly_ready": recompute(state)}, [("user", "APPROVE", gid)]


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
})

COMMANDS.update({
    "register": lambda s, a: register(s, a.worker),
    "request": lambda s, a: request(s, a.worker),
    "status": lambda s, a: report_status(s, a.worker, a.goal, a.state, a.reason),
    "done": lambda s, a: done(s, a.worker, a.goal, a.pr, a.notes),
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
    "rename-worker": [(["old"], {}), (["new"], {})],
    "liveness": [(["--live"], {"default": "", "help": "comma-separated session names from ListAgents"})],
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
    "rename-worker": lambda s, a: rename_worker(s, a.old, a.new),
    "liveness": lambda s, a: liveness(s, a.live),
})


def build_parser():
    p = argparse.ArgumentParser(prog="orch_state.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, args in ARGS.items():
        sp = sub.add_parser(name)
        sp.add_argument("slug")
        for flags, kwargs in args:
            sp.add_argument(*flags, **kwargs)
    return p


def main(argv=None):
    a = build_parser().parse_args(argv)
    try:
        if a.cmd == "init":
            state = init(a.slug, json.loads(Path(a.plan).read_text()))
            save(a.slug, state, [("manager", "INIT", f"{len(state['goals'])} goals")])
            out = {
                "initialized": a.slug,
                "state_dir": str(state_dir(a.slug)),
                "ready": [g for g, v in state["goals"].items() if v["status"] == "ready"],
                "blocked": [g for g, v in state["goals"].items() if v["status"] == "blocked"],
            }
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
    sys.exit(main())
