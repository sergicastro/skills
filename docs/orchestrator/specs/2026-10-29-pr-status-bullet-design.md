# Orchestrator: PR status bullet on the live page — design

Date: 2026-10-29
Status: draft
Extends: `2026-10-29-pr-visibility-design.md` (the per-goal `prs` list)

## 1. Purpose

The live status page lists each goal's PRs. This adds a coloured bullet after each PR
link that says how healthy that PR is, so the user sees at a glance which PRs need
attention without opening GitHub.

| Bullet | Meaning |
|---|---|
| green | open, not a draft, no failing or pending checks, no review blocking it |
| yellow | open but waiting: a draft, checks still running, or a review required |
| red | needs action: a check failed, changes requested, a merge conflict, or closed without merging |
| purple | merged |
| grey | unknown: status could not be read |

Nothing here changes the protocol, the state file, or any worker or manager behaviour.
It only reads GitHub and draws.

## 2. Classification

`orch_prs.classify(info)` is a pure function over the JSON that
`gh pr view --json state,isDraft,reviewDecision,mergeable,statusCheckRollup` returns. It
returns `(health, reason)`, where `health` is one of `green yellow red merged` and `reason`
is a short phrase for the tooltip. First match wins:

1. `state == MERGED` → `merged`, "merged".
2. `state == CLOSED` → `red`, "closed without merging".
3. A check failed → `red`, "checks failing". A `CheckRun` fails when `conclusion` is one of
   `FAILURE TIMED_OUT CANCELLED ACTION_REQUIRED STARTUP_FAILURE`; a `StatusContext` fails
   when `state` is `FAILURE` or `ERROR`.
4. `reviewDecision == CHANGES_REQUESTED` → `red`, "changes requested".
5. `mergeable == CONFLICTING` → `red`, "merge conflict".
6. `isDraft` → `yellow`, "draft".
7. A check is pending (`CheckRun.status != COMPLETED`, or `StatusContext.state` is
   `PENDING` or `EXPECTED`) → `yellow`, "checks running".
8. `reviewDecision == REVIEW_REQUIRED` → `yellow`, "waiting on review".
9. Otherwise → `green`, "ready to merge".

An open PR with no checks configured and no review rule is `green`. Missing or `null`
fields are treated as absent, never as an error.

## 3. Fetching

New stdlib-only module `orch_prs.py`.

- `parse_pr(url)` returns `(owner, repo, number)` only for
  `https://github.com/<owner>/<repo>/pull/<n>`, where `owner` and `repo` start with a
  letter or digit. Anything else returns `None`. Worker-supplied URLs are untrusted data:
  only parsed parts are used, and `gh` is called with an argument list and no shell:
  `gh pr view <n> --repo <owner>/<repo> --json …`. Each call has a 10 s timeout.
- `HealthCache` holds `url → (health, reason)` and a `version` counter that increases
  whenever any entry changes.
  - `track(key, urls)` sets the URLs to watch for one epic (`key` is its slug), replacing
    that epic's previous set; the server calls it on each render.
  - `refresh_due()` fetches every tracked URL that has never been fetched, or whose last
    successful or failed fetch is older than 60 s. A URL whose last result is `merged`, or
    `red` because it was closed, is final and never refetched.
  - `snapshot()` returns a copy of every known result, plus `unknown` for each tracked URL
    that has none. A tracked URL with no result yet, a URL that
    fails `parse_pr`, and any failure (`gh` missing, not logged in, non-zero exit,
    timeout, bad JSON) all map to `("unknown", "status unavailable")`.
  - The runner (`subprocess.run`) and the clock are injectable for tests.
- The server starts one daemon thread in `serve()` that calls `refresh_due()` about once a
  second until the server is closing. `StatusServer.__init__` only creates the cache, so
  nothing polls in tests or when the server object is built by hand.
- Every PR of every goal is tracked. Final states are fetched once, so a finished epic
  costs one call per PR after a server restart and none after that.
- `ORCH_PR_STATUS=off` disables fetching: every bullet is grey. Without `gh` on the
  machine the result is the same, so nothing else breaks.
- GitHub Enterprise hosts are out of scope.

## 4. Rendering

- `orch_view.prs_html(urls, health=None)`: with `health=None` the output is unchanged
  (no bullets). With a map, each PR link that has a result is followed by
  `<span class="pr-dot h-<health>" role="img" aria-label="<reason>" title="<reason>"></span>`.
  The link and its dot are wrapped in a non-wrapping `<span class="pr">`.
  A URL missing from the map renders the plain link, with no wrapper and no dot.
- When a map is given and at least one goal has a PR, the Goals section shows a one-line
  legend: "PR bullets: ● ready to merge · ● waiting · ● needs action · ● merged · ● unknown".
- `main_html(vm, health=None)` passes the map through. The CSS reuses the existing status
  tokens: green `--s-done`, yellow `--s-assigned`, red `--s-needs-user`, purple
  `--s-in-review`, grey `--s-blocked`. Colour is never the only signal: the tooltip and
  `aria-label` carry the reason.
- Live updates: the `/events/<slug>` stream signature includes `health.version`, so the
  page re-renders when a bullet changes. The index stream is unaffected.
- The static `status.html` written on every save and `status.md` stay offline: they have
  no bullets.

## 5. Out of scope

- Per-check details, the review author, or a link to the failing check.
- Bullets on the dependency graph nodes.
- GitHub Enterprise and non-GitHub forges.
- Letting the manager or workers read the health.
- Any notification when a bullet turns red.

## 6. Testing

- `tests/test_orch_prs.py`: `classify` over fixture JSON for each rule in §2, rule
  precedence (a failing draft is red; closed is red; merged wins), missing fields;
  `parse_pr` accepts a PR URL and rejects other hosts, issue URLs, trailing junk and
  owners that start with `-`; `HealthCache` with a fake runner and clock (first fetch,
  no refetch inside 60 s, refetch after, final states never refetched, `version` bumps
  only on change, failures and timeouts give grey, the runner receives an argument list
  with `--repo` and no shell), `ORCH_PR_STATUS=off`.
- `tests/test_orch_state.py`: `prs_html` without a map is unchanged; with a map it adds
  one dot per PR with the right class and text; a URL missing from the map has no dot;
  the legend appears only with a map and at least one PR.
- `tests/test_orch_serve.py`: with a fake runner injected into the server's cache, the
  epic page shows the bullet and the stream pushes a new render when a status changes.
- Screenshots and the demo GIF are retaken with a fake `gh` on `PATH`, so the demo shows
  every colour with made-up data.
