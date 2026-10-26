"""Renderers for the orchestrator status views.

Every function takes the view model built by orch_state.view_model() and returns text.
This module imports only the stdlib so orch_state can import it without a cycle.
"""
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
