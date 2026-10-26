# Live status page — design

Date: 2026-10-26
Status: draft, awaiting review

## 1. Purpose

Show the state of every orchestration in a browser, updated within a second or two
of each change, without the user re-running anything. Today the helper writes only
`status.md`, which has to be reopened by hand to see changes.

Decisions taken during brainstorming:

- One server shows all epics under the state root, each on its own page.
- The manager skill makes sure the server is running; the server outlives the session.
- The epic page adds a recent-events feed, a change highlight and a drawn dependency
  graph to what `status.md` shows today.
- Python renders everything (Markdown and HTML); the browser only swaps in rendered
  HTML. There is no second renderer in JavaScript.
- `orch_state.py` stays stdlib-only, so the skill still installs with a symlink.

## 2. Architecture

```
scripts/orch_state.py   view_model(state, events, problems) -> dict    all logic, once
                        save() writes state.json, events.log, then status.md and status.html
                        CLI: serve [--port 8765] [--ensure | --stop]
scripts/orch_view.py    render_md(vm)  + templates/status.md.tmpl   -> status.md
                        render_page(title, main_html(vm), stream)
                                       + templates/status.html.tmpl -> status.html
                        graph_svg(vm), index_main_html(cards)
scripts/orch_serve.py   StatusServer, SSE streams, ensure/stop
```

`orch_view.py` imports only the stdlib, so `orch_state.py` can import it without a
cycle; `orch_serve.py` imports both and is loaded only by the `serve` command.

### 2.1 View model and templates

- `view_model(state, events)` returns a plain dict: epic header fields, status
  counts, goal rows, dependency edges with a `met` flag, graph layout (column and
  row per goal), workers, the last 30 events newest first, validation problems and
  a render timestamp. Every renderer reads only this dict.
- `events` is the parsed tail of `events.log` (`<ISO> <actor> <event> <details>`).
- Templates live in `skills/orchestrator/templates/` and use `string.Template`.
  `string.Template` has no loops, so Python builds repeated pieces (table rows, SVG,
  event list) and the template lays out the page.
- `render_md` must produce byte-identical `status.md` to today's `render()`. The
  existing `render()` is replaced by `render_md(view_model(...))`.

### 2.2 One HTML file, two modes

`status.html` is written on every `save()` and is also what the server serves for
`/<slug>`. Its inline script checks `location.protocol`:

- `http:` — opens `EventSource('/events/<slug>')`, replaces `<main>` with each
  message's HTML and applies the change highlight (§3.4).
