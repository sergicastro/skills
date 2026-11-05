---
description: "Decision: which job queue to use for sending emails"
tags: [decision]
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Skill, Read, Write, Edit, Glob, Grep, Bash, Agent]
---

You gave me this comparison a minute ago and it was too dense:

> For `acme/recipe-site` the welcome and digest emails are sent inside the web request today, which makes signup slow. Three ways to move them to a background job: (1) a Postgres table polled by a worker (`jobs` table, `SELECT ... FOR UPDATE SKIP LOCKED`): no new infrastructure, fine up to a few hundred jobs a second; (2) Redis with a queue library: fast and simple, but jobs are lost if Redis restarts without persistence, and it is one more service to run; (3) a managed cloud queue: durable and scales without limit, but adds a vendor dependency, local development needs an emulator, and each message costs a little. We send about 2,000 emails a day, the team is two people, and we already run Postgres. I would go with the Postgres table.

Which one should we pick, and why? Make it an interactive HTML page I can step through.

Harness note (not part of the request): the eval grader can only see the working directory. Before your final reply, copy the finished content file and page to `./out/page.content.js` and `./out/page.html` (run `mkdir -p out` first). Your reply should still name the page's real path under `~/explanations/`. Do not run `open` or `xdg-open`: there is no display.
