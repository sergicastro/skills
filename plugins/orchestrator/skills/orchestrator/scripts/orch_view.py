"""Renderers for the orchestrator status views.

Every function takes the view model built by orch_state.view_model() and returns text.
This module imports only the stdlib so orch_state can import it without a cycle.
"""
import html
import string
from pathlib import Path

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


def template(name):
    return string.Template((TEMPLATES / name).read_text())


def md_cell(value):
    return str(value or "").replace("|", "\\|").replace("\n", " ")


def render_md(vm):
    goal_rows = [
        f"| {g['id']} | {md_cell(g['title'])} | {g['status']} | {md_cell(g['worker'])} | {md_cell(g['pr'])} | {md_cell(g['reason'])} |"
        for g in vm["goals"]
    ]
    deps = [f"- {g['id']} ← {', '.join(g['depends_on'])}" for g in vm["goals"] if g["depends_on"]]
    live_label = {True: "yes", False: "gone", None: "?"}
    worker_rows = [
        f"| {w['name']} | {md_cell(w['current'])} | {md_cell(', '.join(w['history']))} | {live_label[w['live']]} | {w['last_seen']} |"
        for w in vm["workers"]
    ] or ["| - | - | - | - | - |"]
    return template("status.md.tmpl").substitute(
        title=vm["title"],
        slug=vm["slug"],
        source=vm["source"] or "-",
        manager=vm["manager"],
        worker_prefix=vm["worker_prefix"],
        unblock_on=vm["unblock_on"],
        progress=", ".join(f"{n} {s}" for s, n in vm["counts"] if n),
        goal_rows="\n".join(goal_rows),
        dependencies="\n".join(deps or ["- none"]),
        live_checked=vm["live_checked"] or "never",
        worker_rows="\n".join(worker_rows),
    )


NODE_W, NODE_H, GAP_X, GAP_Y, PAD = 200, 58, 72, 16, 8
LIVE = {True: "live", False: "gone", None: "unknown"}


def esc(value):
    return html.escape("" if value is None else str(value), quote=True)


def link(url, text=None):
    if not url:
        return "-"
    u = str(url)
    if u.startswith(("http://", "https://")):
        return f'<a href="{esc(u)}">{esc(text or u)}</a>'
    return esc(text or u)


def pr_label(url):
    tail = str(url).rstrip("/").rsplit("/", 1)[-1]
    return f"#{tail}" if "/pull/" in str(url) and tail.isdigit() else str(url)


def time_html(iso):
    if not iso:
        return "-"
    return f'<time datetime="{esc(iso)}" title="{esc(iso)}">{esc(iso)}</time>'


def badge(status):
    return f'<span class="badge s-{esc(status)}">{esc(status)}</span>'


def progress_html(counts):
    total = sum(n for _, n in counts) or 1
    segs = "".join(
        f'<span class="seg s-{esc(s)}" style="width:{n * 100 / total:.2f}%" title="{n} {esc(s)}"></span>'
        for s, n in counts if n)
    legend = ", ".join(f"{n} {esc(s)}" for s, n in counts if n)
    return f'<div class="progress" role="img" aria-label="{legend}">{segs}</div><p class="legend">{legend}</p>'


def problems_html(problems):
    if not problems:
        return ""
    items = "".join(f"<li>{esc(p)}</li>" for p in problems)
    return f'<div class="banner" role="alert"><strong>Problems</strong><ul>{items}</ul></div>'


def short(text, n=28):
    text = str(text or "")
    return text if len(text) <= n else text[: n - 1] + "…"


def node_xy(g):
    return PAD + g["col"] * (NODE_W + GAP_X), PAD + g["row"] * (NODE_H + GAP_Y)


def graph_svg(vm):
    goals = vm["goals"]
    if not goals:
        return '<p class="empty">No goals.</p>'
    pos = {g["id"]: node_xy(g) for g in goals}
    width = PAD * 2 + (max(g["col"] for g in goals) + 1) * (NODE_W + GAP_X) - GAP_X
    height = PAD * 2 + (max(g["row"] for g in goals) + 1) * (NODE_H + GAP_Y) - GAP_Y
    edges = []
    for e in vm["edges"]:
        x1, y1 = pos[e["from"]]
        x2, y2 = pos[e["to"]]
        x1, y1, y2 = x1 + NODE_W, y1 + NODE_H / 2, y2 + NODE_H / 2
        mid = (x1 + x2) / 2
        cls = "edge met" if e["met"] else "edge waiting"
        edges.append(f'<path class="{cls}" d="M{x1:g},{y1:g} C{mid:g},{y1:g} {mid:g},{y2:g} {x2 - 2:g},{y2:g}" marker-end="url(#arrow)"/>')
    nodes = []
    for g in goals:
        x, y = pos[g["id"]]
        gid, status = esc(g["id"]), esc(g["status"])
        nodes.append(
            f'<a href="#goal-{gid}" class="node s-{status}" data-goal="{gid}" data-status="{status}">'
            f'<title>{gid}: {esc(g["title"])}</title>'
            f'<rect x="{x}" y="{y}" width="{NODE_W}" height="{NODE_H}" rx="8"/>'
            f'<text x="{x + 10}" y="{y + 18}" class="nid">{gid} · {status}</text>'
            f'<text x="{x + 10}" y="{y + 35}">{esc(short(g["title"]))}</text>'
            f'<text x="{x + 10}" y="{y + 50}" class="nworker">{esc(g["worker"] or "unassigned")}</text></a>')
    return (
        f'<div class="graph"><svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Dependency graph">'
        '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        '<path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>'
        + "".join(edges) + "".join(nodes) + "</svg></div>"
    )


