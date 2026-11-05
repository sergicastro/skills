/* Content file for an explain-interactive page: why GET /orders gets a 401 when the token has expired.
   Build it with:  node build.mjs examples/token-401.content.js -o ~/explanations/token-401.html
   Field reference: SKILL.md. Diagram layouts: diagram-recipes.md. */

const META = {
  title: "Why an expired token gets a 401",
  bigPicture: "The gateway checks every token before a request reaches a service, so an expired one is turned away at the door.",
};

/* Who's who: every project-specific name used on the page (services, files, functions, teams), each with a one-liner
   saying what it is / does. Shown first in the Glossary drawer; <dfn> tooltips look here too. */
const CAST = {
  // "name": "What it is, in one line.",
  "orders-svc": "The service that returns a customer's orders.",
  "Gateway": "The front door every request passes through; it checks tokens before forwarding.",
};

const GLOSSARY = {
  // "term": "Plain-language definition.",
  "token": "A signed string the client sends with each request to prove who it is; it stops working after its expiry time.",
  "401": "The HTTP status meaning \"not authenticated\": the server doesn't accept who you say you are.",
};

/* ONE diagram for the whole page, declared as a spec: the build lays it out, so there are no coordinates to write.
   layout: sequence (who calls whom, in order) | chain (stages left to right) | layers (a stack) | states (a lifecycle).
   Every node and edge id is a part a step can light up; edges take the real value that travels on them as their label.
   kind: "bad" (rejected) or "ok" (accepted). Patterns and rules: diagram-recipes.md. Replace this example. */
const DIAGRAM = {
  layout: "sequence",
  label: "A request goes from the client through the gateway to orders-svc",
  nodes: [
    { id: "client", label: "Client" },
    { id: "gw", label: "Gateway" },
    { id: "svc", label: "orders-svc" },
  ],
  edges: [
    { id: "req", from: "client", to: "gw", label: "GET /orders  Bearer eyJ…", term: "token" },
    { id: "deny", from: "gw", to: "client", label: "401 expired token", kind: "bad", term: "401" },
    { id: "fwd", from: "gw", to: "svc", label: "GET /orders", kind: "ok" },
  ],
};

/* Step fields: see SKILL.md. Visual options, in order of preference:
   diagram: { hl: ["ids new in this step"], hide: [...], dim: [...], build: ["id", ["id","id"], …] }
     → clones DIAGRAM; ids lit in earlier steps look normal, ids not introduced yet are ghosted, the Recap shows all.
     build = parts that appear one per "Reveal" click (Next / → ) before the step advances; keep it ≤ 4.
   visual: "<svg>…</svg>"  → escape hatch for a step that needs its own picture (put data-b="1".. on parts to stage them).
   quiz.options: plain strings, or { t, why } where why explains that specific wrong answer on the retry.
     Write them in any order (right answer first is fine): the page shuffles them on display. */
const STEPS = [
  {
    title: "What we're figuring out",
    summary: "why GET /orders returns 401",
    context: {
      question: "Why does <code>GET /orders</code> come back <strong><dfn>401</dfn></strong> when the token has expired?",
      setting: "Every request to our API passes the <dfn>Gateway</dfn> before it reaches a service such as <dfn>orders-svc</dfn>.",
      why: "If you don't know where the check happens, you'll go looking for the bug in the wrong service.",
      prereqs: ["<dfn>token</dfn>: the client sends it in the <code>Authorization</code> header to prove who it is."],
      example: "A client calls <code>GET /orders</code> with a token that expired 5 minutes ago.",
    },
    body: `<p>The next steps follow that one request from the client to the reply.</p>`,
    diagram: {},
  },
  {
    title: "The client sends a request",
    summary: "GET /orders leaves the client",
    body: `<p>Our request starts at the highlighted <mark>Client</mark>: <strong>GET /orders with an expired token</strong>, heading for the <dfn>Gateway</dfn>. We start here because everything after this reacts to what the client sent.</p>`,
    diagram: { hl: ["client", "req"] },
    analogy: "A visitor (the client) handing a badge (the token) to reception (the gateway) before going upstairs.",
    code: null,
    deeper: null,
  },
  {
    title: "The gateway checks the token",
    summary: "the first stop is a check",
    body: `<p>Once the request arrives, the <mark>Gateway</mark> looks at the token <strong>before</strong> anything reaches the service.</p>`,
    diagram: { hl: ["gw"] },
    code: `Authorization: Bearer eyJ…   // ← checked here`,
    quiz: { q: "What does the gateway do with the request first?",
      options: ["Checks the token", { t: "Forwards it to orders-svc", why: "That would skip the check; forwarding only happens after it passes." }, "Logs it and replies 200"],
      answer: 0, why: "Nothing is forwarded until the token is valid." },
  },
  {
    title: "A bad token stops here",
    summary: "expired tokens get a 401",
    body: `<p>Press <kbd>→</kbd> to reveal the reply. The expired token is rejected with a <mark>401</mark> and never reaches the service.</p>`,
    diagram: { hl: ["deny"], build: ["deny"] },
  },
  {
    title: "A good token passes through",
    summary: "valid tokens are forwarded",
    body: `<p>With a valid token the gateway forwards the request on to <mark>orders-svc</mark>.</p>`,
    diagram: { hl: ["fwd", "svc"] },
    quiz: { q: "The client retries GET /orders with a fresh token. Where does the request go after the gateway?",
      options: ["On to orders-svc", { t: "Back to the client with a 401", why: "A 401 is only for a token that fails the check; a fresh one passes." },
        { t: "Nowhere: the gateway answers it itself", why: "The gateway only checks and forwards; the orders come from orders-svc." }],
      answer: 0, why: "A valid token passes the gateway's check, so the request is forwarded to orders-svc." },
  },
  // ... more steps; the LAST one is always the Recap (its numbered step list is generated automatically)
  {
    title: "Recap",
    body: `<p>Every request meets the <dfn>Gateway</dfn> first: an expired <dfn>token</dfn> gets a <dfn>401</dfn> there, and only valid ones reach <dfn>orders-svc</dfn>.</p>`,
    diagram: {},
  },
];
