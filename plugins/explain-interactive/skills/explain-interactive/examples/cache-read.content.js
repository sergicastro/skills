/* Content file for an explain-interactive page: how a read goes through a cache, with what-if controls.
   Build it with:  node build.mjs examples/cache-read.content.js -o ~/explanations/cache-read.html
   Field reference: SKILL.md ("What-if controls"). Diagram layouts: diagram-recipes.md.
   Step 4 switches between a cache hit and a miss (a choice); step 6 moves the entry's age past its TTL (a slider). */

const META = {
  title: "How a cached read is served",
  bigPicture: "products-api asks Redis before Postgres, so a repeated read is answered from memory until its entry expires.",
};

const CAST = {
  "products-api": "The service that answers GET /products/{id}.",
  "Redis": "An in-memory key-value store; here, the cache in front of the database.",
  "Postgres": "The database that holds every product; the source of truth.",
};

const GLOSSARY = {
  "cache": "A fast copy of data kept close to the code that reads it, so the slow source is asked less often.",
  "cache hit": "The cache already holds the key, so its copy is the answer.",
  "cache miss": "The cache doesn't hold the key, so the slow source has to be asked.",
  "TTL": "Time to live: how long an entry stays in the cache before it is removed.",
};

const DIAGRAM = {
  layout: "sequence",
  label: "products-api asks Redis first and Postgres only on a miss",
  nodes: [
    { id: "client", label: "Client" },
    { id: "api", label: "products-api" },
    { id: "cache", label: "Redis" },
    { id: "db", label: "Postgres" },
  ],
  edges: [
    { id: "req", from: "client", to: "api", label: "GET /products/42" },
    { id: "get", from: "api", to: "cache", label: "GET product:42" },
    { id: "hit", from: "cache", to: "api", label: "the cached product" },
    { id: "miss", from: "cache", to: "api", label: "(nil)" },
    { id: "query", from: "api", to: "db", label: "SELECT … WHERE id = 42" },
    { id: "row", from: "db", to: "api", label: "row 42" },
    { id: "set", from: "api", to: "cache", label: "SET product:42 EX 60" },
    { id: "resp", from: "api", to: "client", label: "200 OK" },
  ],
};

const MISS_PATH = ["miss", "query", "row", "set", "db"];

