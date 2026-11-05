/* Content file for a "decision" page: where a web app should keep its login sessions.
   Build it with:  node build.mjs examples/session-store.content.js -o ~/explanations/session-store.html
   Field reference: SKILL.md ("Page types"). */

const META = {
  type: "decision",
  title: "Where to keep login sessions",
  bigPicture: "Once the app runs on more than one server, sessions must live somewhere every server can read; Redis does that at the lowest cost.",
};

const CAST = {
  "shop-web": "The web app in this example; it runs on three servers behind a load balancer.",
};

const GLOSSARY = {
  "session": "What the server remembers about a signed-in browser (who it is, what is in the cart), looked up by a cookie on every request.",
  "load balancer": "The component that spreads incoming requests over several servers; the next request may land on a different one.",
  "TTL": "Time to live: how long a stored value is kept before it is deleted on its own.",
};

/* The decision. Options are the columns, criteria the rows; DECISION.cost adds a last "Cost" row.
   ratings[option][criterion] is a level ("good" | "fair" | "poor") or { level, note }. */
const DECISION = {
  options: [
    { id: "memory", name: "Server memory", summary: "each server keeps its own" },
    { id: "redis", name: "Redis", summary: "one shared in-memory store" },
    { id: "postgres", name: "Postgres", summary: "a table in the existing database" },
  ],
  criteria: [
    { id: "shared", name: "Shared by all servers" },
    { id: "speed", name: "Read speed" },
    { id: "expiry", name: "Expiry" },
  ],
  ratings: {
    memory: { shared: { level: "poor", note: "lost when the next request hits another server" }, speed: { level: "good", note: "no network hop" }, expiry: { level: "fair", note: "the app has to sweep old entries" } },
    redis: { shared: { level: "good", note: "every server reads the same store" }, speed: { level: "good", note: "under a millisecond" }, expiry: { level: "good", note: "built-in TTL per key" } },
    postgres: { shared: { level: "good", note: "every server reads the same table" }, speed: { level: "fair", note: "a query on every request" }, expiry: { level: "fair", note: "needs a cleanup job" } },
  },
  cost: {
    memory: "Nothing to run",
    redis: "One more service to run and monitor",
    postgres: "Nothing new, but more load on the main database",
  },
  recommend: "redis",
  why: "it is the only option that is shared, fast and expires sessions by itself; the price is one extra service, which is small next to a query on every request.",
};

const STEPS = [
  {
    title: "What we're deciding",
    summary: "where shop-web keeps sessions",
    context: {
      question: "Where should <dfn>shop-web</dfn> keep its <dfn data-term=\"session\">sessions</dfn> now that it runs on three servers?",
      setting: "A <dfn>load balancer</dfn> sends each request to any of the three servers.",
      why: "If a session lives on one server only, a user who is signed in on one request looks signed out on the next.",
      prereqs: ["<dfn>session</dfn>: looked up by a cookie on every request, so reading it has to be fast."],
      example: "Ana signs in; her next request lands on a different server than the first one.",
    },
    body: `<p>The table shows the three options against what the app needs. The next steps fill it in one row at a time.</p>`,
    matrix: {},
  },
  {
    title: "Every server must see it",
    summary: "server memory fails here",
    body: `<p>Ana's second request reaches another server. With <mark>Server memory</mark> that server has never seen her, so she is asked to sign in again. <strong>A session store must be shared by all servers</strong>, which rules out memory as soon as there is more than one.</p>`,
    matrix: { criteria: ["shared"], options: ["memory"] },
    quiz: {
      q: "The load balancer is set to send each user to the same server every time. What happens to Ana's session when that server restarts?",
      options: [
        "It is gone; she signs in again",
        { t: "Another server picks it up", why: "No other server has a copy: the session only ever lived in that server's memory." },
        { t: "The load balancer keeps a copy", why: "The load balancer only routes requests; it does not store what the app puts in a session." },
      ],
      answer: 0,
      why: "Pinning users to a server hides the problem until that server restarts or is removed; the session lived only there.",
    },
  },
  {
    title: "It is read on every request",
    summary: "a query per request adds up",
    body: `<p>Every page Ana opens reads her session first. Redis answers from memory, while <mark>Postgres</mark> runs a query each time. <strong>Read speed matters more than usual</strong> because the cost is paid on every request, not once.</p>`,
    matrix: { criteria: ["speed"], options: ["postgres"] },
  },
  {
    title: "Old sessions must go away",
    summary: "Redis expires keys by itself",
    body: `<p>Ana closes the tab and never signs out. Her session should disappear after a while. <mark>Redis</mark> can store each key with a <dfn>TTL</dfn> and deletes it on time; the other two need code or a job that cleans up.</p>`,
    matrix: { criteria: ["expiry"], options: ["redis"] },
    quiz: {
      q: "Sessions are kept in Postgres, with no cleanup job. Ana closes her tab without signing out. What happens to her session?",
      options: [
        "It stays in the table until something deletes it",
        { t: "Postgres deletes it after a TTL", why: "Postgres has no per-row TTL; expiring rows takes code or a cleanup job." },
        { t: "It is deleted when her cookie expires", why: "The cookie lives in her browser; the server never hears that it expired." },
      ],
      answer: 0,
      why: "Only Redis deletes keys on time by itself; with the other options an abandoned session stays until something removes it.",
    },
  },
  {
    title: "What each option costs",
    summary: "Redis is one more service",
    body: `<p>Each option has a price in the <mark>Cost</mark> row. Redis is <strong>one more service to run</strong>; Postgres adds nothing new to run but puts more load on the main database. Weighed against the rows above, Redis is the recommendation.</p>`,
    matrix: { criteria: ["cost"], recommend: true },
  },
  {
    title: "Recap",
    body: `<p>With more than one server, <dfn data-term="session">sessions</dfn> must be shared, fast to read and expire by themselves. Redis is the only option that does all three, at the cost of one extra service.</p>`,
  },
];
