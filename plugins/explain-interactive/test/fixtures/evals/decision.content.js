const META = {
  type: "decision",
  title: "Where recipe-site's email jobs should queue",
  bigPicture: "Moving the welcome and digest emails out of the web request needs a job queue; at 2,000 emails a day, with two people and Postgres already running, a jobs table in Postgres does the job with nothing new to operate.",
};

const CAST = {
  "acme/recipe-site": "The web app this page is about: users sign up, get a welcome email, and later get digest emails.",
  "jobs": "The table we would add to the existing Postgres database; one row per email waiting to be sent.",
  "worker": "A separate background process that picks up queued jobs and actually sends the emails, so the web request doesn't wait. Every option needs one; only where the jobs wait differs.",
};

const GLOSSARY = {
  "job queue": "A list of work to do later. The web request adds an item and returns at once; a worker takes items off and does them.",
  "background job": "Work done outside the web request, by a worker, after the user already got their response.",
  "SKIP LOCKED": "Part of a Postgres query (SELECT … FOR UPDATE SKIP LOCKED): each worker locks the rows it takes and skips rows another worker has locked, so two workers never send the same email.",
  "persistence": "Whether a store writes its data to disk. Redis keeps data in memory and only survives a restart if persistence is turned on.",
  "emulator": "A local program that imitates a cloud service so you can develop without the real one.",
  "managed cloud queue": "A queue service run by a cloud provider (for example Amazon SQS or Google Cloud Pub/Sub); you pay per message and don't run servers.",
  "polling": "The worker asking the jobs table \"anything new?\" every second or so. The delay before an email goes out is at most that interval, which is fine for email.",
  "digest": "A periodic summary email sent to users, as opposed to the one-off welcome email.",
};

const DECISION = {
  options: [
    { id: "pg", name: "Postgres table", summary: "a jobs table polled by a worker" },
    { id: "redis", name: "Redis + queue library", summary: "an in-memory queue service" },
    { id: "cloud", name: "Managed cloud queue", summary: "a provider-run queue" },
  ],
  criteria: [
    { id: "load", name: "Handles our volume" },
    { id: "durable", name: "Survives a restart" },
    { id: "ops", name: "New things to run" },
    { id: "dev", name: "Local development" },
  ],
  ratings: {
    pg: {
      load: { level: "good", note: "a few hundred jobs/s; we need ~2,000 a day" },
      durable: { level: "good", note: "jobs are rows on disk" },
      ops: { level: "good", note: "nothing new: Postgres already runs" },
      dev: { level: "good", note: "the local database you already have" },
    },
    redis: {
      load: { level: "good", note: "very fast; far more than we need" },
      durable: { level: "fair", note: "jobs lost on restart unless persistence is on" },
      ops: { level: "poor", note: "one more service to run and watch" },
      dev: { level: "fair", note: "run a local Redis too" },
    },
    cloud: {
      load: { level: "good", note: "scales without a practical limit" },
      durable: { level: "good", note: "provider keeps messages safely" },
      ops: { level: "fair", note: "no servers, but a vendor account and credentials" },
      dev: { level: "poor", note: "needs an emulator locally" },
    },
  },
  cost: {
    pg: "No new bill; a little more load on the existing database",
    redis: "Hosting for one more service, plus the time to look after it",
    cloud: "A small charge per message, and a vendor dependency",
  },
  recommend: "pg",
  why: "all three handle 2,000 emails a day, so the deciding factor is what a two-person team must run: the Postgres table adds nothing new and keeps jobs safe on disk.",
};

