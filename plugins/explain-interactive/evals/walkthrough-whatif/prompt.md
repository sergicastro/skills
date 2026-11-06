---
description: "Walkthrough with a what-if: an idempotency key on a retried payment"
tags: [walkthrough, whatif]
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Skill, Read, Write, Edit, Glob, Grep, Bash, Agent]
---

Earlier you explained this to me and I did not follow it:

> In `acme/shop-api`, `POST /payments` takes an `Idempotency-Key` header. The handler `create_payment()` first looks the key up in the `idempotency_keys` table. If there is no row, it inserts one with status `pending`, calls the payment provider, then stores the provider response on that row and marks it `done`. If a row exists and is `done`, it returns the stored response without charging again. If the row is `pending` (the first request is still in flight), it answers `409 Conflict` so the client retries later. Rows expire after 24 hours, so a retry after that charges again.

I still do not get what happens when the mobile app retries. Can you walk me through it step by step as an interactive page? I would like to flip between "first try", "retry while the first is still running" and "retry after it finished".

Harness note (not part of the request): the eval grader can only see the working directory. Before your final reply, copy the finished content file and page to `./out/page.content.js` and `./out/page.html` (run `mkdir -p out` first). Your reply should still name the page's real path under `~/explanations/`. Do not run `open` or `xdg-open`: there is no display.