- `file:` — reloads the page every 3 s (fallback when the server isn't running).

### 2.3 Server

`orch_state.py serve` runs a `ThreadingHTTPServer` bound to `127.0.0.1`, default
port 8765. It is read-only and answers GET only. It answers only requests whose
`Host` header is `127.0.0.1:<port>` or `localhost:<port>` and returns 403 for any
other host, so a web page using DNS rebinding can't read the state.

| Path | Response |
|---|---|
| `/` | Index of all epics (§3.5), live over `/events` |
| `/<slug>` | Epic page, rendered fresh from `state.json` and `events.log` |
| `/events` | SSE stream: re-rendered index `<main>` on any change |
| `/events/<slug>` | SSE stream: re-rendered epic `<main>` on change |
| `/healthz` | `{"app": "orch_state", "pid": <pid>, "root": "<state root>"}` |

- SSE handlers poll the mtimes of `state.json` and `events.log` every 0.5 s and send
  an event when either changes. `save()` knows nothing about the server.
- The first message on each stream is the current render, so a reconnect always
  catches up. Every stream starts with `retry: 2000`.
- A keep-alive comment is sent every 15 s so idle connections are noticed.

### 2.4 Lifecycle

- `serve --ensure [--port N]`:
  1. Read `<root>/.server.json` (`pid`, `port`). If `/healthz` on that port answers
     with `app == "orch_state"` and the same pid, print the URL and exit 0.
  2. Otherwise remove a stale `.server.json`, take an exclusive lock on
     `<root>/.server.lock`, check again (another caller may have just started it),
     then start `serve --port N` detached (new session, stdout/stderr to
     `<root>/server.log`), wait up to 5 s for it to answer `/healthz`, release the
     lock and print the URL. The server writes `.server.json` itself once it has bound
     the port, and removes it on exit.
- `serve --stop`: confirm via `/healthz` that the recorded pid is our server, send
  SIGTERM, remove `.server.json`. If nothing is running, say so and exit 0.
- Plain `serve` runs in the foreground (used by `--ensure` and for debugging).

### 2.5 Manager skill changes

- At `init` and at resume, run `$ORCH serve --ensure` and give the user
  `http://127.0.0.1:<port>/<slug>`.
- If it fails, report the error, give the path of `status.html` and continue. The
  page never blocks orchestration.
- `status` requests may mention the URL again; they still read `$ORCH show`.

## 3. Page content

### 3.1 Epic page, top to bottom

1. **Header:** epic title linked to its source; slug, manager, worker prefix, unblock
   policy; a progress bar with one segment per status count; "Last updated" with a
   connection indicator in live mode (`live` / `reconnecting…`).
2. **Dependency graph** (§3.2).
3. **Goals table:** the `status.md` columns; PR cell is a link. Each row has
   `id="goal-<id>"`, `data-goal` and `data-status`.
4. **Workers table:** the `status.md` columns; liveness as a dot plus text
   (live / gone / unknown).
5. **Recent events:** last 30 lines of `events.log`, newest first: relative time
   (full ISO in a `title`), actor, event, details. Relative times are computed in
   the browser from a `datetime` attribute so they stay current between updates.
6. **Problems banner** above the header when `validate()` reports problems or
   `state.json` can't be read (§4).

### 3.2 Dependency graph

- Drawn by `graph_svg(vm)` in Python as inline SVG.
- Column = depth: longest path from a goal with no dependencies. Within a column,
  goals keep their order in `state.json`.
- Node: rounded box with goal id, title truncated to ~28 characters (full title in
  `<title>`), and worker; filled with the status colour, status also written as text.
  Each node has `data-goal` and `data-status` and links to `#goal-<id>`.
- Edge: cubic curve from dependency to dependent with an arrowhead; solid when the
  dependency meets the unblock policy, dashed when it still blocks.
- The SVG is sized from the column and row counts and sits in a container that
  scrolls horizontally on narrow screens; the page itself never scrolls sideways.
- An epic with no dependencies still draws the nodes in one column.

### 3.3 Styling

- Status colours are CSS custom properties on `:root`, redefined for dark mode under
  `prefers-color-scheme: dark`: blocked grey, ready blue, assigned amber, needs-user
  red, in-review purple, done green.
- All CSS and JS are inline; the page makes no external requests.
- Readable at phone width with a 16 px side gutter.

### 3.4 Change highlight

Before swapping `<main>`, the script records `data-status` per `data-goal`. After the
swap, every row and graph node whose status changed, or whose goal is new, gets a
CSS class that flashes its background for 2 s.

### 3.5 Index page

One card per epic: title, slug, progress bar, number of workers with a current goal,
time of the last event. Sorted by most recent activity. Each card links to
`/<slug>`. Empty state: "No orchestrations under <root>".

## 4. Error handling

| Situation | Behaviour |
|---|---|
| `state.json` missing | Epic absent from index; `/<slug>` returns 404 page |
| `state.json` unreadable or invalid JSON | Serve the last good render with a banner `state.json unreadable: <error>`; recover on next good write |
| `validate()` problems | Render anyway in the served page with a warning banner. `status.md` and `status.html` are unaffected: `save()` refuses to write invalid state |
| `events.log` missing | Events section shows "no events yet" |
| Port answers but isn't our server | `--ensure` fails with a message suggesting `--port`; never kills a foreign process |
| Stale `.server.json` | `--ensure` removes it and starts a fresh server |
| Concurrent `--ensure` | Lock file serialises starts; the second caller prints the same URL |
| Client disconnects | Broken pipe ends that handler quietly; browser reconnects after 2 s |
| Bad slug in URL | Must match `SLUG_RE` and exist under root, else 404 (no path traversal) |
| `Host` header not `127.0.0.1:<port>` or `localhost:<port>` | 403 on every path, including `/healthz` and the streams |

Every value taken from state or events is passed through `html.escape` before it is
placed in HTML or SVG. Only markup built by the helper itself is inserted unescaped.

## 5. Testing

Extends `tests/test_orch_state.py` (stdlib `unittest`).

1. **Refactor guard:** capture today's `render()` output for the existing fixtures
   before refactoring; assert `render_md(view_model(...))` is byte-identical.
2. **View model:** counts; depth for a chain, a diamond and independent goals; edge
   `met` per unblock policy (`done` vs `in-review`); last 30 events newest first.
3. **HTML render:** one row per goal with the right `data-status`; titles containing
   `<script>` and `&` are escaped; one SVG node per goal and one edge per
   dependency; no `http://` or `https://` URLs other than those from state.
4. **Server** (port 0, in a thread, temp `ORCH_ROOT`): `/healthz`, `/`, `/<slug>`
   return 200; unknown slug and `/..%2f` return 404; a `save()` after opening
   `/events/<slug>` delivers a message within 2 s; corrupt `state.json` yields the
   banner plus the last good render.
5. **Lifecycle** (subprocess, temp root, free port): `--ensure` twice leaves one
   process and prints the same URL; a stale `.server.json` is replaced; `--stop`
   stops the process and removes `.server.json`.
6. **Manual:** `--ensure` on the dry-run epic; check light and dark mode and phone
   width; run state commands and watch the page update and highlight.

## 6. Out of scope

- Writing to state from the browser (approve, release, etc.).
- Authentication or binding to anything other than `127.0.0.1`.
- Showing state from other machines.
- File-watching via OS APIs (mtime polling is enough).
