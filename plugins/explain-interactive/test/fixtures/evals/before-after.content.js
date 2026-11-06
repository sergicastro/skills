/* PR #123 in acme/notes-app: moving login checks from each handler into one AuthMiddleware.
   Code below is a sketch reconstructed from the PR description, not copied from the diff. */

const META = {
  type: "before-after",
  title: "PR #123: one login check instead of many",
  bigPicture: "The login check moves out of each route handler and into one middleware that runs before every route, so a handler can no longer forget it.",
  before: "Each handler in <code>routes/notes.py</code> calls <code>require_user(request)</code> itself. Three forgot, so they answer without a login.",
  after: "<code>AuthMiddleware</code> in <code>app.py</code> checks every request first. Only paths in <code>PUBLIC_PATHS</code> get through without a session.",
};

const CAST = {
  "acme/notes-app": "The notes web app this PR changes.",
  "routes/notes.py": "The file holding the route handlers for notes (list, read, export, share, history…).",
  "app.py": "The file that creates the app and registers its middleware and routes.",
  "require_user": "The old helper each handler called on its first line: it read the session cookie and returned the user, or a 401 if the session was missing or expired.",
  "AuthMiddleware": "The new middleware added in app.py. It runs before every route and does the login check once for all of them.",
  "PUBLIC_PATHS": "The new list of paths that may be reached without logging in: <code>/login</code> and <code>/health</code>.",
  "export_notes": "A handler that exports a user's notes. Before the PR it had no require_user call.",
  "share_note": "A handler that shares a note. Before the PR it had no require_user call.",
  "note_history": "A handler that shows a note's edit history. Before the PR it had no require_user call.",
};

const GLOSSARY = {
  "route handler": "The function that runs for one URL path, e.g. the function behind the notes export URL.",
  "middleware": "Code that wraps every request: it runs before the route handler and can answer the request itself without calling the handler.",
  "session cookie": "The cookie the browser gets after logging in; the server uses it to find who the user is.",
  "401": "HTTP status 401 Unauthorized: \"you are not logged in\". The client should log in and try again.",
  "request.state": "A per-request place to store values, so code that runs earlier (the middleware) can hand data to code that runs later (the handler).",
  "allowlist": "A list of things that are allowed; anything not on it is refused by default.",
};

