---
description: "Concept: a Python virtual environment, built up layer by layer"
tags: [concept]
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Skill, Read, Write, Edit, Glob, Grep, Bash, Agent]
---

Explain it in HTML please. Your answer about virtual environments assumed too much:

> A virtual environment is a folder (`.venv`) with its own `site-packages` and a `bin/python` that points back at a base interpreter. When it is activated, `bin/` goes first on `PATH`, so `python` and `pip` resolve to the venv copies, and `pip install` writes packages into `.venv/lib/python3.12/site-packages` instead of the system one. `sys.prefix` points at the venv, which is how Python knows where to look for packages. Nothing is copied from the system site-packages unless you ask for it. A `requirements.txt` or lock file records what to install, so another machine can rebuild the same environment.

I am a frontend developer and only know npm and `node_modules`. I want to understand the idea, built up piece by piece.

Harness note (not part of the request): the eval grader can only see the working directory. Before your final reply, copy the finished content file and page to `./out/page.content.js` and `./out/page.html` (run `mkdir -p out` first). Your reply should still name the page's real path under `~/explanations/`. Do not run `open` or `xdg-open`: there is no display.
