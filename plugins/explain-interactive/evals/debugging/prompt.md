---
description: "Debugging story: a test that failed only in CI"
tags: [debugging]
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Skill, Read, Write, Edit, Glob, Grep, Bash, Agent]
---

I don't get it, show me. You explained why the flaky test broke and I lost track halfway:

> `test_report_groups_by_day` in `acme/metrics` passed on every laptop but failed in CI about one run in four. First suspect: test ordering, since another test writes to the same `events` table. Running it alone in CI still failed, so not ordering. Second suspect: a slow CI database causing a timeout. The failure is an assertion (3 groups expected, 4 found), not a timeout, so not that. Third: time zones. CI runners use UTC; laptops use Europe/Madrid. The fixture creates events at 23:30 local time with `datetime.now()`, and the report groups by `DATE(created_at)` in UTC. When the job ran close to midnight UTC, an event landed on the next day and made a fourth group. Confirmed by setting `TZ=UTC` locally: the test then failed every time after 23:00. The fix builds fixtures with fixed, time-zone-aware timestamps.

Make it an interactive page I can step through.

Harness note (not part of the request): the eval grader can only see the working directory. Before your final reply, copy the finished content file and page to `./out/page.content.js` and `./out/page.html` (run `mkdir -p out` first). Your reply should still name the page's real path under `~/explanations/`. Do not run `open` or `xdg-open`: there is no display.
