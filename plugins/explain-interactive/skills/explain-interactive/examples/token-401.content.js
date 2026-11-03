/* Content file for an explain-interactive page: why GET /orders gets a 401 when the token has expired.
   Build it with:  node build.mjs examples/token-401.content.js -o ~/explanations/token-401.html
   Field reference: SKILL.md. Diagram patterns: diagram-recipes.md. */

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

/* ONE diagram for the whole page. Every part that a step can light up is a <g data-id="…"> (data-id, not id: the
   SVG is cloned once per step). Elements keep the same position in every step; steps only choose what to light up.
   viewBox width 560–720 keeps the 14px text near its real size. Replace this example (client → gateway → service). */
const DIAGRAM = `<svg viewBox="0 0 640 170" role="img" aria-label="A request goes from the client through the gateway to orders-svc">
  <g data-id="client"><rect class="box" x="10" y="50" width="130" height="60" rx="8"/><text x="75" y="85" text-anchor="middle">Client</text></g>
  <g data-id="gw"><rect class="box" x="255" y="50" width="130" height="60" rx="8"/><text x="320" y="85" text-anchor="middle">Gateway</text></g>
  <g data-id="svc"><rect class="box" x="500" y="50" width="130" height="60" rx="8"/><text x="565" y="85" text-anchor="middle">orders-svc</text></g>
  <g data-id="req"><line class="arrow" x1="140" y1="70" x2="253" y2="70"/><text class="label" x="197" y="62" text-anchor="middle">GET /orders</text></g>
  <g data-id="deny"><line class="arrow bad" x1="253" y1="95" x2="142" y2="95"/><text class="label" x="197" y="115" text-anchor="middle">401 expired token</text></g>
  <g data-id="fwd"><line class="arrow ok" x1="385" y1="80" x2="498" y2="80"/><text class="label" x="442" y="72" text-anchor="middle">GET /orders</text></g>
</svg>`;

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
  },
  // ... more steps; the LAST one is always the Recap (its numbered step list is generated automatically)
  {
    title: "Recap",
    body: `<p>Every request meets the <dfn>Gateway</dfn> first: an expired <dfn>token</dfn> gets a <dfn>401</dfn> there, and only valid ones reach <dfn>orders-svc</dfn>.</p>`,
    diagram: {},
  },
];
