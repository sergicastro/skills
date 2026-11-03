/* Content file for an explain-interactive page (layers layout): how a policy change reaches the gateway.
   Build it with:  node build.mjs examples/config-push.content.js
   Field reference: SKILL.md. Diagram layouts: diagram-recipes.md. */

const META = {
  title: "How a policy change reaches the gateway",
  bigPicture: "A change made in the console travels down through the API server to the gateway, which applies it to the next request.",
};

const CAST = {
  "Console": "The web screen where an operator edits policies.",
  "API server": "Stores configuration and tells gateways about changes.",
  "orders-svc": "The service that returns a customer's orders.",
};

const GLOSSARY = {
  "push": "Sending new configuration to a running gateway without restarting it.",
};

const DIAGRAM = {
  layout: "layers",
  label: "Console on top, then the API server, the gateway and orders-svc at the bottom",
  nodes: [
    { id: "ui", label: "Console" },
    { id: "api", label: "API server" },
    { id: "gw", label: "Gateway" },
    { id: "svc", label: "orders-svc" },
  ],
  edges: [
    { id: "save", from: "ui", to: "api", label: "PUT /policies/rate-limit" },
    { id: "push", from: "api", to: "gw", label: "config v42" },
    { id: "call", from: "gw", to: "svc", label: "GET /orders" },
    { id: "status", from: "gw", to: "ui", label: "applied v42", kind: "ok" },
  ],
};

const STEPS = [
  {
    title: "What we're figuring out",
    summary: "how a saved change takes effect",
    context: {
      question: "After a rate limit is changed in the <dfn>Console</dfn>, when does the gateway start using it?",
      setting: "Configuration lives in the <dfn>API server</dfn>; gateways keep their own copy.",
      why: "Testing a change before it has reached the gateway shows the old behaviour.",
      prereqs: [],
      example: "An operator raises the rate limit on <code>GET /orders</code> from 10 to 50 calls a minute.",
    },
    body: "<p>The next steps follow that change from the top layer down.</p>",
    diagram: {},
  },
  {
    title: "The console saves the change",
    summary: "the API server stores it",
    body: "<p>The change starts in the <mark>Console</mark>, which sends it to the <dfn>API server</dfn>. <strong>Saving does not change the gateway yet</strong>.</p>",
    diagram: { hl: ["ui", "save", "api"] },
  },
  {
    title: "The API server pushes it",
    summary: "the gateway gets config v42",
    body: "<p>Once stored, the API server <dfn data-term=\"push\">pushes</dfn> the new <mark>config v42</mark> to the gateway, which reports back that it applied it.</p>",
    diagram: { hl: ["push", "gw", "status"], build: ["push", "status"] },
    quiz: { q: "The console shows the change saved but not yet applied. What does GET /orders get?",
      options: ["The old limit of 10", { t: "The new limit of 50", why: "Saving only reaches the API server; the gateway still holds v41." }, "A 503 while the gateway reloads"],
      answer: 0, why: "The gateway enforces the configuration it holds until the push arrives." },
  },
  {
    title: "Requests use the new limit",
    summary: "the next call sees 50/minute",
    body: "<p>From the next request on, the gateway checks <mark>GET /orders</mark> against the new limit before passing it to <dfn>orders-svc</dfn>.</p>",
    diagram: { hl: ["call", "svc"] },
  },
  {
    title: "Recap",
    body: "<p>A change is saved in the <dfn>API server</dfn>, <dfn data-term=\"push\">pushed</dfn> to the gateway, and applies from the next request.</p>",
    diagram: {},
  },
];
