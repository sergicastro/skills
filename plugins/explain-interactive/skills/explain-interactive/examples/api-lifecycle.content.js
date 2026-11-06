/* Content file for an explain-interactive page (states layout): the states an API goes through.
   Build it with:  node build.mjs examples/api-lifecycle.content.js
   Field reference: SKILL.md. Diagram layouts: diagram-recipes.md. */

const META = {
  title: "The life of an API",
  bigPicture: "An API is written as a draft, published to the catalogue, and only serves traffic once it is deployed.",
};

const GLOSSARY = {
  "catalogue": "The list of APIs that developers can browse and subscribe to.",
  "deploy": "Put an API on a gateway so that calls to it are routed.",
};

const DIAGRAM = {
  layout: "states",
  label: "Draft, Published, Deployed and Retired, with the actions that move an API between them",
  nodes: [
    { id: "draft", label: "Draft" },
    { id: "pub", label: "Published" },
    { id: "dep", label: "Deployed" },
    { id: "ret", label: "Retired", kind: "bad" },
  ],
  edges: [
    { id: "edit", from: "draft", to: "draft", label: "edit" },
    { id: "publish", from: "draft", to: "pub", label: "publish" },
    { id: "deploy", from: "pub", to: "dep", label: "deploy" },
    { id: "undeploy", from: "dep", to: "pub", label: "undeploy" },
    { id: "unpublish", from: "pub", to: "draft", label: "unpublish" },
    { id: "retire", from: "pub", to: "ret", label: "retire" },
  ],
};

const STEPS = [
  {
    title: "What we're figuring out",
    summary: "why a published API gets no traffic",
    context: {
      question: "Why does a published API still answer 404?",
      setting: "An API moves through a few states; each action moves it to the next one.",
      why: "Publishing and deploying look alike in the console but do different things.",
      prereqs: [],
      example: "The <code>orders</code> API was published an hour ago, and <code>GET /orders</code> returns 404.",
    },
    body: "<p>The next steps walk the <code>orders</code> API through its states.</p>",
    diagram: {},
  },
  {
    title: "It starts as a draft",
    summary: "drafts can be edited freely",
    body: "<p>Every API begins as a <mark>Draft</mark>. <strong>Nobody outside the team sees it</strong>, so it can be edited as often as needed.</p>",
    diagram: { hl: ["draft", "edit"] },
  },
  {
    title: "Publishing lists it",
    summary: "published means listed, not served",
    body: "<p>Publishing moves it to <mark>Published</mark>: it appears in the <dfn>catalogue</dfn>. <strong>No gateway routes it yet</strong>, which is why our call gets a 404.</p>",
    diagram: { hl: ["publish", "pub"] },
    quiz: { q: "The orders API is Published but not Deployed. What does GET /orders return?",
      options: ["404", { t: "200", why: "Publishing only lists it in the catalogue; no gateway routes it." }, "401"],
      answer: 0, why: "Only a deployed API is routed by a gateway." },
  },
  {
    title: "Deploying serves it",
    summary: "deployed APIs get traffic",
    body: "<p>After publishing comes <dfn data-term=\"deploy\">deploying</dfn>, which moves it to <mark>Deployed</mark>: the gateway now routes <code>GET /orders</code>. Undeploying takes it back to Published.</p>",
    diagram: { hl: ["deploy", "dep", "undeploy"], build: ["deploy", "undeploy"] },
    quiz: { q: "The team undeploys orders to fix a bug. What happens to it?",
      options: ["Still in the catalogue, and GET /orders gets a 404",
        { t: "Gone from the catalogue, and GET /orders gets a 404", why: "Undeploying goes back to Published, and a Published API stays listed." },
        { t: "Still in the catalogue, and GET /orders still works", why: "Back in Published, no gateway routes it any more." }],
      answer: 0, why: "Undeploying moves it back to Published: listed in the catalogue, but not routed." },
  },
  {
    title: "Recap",
    body: "<p>Publishing lists an API; only <dfn data-term=\"deploy\">deploying</dfn> makes a gateway route it.</p>",
    diagram: {},
  },
];
