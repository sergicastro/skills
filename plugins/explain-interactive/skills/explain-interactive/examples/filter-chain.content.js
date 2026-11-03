/* Content file for an explain-interactive page (chain layout): how a request passes a gateway's filter chain.
   Build it with:  node build.mjs examples/filter-chain.content.js
   Field reference: SKILL.md. Diagram layouts: diagram-recipes.md. */

const META = {
  title: "How a request passes the filter chain",
  bigPicture: "Each filter in the gateway can stop a request, so the first one that says no decides the reply.",
};

const CAST = {
  "orders-svc": "The service that returns a customer's orders.",
};

const GLOSSARY = {
  "filter": "One check the gateway runs on every request, in a fixed order.",
  "quota": "How many calls a client may make in a time window.",
};

const DIAGRAM = {
  layout: "chain",
  label: "A request passes the listener, a JWT check and a rate limit before it reaches orders-svc",
  nodes: [
    { id: "in", label: "Listener" },
    { id: "jwt", label: "JWT check" },
    { id: "rl", label: "Rate limit" },
    { id: "svc", label: "orders-svc" },
    { id: "r401", label: "401 reply", kind: "bad", branch: true },
    { id: "r429", label: "429 reply", kind: "bad", branch: true },
  ],
  edges: [
    { id: "e1", from: "in", to: "jwt", label: "GET /orders" },
    { id: "e2", from: "jwt", to: "rl", label: "valid token" },
    { id: "e3", from: "rl", to: "svc", label: "under quota", kind: "ok" },
    { id: "deny", from: "jwt", to: "r401", label: "expired", kind: "bad" },
    { id: "slow", from: "rl", to: "r429", label: "over quota", kind: "bad" },
  ],
};

const STEPS = [
  {
    title: "What we're figuring out",
    summary: "which filter answers GET /orders",
    context: {
      question: "Which part of the gateway decides the reply to <code>GET /orders</code>?",
      setting: "Requests reach <dfn>orders-svc</dfn> only through the gateway, which runs a fixed list of <dfn data-term=\"filter\">filters</dfn>.",
      why: "A 401 or a 429 never reaches the service, so its logs won't explain it.",
      prereqs: [],
      example: "A client calls <code>GET /orders</code> with a valid token, but it has used up its <dfn>quota</dfn>.",
    },
    body: "<p>The next steps follow the request filter by filter.</p>",
    diagram: {},
  },
  {
    title: "The listener accepts the call",
    summary: "the request enters the chain",
    body: "<p>The request first reaches the <mark>Listener</mark>, which hands it to the first filter. <strong>Every request takes the same path</strong>.</p>",
    diagram: { hl: ["in", "e1"] },
  },
  {
    title: "The JWT check reads the token",
    summary: "a bad token ends at a 401",
    body: "<p>Next the <mark>JWT check</mark> verifies the token. An expired one would stop here with a 401; ours is valid, so it moves on.</p>",
    diagram: { hl: ["jwt", "deny", "r401"], build: [["deny", "r401"]] },
  },
  {
    title: "The rate limit counts calls",
    summary: "over quota ends at a 429",
    body: "<p>The <mark>Rate limit</mark> counts the client's calls. <strong>Ours is over its <dfn>quota</dfn></strong>, so the reply is a 429 and <dfn>orders-svc</dfn> never sees it.</p>",
    diagram: { hl: ["e2", "rl", "slow", "r429"] },
    quiz: { q: "A client with an expired token and no quota left calls GET /orders. What does it get?",
      options: ["401", { t: "429", why: "The rate limit never runs: the JWT check comes first and stops the call." }, "200 from orders-svc"],
      answer: 0, why: "Filters run in order, and the first one that says no decides the reply." },
  },
  {
    title: "Recap",
    body: "<p>A request reaches <dfn>orders-svc</dfn> only if every <dfn>filter</dfn> lets it through; the first one that refuses decides the reply.</p>",
    diagram: {},
  },
];