const STEPS = [
  {
    title: "What we're figuring out",
    summary: "why repeated reads skip the database",
    context: {
      question: "Why is the second <code>GET /products/42</code> answered without touching the database?",
      setting: "<dfn>products-api</dfn> keeps a <dfn>cache</dfn> in <dfn>Redis</dfn> in front of <dfn>Postgres</dfn>.",
      why: "Without the cache every read waits on the database, and a busy product page slows every other query down.",
      prereqs: ["<dfn>TTL</dfn>: how long a cached entry lives before it is removed."],
      example: "A client asks for product 42, which was cached 10 seconds ago with a 60-second <dfn>TTL</dfn>.",
    },
    body: `<p>The next steps follow that one request, and let you switch the cases that change its path.</p>`,
    diagram: {},
  },
  {
    title: "The request reaches products-api",
    summary: "GET /products/42 arrives",
    body: `<p>Our request starts at the <mark>Client</mark> and goes to <dfn>products-api</dfn>. <strong>The service decides where the answer comes from</strong>, so everything after this happens inside it.</p>`,
    diagram: { hl: ["client", "req"] },
  },
  {
    title: "Redis is asked first",
    summary: "the cache is checked before the database",
    body: `<p>Before going to the database, products-api sends <mark>GET product:42</mark> to <dfn>Redis</dfn>. <strong>Memory answers in well under a millisecond</strong>, so asking it first costs almost nothing even when it has no copy.</p>`,
    diagram: { hl: ["api", "get", "cache"] },
    code: `const hit = await redis.get("product:42"); // ←
if (hit) return JSON.parse(hit);`,
  },
  {
    title: "Hit or miss decides the path",
    summary: "a miss falls through to Postgres",
    body: `<p>What happens next depends on one thing: <strong>whether Redis holds the key</strong>. Switch between the two cases and watch the diagram.</p>`,
    whatif: {
      label: "the key is…",
      options: [
        { id: "hit", label: "in Redis", diagram: { hl: ["hit"] },
          outcome: `A <dfn>cache hit</dfn>: Redis returns <mark>the cached product</mark> and Postgres is never asked.` },
        { id: "miss", label: "not in Redis", diagram: { hl: ["miss", "query", "db"] },
          outcome: `A <dfn>cache miss</dfn>: Redis returns <mark>(nil)</mark>, so products-api runs the <mark>SELECT</mark> on <dfn>Postgres</dfn>.` },
      ],
    },
    quiz: { q: "Redis is down for a minute. What does products-api do for each read, if it treats an error like a miss?",
      options: ["Asks Postgres every time", { t: "Returns 404 for every product", why: "A miss means \"no copy here\", not \"no such product\": the database still has it." },
        { t: "Serves the last copy it had", why: "products-api keeps no copy of its own; the copy was in Redis." }],
      answer: 0, why: "Every read becomes a miss, so the database takes the full load: the cache only ever saves work, it never holds the only copy." },
  },
  {
    title: "A miss fills the cache",
    summary: "the row is written back with a TTL",
    body: `<p>After a miss, products-api gets <mark>row 42</mark> and writes it back with <mark>SET product:42 EX 60</mark>. <strong>The next read within 60 seconds is a hit</strong>, which is why only the first request pays for the database.</p>`,
    diagram: { hl: ["row", "set"] },
    quiz: { q: "Product 42 is not in Redis. Two clients ask for it 3 seconds apart. How many times does Postgres run the SELECT?",
      options: ["Once", { t: "Twice", why: "The first request's SET put row 42 in Redis, so the second one, 3 seconds later, is a hit." },
        { t: "Never", why: "With the key missing, the first request is a miss and has to read Postgres." }],
      answer: 0, why: "Only the first request pays for the database; its SET makes every read in the next 60 seconds a hit." },
  },
  {
    title: "The TTL ends the copy",
    summary: "after 60 seconds the next read misses",
    body: `<p>The <code>EX 60</code> from the last step is the entry's <dfn>TTL</dfn>: <strong>Redis deletes the key 60 seconds after it was written</strong>. Move the slider to change how old the entry is when our request arrives.</p>`,
    whatif: {
      label: "the cached entry is…",
      control: "slider",
      options: [
        { id: "10s", label: "10 s old", diagram: { hl: ["hit"], dim: MISS_PATH },
          outcome: `Still within its 60 seconds: a <mark>hit</mark>, served from Redis.` },
        { id: "59s", label: "59 s old", diagram: { hl: ["hit"], dim: MISS_PATH },
          outcome: `One second left, and still a <mark>hit</mark>: the copy is as good as it was at 10 seconds.` },
        { id: "61s", label: "61 s old", diagram: { hl: ["miss", "query"], dim: ["hit"] },
          outcome: `Redis already deleted it, so it is a <mark>miss</mark> and the <mark>SELECT</mark> runs again, then refills the cache.` },
      ],
    },
    deeper: `<p>Between the write and the expiry, a change to product 42 in Postgres isn't seen by readers: they get the cached copy for up to 60 seconds. A shorter TTL narrows that window at the cost of more misses; deleting the key when the product changes closes it.</p>`,
  },
  {
    title: "The answer goes back",
    summary: "both paths end in the same 200",
    body: `<p>Hit or miss, products-api replies <mark>200 OK</mark> with the same product. <strong>The client can't tell which path was taken</strong>, only how long it took.</p>`,
    diagram: { hl: ["resp"] },
  },
  {
    title: "Recap",
    body: `<p><dfn>products-api</dfn> asks <dfn>Redis</dfn> first; a miss goes to <dfn>Postgres</dfn> and refills the cache for 60 seconds.</p>`,
    diagram: {},
  },
];