def main_html(vm):
    title = link(vm["source"], vm["title"]) if vm["source"] else esc(vm["title"])
    goal_rows = "".join(
        f'<tr id="goal-{esc(g["id"])}" data-goal="{esc(g["id"])}" data-status="{esc(g["status"])}">'
        f'<td>{esc(g["id"])}</td><td>{esc(g["title"])}</td><td>{badge(g["status"])}</td>'
        f'<td>{esc(g["worker"] or "-")}</td><td>{link(g["pr"], pr_label(g["pr"]) if g["pr"] else None)}</td>'
        f'<td>{esc(g["reason"] or "")}</td></tr>'
        for g in vm["goals"])
    worker_rows = "".join(
        f'<tr><td>{esc(w["name"])}</td><td>{esc(w["current"] or "-")}</td>'
        f'<td>{esc(", ".join(w["history"]) or "-")}</td>'
        f'<td><span class="dot {LIVE.get(w["live"], "unknown")}"></span>{LIVE.get(w["live"], "unknown")}</td>'
        f'<td>{time_html(w["last_seen"])}</td></tr>'
        for w in vm["workers"]) or '<tr><td colspan="5" class="empty">No workers yet.</td></tr>'
    events = "".join(
        f'<li>{time_html(e["at"])} <b>{esc(e["actor"])}</b> <code>{esc(e["event"])}</code> {esc(e["details"])}</li>'
        for e in vm["events"]) or '<li class="empty">No events yet.</li>'
    checked = time_html(vm["live_checked"]) if vm["live_checked"] else "never"
    return (
        problems_html(vm["problems"])
        + f'<header><h1>{title}</h1>'
        + f'<p class="meta">Slug <code>{esc(vm["slug"])}</code> · Manager <code>{esc(vm["manager"])}</code> · '
        + f'Workers <code>{esc(vm["worker_prefix"])}*</code> · '
        + f'Dependents start when dependencies are <code>{esc(vm["unblock_on"])}</code></p>'
        + progress_html(vm["counts"])
        + f'<p class="updated">Last updated {time_html(vm["updated"])}</p></header>'
        + f'<section><h2>Dependencies</h2>{graph_svg(vm)}</section>'
        + '<section><h2>Goals</h2><div class="table"><table><thead><tr><th>Goal</th><th>Title</th>'
        + '<th>Status</th><th>Worker</th><th>PR</th><th>Reason</th></tr></thead>'
        + f'<tbody>{goal_rows}</tbody></table></div></section>'
        + f'<section><h2>Workers</h2><p class="meta">Liveness checked {checked}</p>'
        + '<div class="table"><table><thead><tr><th>Worker</th><th>Current goal</th><th>Done so far</th>'
        + '<th>Live</th><th>Last seen</th></tr></thead>'
        + f'<tbody>{worker_rows}</tbody></table></div></section>'
        + f'<section><h2>Recent events</h2><ol class="events">{events}</ol></section>'
    )


def render_page(title, main, stream):
    return template("status.html.tmpl").substitute(title=esc(title), main=main, stream=esc(stream))


def index_main_html(cards, root):
    if not cards:
        return f'<h1>Orchestrations</h1><p class="empty">No orchestrations under <code>{esc(root)}</code>.</p>'

    def last(c):
        return c["events"][0]["at"] if c["events"] else ""

    out = []
    for c in sorted(cards, key=last, reverse=True):
        active = sum(1 for w in c["workers"] if w["current"])
        when = time_html(last(c)) if last(c) else "none yet"
        err = problems_html([c["error"]]) if c.get("error") else ""
        bar = progress_html(c["counts"]) if c["counts"] else ""
        out.append(
            f'<a class="card" href="/{esc(c["slug"])}"><h2>{esc(c["title"])}</h2>'
            f'<p class="meta"><code>{esc(c["slug"])}</code> · {active} active worker{"" if active == 1 else "s"} · last event {when}</p>'
            f"{err}{bar}</a>")
    return '<h1>Orchestrations</h1><div class="cards">' + "".join(out) + "</div>"
