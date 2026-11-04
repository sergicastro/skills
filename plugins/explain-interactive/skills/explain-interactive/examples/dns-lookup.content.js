/* Content file for an explain-interactive page: how a name is resolved to an address, one server at a time.
   Build it with:  node build.mjs examples/dns-lookup.content.js -o ~/explanations/dns-lookup.html
   Field reference: SKILL.md. Diagram layouts: diagram-recipes.md.
   The sequence has five columns, so it is wider than the side column takes and every step goes full width;
   most middle steps also carry a quiz. It is the page that checks both fit on one 1280×800 screen. */

const META = {
  title: "How www.example.org becomes an address",
  bigPicture: "A resolver asks the root, then .org, then example.org's own name server, and caches each answer it gets.",
};

const CAST = {
  "Laptop": "The machine whose browser wants to open www.example.org.",
  "Resolver": "The recursive resolver the laptop is configured to use; it does the asking on the laptop's behalf.",
  "Root server": "One of the servers at the top of DNS; it knows where each top-level domain's servers are.",
  ".org server": "A name server for the .org top-level domain; it knows which servers hold each .org domain.",
  "example.org server": "The authoritative name server for example.org; it holds the actual records.",
};

const GLOSSARY = {
  "referral": "An answer that says \"I don't know, but ask this server\", with that server's name and address.",
  "authoritative": "Holding the domain's records itself, rather than a copy learned from someone else.",
  "TTL": "Time to live: how many seconds a resolver may keep an answer before asking again.",
  "A record": "A DNS record that maps a name to an IPv4 address.",
};

const DIAGRAM = {
  layout: "sequence",
  label: "The resolver follows referrals from the root down to example.org's server",
  nodes: [
    { id: "laptop", label: "Laptop" },
    { id: "resolver", label: "Resolver" },
    { id: "root", label: "Root server" },
    { id: "tld", label: ".org server" },
    { id: "auth", label: "example.org server" },
  ],
  edges: [
    { id: "ask", from: "laptop", to: "resolver", label: "www.example.org A?" },
    { id: "q-root", from: "resolver", to: "root", label: "www.example.org A?" },
    { id: "r-root", from: "root", to: "resolver", label: "ask a .org server" },
    { id: "q-tld", from: "resolver", to: "tld", label: "www.example.org A?" },
    { id: "r-tld", from: "tld", to: "resolver", label: "ask ns1.example.org" },
    { id: "q-auth", from: "resolver", to: "auth", label: "www.example.org A?" },
    { id: "r-auth", from: "auth", to: "resolver", label: "192.0.2.10, TTL 300" },
    { id: "answer", from: "resolver", to: "laptop", label: "192.0.2.10" },
  ],
};

const STEPS = [
  {
    title: "What we're figuring out",
    summary: "how a name turns into an address",
    context: {
      question: "How does the laptop learn the address of <code>www.example.org</code> when no server it talks to knows it up front?",
      why: "Every connection by name starts with this lookup, and when one server in the chain is slow or wrong, the whole page waits or fails.",
      example: "A browser opens <code>www.example.org</code> for the first time, with an empty <dfn>Resolver</dfn> cache.",
    },
    body: `<p>The next steps follow one lookup, from the question the laptop asks to the address it gets back.</p>`,
    diagram: {},
  },
  {
    title: "The laptop asks its resolver",
    summary: "one question, handed off",
    body: `<p>The <dfn>Laptop</dfn> sends one question, <mark>www.example.org A?</mark>, to its <dfn>Resolver</dfn>. <strong>It asks nobody else</strong>: finding the answer is now the resolver's job.</p>`,
    diagram: { hl: ["laptop", "resolver", "ask"] },
    quiz: { q: "The resolver takes five seconds to answer. Who does the laptop ask in the meantime?",
      options: ["Nobody: it waits for the resolver", { t: "The root server", why: "The laptop never talks to the root; only the resolver does." },
        { t: "example.org's server directly", why: "The laptop doesn't know where that server is; finding it is what the lookup is for." }],
      answer: 0, why: "The laptop hands the whole question to one resolver and waits; every later message in the picture is the resolver's." },
  },
  {
    title: "The root sends it to .org",
    summary: "a referral, not an answer",
    body: `<p>With an empty cache, the resolver starts at the top and asks a <dfn>Root server</dfn> <mark>www.example.org A?</mark>. The root doesn't hold the record. <strong>It returns a <dfn>referral</dfn></strong>: the names and addresses of the servers for <code>.org</code>.</p>`,
    diagram: { hl: ["root", "q-root", "r-root"] },
    quiz: { q: "What does the root server know about www.example.org?",
      options: ["Only which servers handle .org", { t: "Its address", why: "The root holds no records for names under .org; it only points to the .org servers." },
        { t: "Which server holds example.org", why: "That is what the .org servers know, one level down." }],
      answer: 0, why: "Each level knows only the next one down: the root knows the top-level domains, and nothing below them." },
  },
  {
    title: ".org points to example.org's server",
    summary: "one level down",
    body: `<p>The resolver asks the <dfn>.org server</dfn> the same question. It answers with another <dfn>referral</dfn>: <mark>ask ns1.example.org</mark>. <strong>The question never changes</strong>; only the server it goes to does.</p>`,
    diagram: { hl: ["tld", "q-tld", "r-tld"] },
    quiz: { q: "Why does the resolver send the full name www.example.org to the .org server, not just example.org?",
      options: ["It always asks the whole question and lets each server answer what it can",
        { t: "The .org server needs the www part to pick a server", why: "It answers the same referral for any name under example.org." },
        { t: "A shorter question would be refused", why: "It would be accepted; resolvers simply ask the whole name, and each server answers what it can." }],
      answer: 0, why: "Each server answers what it can: the root and .org reply with a referral, and only example.org's server has the record itself." },
  },
  {
    title: "The authoritative server answers",
    summary: "the record, with a TTL",
    body: `<p>The <dfn>example.org server</dfn> is <dfn>authoritative</dfn> for the domain, so it returns the <dfn>A record</dfn> itself: <mark>192.0.2.10, TTL 300</mark>. <strong>The <dfn>TTL</dfn> says the resolver may reuse this answer for 300 seconds</strong>.</p>`,
    diagram: { hl: ["auth", "q-auth", "r-auth"] },
    quiz: { q: "A second laptop using the same resolver asks for www.example.org 60 seconds later. Who answers it?",
      options: ["The resolver, from its cache", { t: "The example.org server again", why: "The TTL of 300 seconds hasn't run out, so the resolver has no reason to ask." },
        { t: "The root server", why: "The resolver starts at the root only when it has nothing cached for the name." }],
      answer: 0, why: "Within the TTL the resolver answers from its cache, and none of the three servers hears about the second lookup." },
  },
  {
    title: "The laptop gets its address",
    summary: "one reply after six hops",
    body: `<p>The resolver sends <mark>192.0.2.10</mark> back to the laptop. <strong>The laptop sees one question and one answer</strong>; the three servers in between stay invisible to it.</p>`,
    diagram: { hl: ["answer"] },
  },
  {
    title: "Recap",
    summary: "",
    body: `<p>The resolver walked down from the root, one <dfn>referral</dfn> at a time, until an <dfn>authoritative</dfn> server gave it the record, and it keeps that record for the <dfn>TTL</dfn>.</p>`,
    diagram: {},
  },
];