const STEPS = [
  {
    title: "What we're figuring out",
    summary: "where the login check lives, before and after",
    context: {
      question: "What does PR #123 in <dfn>acme/notes-app</dfn> change about how logins are checked, and why?",
      setting: "Route handlers live in <dfn>routes/notes.py</dfn>; the app and its <dfn>middleware</dfn> are set up in <dfn>app.py</dfn>. The code on this page is a sketch built from the PR description, not the literal diff.",
      why: "Three handlers (<dfn>export_notes</dfn>, <dfn>share_note</dfn>, <dfn>note_history</dfn>) answered anyone, logged in or not. The PR treats all three as bugs (none was meant to be public) and makes the same mistake impossible for new routes.",
      prereqs: [
        "<dfn>route handler</dfn>: the function that runs for one URL path.",
        "<dfn>session cookie</dfn>: what proves to the server you are logged in.",
      ],
      example: "A visitor with <strong>no cookie</strong> requests the notes export, which runs <code>export_notes</code>.",
    },
    body: `<p>The steps follow that cookie-less export request through the old code, then through each piece the PR adds, ending with the test that guards it.</p>`,
    code: `# routes/notes.py, before (sketch)
def list_notes(request):
    user = require_user(request)  # 401 if no session
    return notes_for(user)

def export_notes(request):
    # no require_user call here
    ...`,
  },
  {
    title: "Each handler guarded itself",
    summary: "opt-in checks; three handlers opted out",
    body: `<p>Our cookie-less visitor asks for the export, and nothing stops them: <code>export_notes</code> never calls <dfn>require_user</dfn>, so no one checks the cookie. That is the weakness of the old design: <strong>the check was opt-in, one line per handler</strong>. Forgetting that line raises no error and fails no test; it just leaves the route open.</p>`,
    code: `def list_notes(request):
    user = require_user(request)  # ← guarded
    ...

def export_notes(request):        # ← open to anyone
    ...
def share_note(request):          # ← open to anyone
    ...
def note_history(request):        # ← open to anyone
    ...`,
    quiz: {
      q: "Before the PR, a developer adds a new handler and forgets require_user. What happens when it is deployed?",
      options: [
        "The route works for anyone, logged in or not, and nothing warns",
        { t: "The app refuses to start", why: "Nothing in the old setup knew which handlers were meant to be protected; a missing call is just a missing line." },
        { t: "Requests without a cookie get a 401 anyway", why: "The 401 came only from require_user. Without the call, no code produces it." },
        { t: "An existing test fails", why: "The old tests didn't call every route without a cookie; that test is what this PR adds." },
      ],
      answer: 0,
      why: "In the old design, protection existed only where someone typed it. That is exactly how the three open handlers happened.",
    },
  },
  {
    title: "Add one check before every route",
    summary: "AuthMiddleware runs first, for every request",
    body: `<p>Now the same export request first hits <dfn>AuthMiddleware</dfn>, registered in <dfn>app.py</dfn>. A <dfn>middleware</dfn> runs before any <dfn>route handler</dfn>, so <strong>one check covers every route, including ones nobody remembered to protect</strong>. Our visitor has no cookie, so the middleware answers <dfn>401</dfn> itself and <code>export_notes</code> never runs.</p>`,
    diff: {
      label: "app.py",
      before: `app = App()
app.include(notes_routes)`,
      after: `class AuthMiddleware:
    def __call__(self, request, call_next):
        user = load_session(request)
        if user is None:
            return Response(status=401)
        request.state.user = user
        return call_next(request)

app = App()
app.add_middleware(AuthMiddleware)
app.include(notes_routes)`,
    },
    deeper: `<p>The PR describes the middleware as loading the session and returning 401 when the cookie is missing <em>or expired</em>, the same two cases <code>require_user</code> handled. The names <code>App</code>, <code>load_session</code> and <code>call_next</code> here are placeholders; the real ones depend on the framework the app uses. The PR description doesn't say whether the cookie-reading code was moved over from <code>require_user</code> or rewritten; check the diff of <code>app.py</code> for that.</p>`,
  },
  {
    title: "Let the login page through",
    summary: "PUBLIC_PATHS lists the only open paths",
    body: `<p>A check on every request would also block <code>/login</code>, and then nobody could log in. So the middleware skips paths in <dfn>PUBLIC_PATHS</dfn>: <code>/login</code>, and <code>/health</code>, which monitoring calls to see if the app is up. This flips the default: <strong>a route is protected unless it is listed as public</strong>, which makes PUBLIC_PATHS an <dfn>allowlist</dfn>. Our export path isn't on it, so it still gets the 401.</p>`,
    diff: {
      label: "app.py",
      before: `class AuthMiddleware:
    def __call__(self, request, call_next):
        user = load_session(request)`,
      after: `PUBLIC_PATHS = {"/login", "/health"}

class AuthMiddleware:
    def __call__(self, request, call_next):
        if request.path in PUBLIC_PATHS:
            return call_next(request)
        user = load_session(request)`,
    },
    deeper: `<p>The sketch matches paths exactly. The PR description doesn't say how the real check treats <code>/login/</code> or query strings such as <code>/login?next=…</code>; that's worth a look in the diff.</p>`,
    quiz: {
      q: "After the PR, someone adds a /notes/archive route and does nothing else. A visitor with no cookie requests it. What do they get?",
      options: [
        "A 401 from AuthMiddleware",
        { t: "The archive page", why: "That was the old failure. Now a path is open only if it's listed in PUBLIC_PATHS, and it isn't." },
        { t: "A 404, because the route isn't in PUBLIC_PATHS", why: "PUBLIC_PATHS only decides whether a login is needed; it isn't the list of routes that exist." },
      ],
      answer: 0,
      why: "Forgetting now fails safe: an unlisted route is protected. The only way to open a route is to add it to PUBLIC_PATHS on purpose.",
    },
  },
  {
    title: "Handlers just read the user",
    summary: "require_user removed; use request.state.user",
    body: `<p>For a logged-in visitor, the middleware has already found who they are, so the handler shouldn't repeat that work. The middleware leaves the user on <dfn>request.state</dfn>, and each handler reads <code>request.state.user</code>. <strong>The <code>require_user</code> calls are deleted</strong>, and the three handlers that never had one now get the user the same way.</p>`,
    diff: {
      label: "routes/notes.py",
      before: `def list_notes(request):
    user = require_user(request)
    return notes_for(user)

def export_notes(request):
    ...`,
      after: `def list_notes(request):
    user = request.state.user
    return notes_for(user)

def export_notes(request):
    user = request.state.user
    ...`,
    },
    deeper: `<p>A handler can count on <code>request.state.user</code> being set because the middleware only calls a protected handler after storing it. Handlers for <code>/login</code> and <code>/health</code> are the exception: the middleware skips the session lookup for them, so they shouldn't read <code>request.state.user</code> (what happens if they do depends on the framework).</p>`,
  },
  {
    title: "A test that tries every route",
    summary: "each non-public route must return 401",
    body: `<p>The middleware closes the gap today; the new test keeps it closed. It walks <strong>every registered route</strong>, calls it without a cookie, and expects <dfn>401</dfn> unless the path is in <dfn>PUBLIC_PATHS</dfn>. Our export request is one of those calls. Because the test reads the app's route list instead of a hand-written one, a new route is tested the moment it exists.</p>`,
    diff: {
      label: "tests (new test, sketch)",
      before: ``,
      after: `def test_every_route_needs_login(client):
    for path in app.registered_paths():
        if path in PUBLIC_PATHS:
            continue
        r = client.get(path)  # no cookie
        assert r.status == 401, path`,
    },
    deeper: `<p>The test code is a sketch. Routes with parameters (a note id) or that only accept POST need a sample id and the right method to be called at all; the PR description doesn't say how the real test fills those in. Either way, the middleware answers 401 before the route's own code runs.</p>`,
    quiz: {
      q: "Later, someone accidentally removes app.add_middleware(AuthMiddleware). What does the new test do?",
      options: [
        "It fails, because routes like the export no longer return 401",
        { t: "It passes; the test only checks PUBLIC_PATHS", why: "It calls every registered route, not just the public ones, and expects 401 from all the others." },
        { t: "It passes, because the handlers still check the login", why: "The handlers' require_user calls were deleted in this PR; the middleware is the only check left." },
      ],
      answer: 0,
      why: "With the middleware gone, nothing returns 401. The test catches that: it is the safety net for the single check.",
    },
  },
  {
    title: "Recap",
    body: `<p>The login check moved from one opt-in line per handler to one <dfn>AuthMiddleware</dfn> that protects everything except <dfn>PUBLIC_PATHS</dfn>, and a test now checks every route against that rule.</p>`,
    diff: {
      label: "app.py + routes/notes.py",
      before: `# routes/notes.py
def list_notes(request):
    user = require_user(request)
def export_notes(request):
    ...  # no check`,
      after: `# app.py
PUBLIC_PATHS = {"/login", "/health"}
app.add_middleware(AuthMiddleware)

# routes/notes.py
def list_notes(request):
    user = request.state.user
def export_notes(request):
    user = request.state.user`,
    },
  },
];