const STEPS = [
  {
    title: "What we're deciding",
    summary: "where recipe-site's email jobs wait",
    context: {
      question: "Which <dfn>job queue</dfn> should <dfn>acme/recipe-site</dfn> use to send its welcome and <dfn>digest</dfn> emails in the background?",
      setting: "Today the web request sends the email itself before answering, so the signup page waits on the email provider. A queue lets the request just record \"send this\" and return while a <dfn>worker</dfn> sends it (every option needs that worker; they differ in where waiting jobs are kept).",
      why: "Pick something too big and a two-person team ends up running and paying for infrastructure it doesn't need; pick something fragile and emails silently go missing.",
      prereqs: ["<dfn>background job</dfn>: work done after the user already got their page back."],
      example: "A new user, Maya, signs up. Her welcome email becomes a job; the team's figures: about 2,000 emails a day, two people, Postgres already running.",
    },
    body: `<p>The table puts the three options against what matters for this site. The next steps fill it in one row at a time, ending with the cost and a pick.</p>`,
    matrix: {},
  },
  {
    title: "Can each one keep up?",
    summary: "all three handle 2,000 a day",
    body: `<p>Maya's welcome email is one of about 2,000 a day: roughly <strong>one or two a minute</strong> on average. The <mark>Handles our volume</mark> row shows that a Postgres table copes with a few hundred jobs a <em>second</em> (a common rule of thumb, not a benchmark of this site), and Redis and the cloud queue go far beyond that. <strong>Speed rules nothing out here</strong>, so the extra headroom of Redis or the cloud queue is not worth anything to us yet.</p>`,
    matrix: { criteria: ["load"], options: ["pg", "redis", "cloud"] },
    deeper: `<p>The worker finds new rows by <dfn>polling</dfn>; each check is a small query, so the extra load on the main database is minor at this volume. Digest emails may go out in a burst rather than spread over the day (an assumption; check how the digest is scheduled). Even 2,000 jobs queued at once drain in seconds at a few hundred per second.</p>`,
    quiz: {
      q: "The site grows tenfold to 20,000 emails a day. What happens to the Postgres option?",
      options: [
        "Still fine: that's about one job every 4 seconds",
        { t: "It has to be replaced by Redis", why: "20,000 a day is well under one job a second, far below the few hundred a second a jobs table handles." },
        { t: "Only the cloud queue can scale that far", why: "Unlimited scale only matters once you approach Postgres's limit, which is orders of magnitude away." },
      ],
      answer: 0,
      why: "The ceiling is hundreds of jobs per second; a day has 86,400 seconds. The trap is treating \"scales further\" as a reason to pick something before you need it.",
    },
  },
  {
    title: "Do jobs survive a restart?",
    summary: "Redis can lose queued emails",
    body: `<p>Suppose the queue's server restarts while Maya's email is still waiting. In <mark>Redis</mark> the queue lives in memory, so without <dfn>persistence</dfn> turned on (it can be, but that is one more setting to get right and to watch) her job is simply gone and she never gets the email. A Postgres row is on disk, and the cloud provider stores messages durably. <strong>A queue that can drop jobs needs extra setup to be safe.</strong></p>`,
    matrix: { criteria: ["durable"], options: ["redis"] },
    quiz: {
      q: "Maya's job is waiting in the Postgres jobs table when the worker crashes mid-send. What happens to it?",
      options: [
        "The row stays; a worker picks it up again",
        { t: "It is lost with the worker", why: "The job is a row in the database, not in the worker's memory; the crash only releases the worker's lock." },
        { t: "Two workers both send it", why: "Workers lock the row they take and skip rows another one holds; once the crashed worker's lock is released, only one worker takes it." },
      ],
      answer: 0,
      why: "The job lives in the table until a worker marks it done. The lock belongs to the worker's database transaction, and a crash ends that transaction, so the row is free to retry. One catch: if the email went out just before the crash, a retry sends it twice; for a welcome email that is usually acceptable.",
    },
    deeper: `<p>A worker grabs work with <code>SELECT … FOR UPDATE SKIP LOCKED</code>: it locks a row it takes and skips rows other workers hold. That lets you run more than one worker safely. Another Postgres-only bonus: the signup and its email job can be written in <strong>the same transaction</strong>, so you never get a user without a queued welcome email, or the other way round. Redis or a cloud queue live outside the database, so they can't join that transaction. Sent rows should be deleted, or cleaned up now and then, so the table stays small.</p>`,
  },
  {
    title: "Who runs it?",
    summary: "Postgres adds nothing to operate",
    body: `<p>Someone has to install, upgrade, monitor and fix whatever holds Maya's job, and the team is two people. The <mark>New things to run</mark> row: <dfn>acme/recipe-site</dfn> already runs Postgres, so a <dfn>jobs</dfn> table adds no new service. Redis is a whole extra service to look after; a <dfn>managed cloud queue</dfn> has no servers, but brings a vendor account, credentials and its own failures. <strong>For a small team, every extra service is a real ongoing cost.</strong></p>`,
    matrix: { criteria: ["ops"], options: ["pg", "redis", "cloud"] },
  },
  {
    title: "Can you run it locally?",
    summary: "the cloud queue needs an emulator",
    body: `<p>To test the signup flow on a laptop, Maya's job must be queued and sent there too. With Postgres it goes into the local database you already use. Redis means also starting a local Redis. The <mark>Managed cloud queue</mark> only exists in the cloud, so local work needs an <dfn>emulator</dfn> that imitates it, and <strong>an emulator can behave slightly differently from the real thing</strong>.</p>`,
    matrix: { criteria: ["dev"], options: ["cloud"] },
  },
  {
    title: "Cost, and the pick",
    summary: "Postgres wins: nothing new, safe enough",
    body: `<p>The <mark>Cost</mark> row adds the price: Postgres costs no new bill, only a little more database load; Redis costs hosting and care; the cloud queue charges per message and ties you to a vendor. Since every option handles our volume, <strong>the pick comes down to what the team must run</strong>, and the Postgres table is the one that adds nothing and keeps jobs on disk.</p>`,
    matrix: { criteria: ["cost"], recommend: true },
    quiz: {
      q: "What change would most likely make it worth revisiting this choice?",
      options: [
        "Sending hundreds of jobs per second, steadily",
        { t: "Doubling to 4,000 emails a day", why: "Still only a few jobs a minute; nowhere near the Postgres table's limit." },
        { t: "Adding a third email type", why: "A new email type is just another kind of row in the same table." },
        { t: "Wanting retries after failures", why: "A jobs table handles retries fine: a failed row stays and is picked up again." },
      ],
      answer: 0,
      why: "The Postgres table's real limit is throughput of a few hundred jobs a second; until then the other options only add things to run.",
    },
  },
  {
    title: "Recap",
    body: `<p>All three queues handle 2,000 emails a day, so the choice rests on durability and on what a two-person team must run. A Postgres <dfn>jobs</dfn> table keeps jobs on disk and adds no new service: pick it, and revisit only if the site nears hundreds of jobs a second.</p>`,
  },
];
