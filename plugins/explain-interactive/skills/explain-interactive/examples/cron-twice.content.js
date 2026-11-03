/* Content file for a "debugging" page: why a nightly report e-mail went out twice.
   Build it with:  node build.mjs examples/cron-twice.content.js -o ~/explanations/cron-twice.html
   Field reference: SKILL.md ("Page types"). */

const META = {
  type: "debugging",
  title: "Why the nightly report was sent twice",
  bigPicture: "Two copies of the scheduler were running during a deploy, and the job had no lock, so both of them sent the report.",
};

const CAST = {
  "report-job": "The scheduled job that builds the sales report and e-mails it at 02:00 every night.",
  "worker": "The service that runs report-job and other scheduled jobs; it runs as a Kubernetes Deployment.",
};

const GLOSSARY = {
  "rolling update": "A deploy that starts the new pods before stopping the old ones, so for a short time both versions run.",
  "lock": "A shared marker a job takes before it starts, so a second copy sees it is taken and skips the run.",
  "pod": "One running copy of a service in Kubernetes.",
};

/* Every hypothesis the story considers. A step raises one by giving it a verdict ("open"), and later steps
   change it to "ruled-out" or "confirmed". The board on each step shows only the ones raised so far. */
const HYPOTHESES = [
  { id: "retry", text: "The mail server retried a send that had in fact gone through" },
  { id: "schedule", text: "The schedule fires twice (a typo in the cron line)" },
  { id: "twoworkers", text: "Two worker pods ran the job at the same time" },
];

/* phase: symptom | hypothesis | evidence | cause | fix. evidence: { label, text } shows a log or command output. */
const STEPS = [
  {
    title: "What we're figuring out",
    summary: "one report, two e-mails",
    phase: "symptom",
    context: {
      question: "Why did customers get the 02:00 sales report twice on Tuesday?",
      setting: "<dfn>report-job</dfn> runs inside <dfn>worker</dfn>, which runs on Kubernetes and was deployed at 01:58 that night.",
      why: "A second e-mail is harmless here, but the same pattern would charge a card twice in the billing job.",
      prereqs: ["<dfn>pod</dfn>: one running copy of a service; a deploy replaces pods."],
      example: "Tuesday's run: two e-mails with the same report, 0.4 s apart.",
    },
    body: `<p>The next steps follow the investigation: what we suspected, what each piece of evidence showed, and what the cause was.</p>`,
    evidence: { label: "mail log, Tuesday", text: `02:00:00.112  to=sales-list  subject="Nightly report"  status=sent
02:00:00.508  to=sales-list  subject="Nightly report"  status=sent` },
  },
  {
    title: "Suspect the mail server",
    summary: "two sends, or one sent twice?",
    phase: "hypothesis",
    body: `<p>The mail log shows two sends. The first guess is that the mail server <strong>retried a send that had already gone through</strong>, which would give two e-mails from one call.</p>`,
    verdicts: { retry: "open" },
  },
  {
    title: "Each send has its own id",
    summary: "two message ids: two calls",
    phase: "evidence",
    body: `<p>A retry keeps the message id. The two e-mails have <strong>different message ids</strong>, so <dfn>report-job</dfn> called the mail server twice. The retry theory is out.</p>`,
    verdicts: { retry: "ruled-out" },
    evidence: { label: "grep 'Nightly report' mail.log", text: `02:00:00.112  msgid=<a81f@shop>  status=sent
02:00:00.508  msgid=<c03d@shop>  status=sent` },
  },
  {
    title: "Check the schedule",
    summary: "the cron line fires once",
    phase: "evidence",
    body: `<p>If the job itself ran twice, the schedule could be the reason. The cron line is <code>0 2 * * *</code>, once a day, and the job history shows a single run every other night. <strong>The schedule is fine.</strong></p>`,
    verdicts: { schedule: "ruled-out" },
    evidence: { label: "worker/config/schedule.yaml", text: `report-job:
  cron: "0 2 * * *"   # 02:00 every day` },
  },
  {
    title: "Two pods at 02:00",
    summary: "the deploy overlapped the run",
    phase: "evidence",
    body: `<p>The deploy at 01:58 was a <dfn>rolling update</dfn>: the new <dfn>pod</dfn> started before the old one stopped. At 02:00 <strong>both pods were running, and both had the schedule</strong>. Each one ran the job.</p>`,
    verdicts: { twoworkers: "open" },
    evidence: { label: "kubectl get pods -l app=worker (02:00)", text: `NAME              STATUS        AGE
worker-7d9f-x2kq  Running       2m
worker-5b1c-p8wn  Terminating   3d` },
    quiz: {
      q: "Both pods ran report-job. Which deploy setting would have prevented that on its own?",
      options: [
        "Stop the old pod before starting the new one",
        { t: "Run more pods", why: "More pods means more copies of the scheduler, so more duplicate runs, not fewer." },
        { t: "Deploy more slowly", why: "A slower rollout keeps both versions running together for longer." },
      ],
      answer: 0,
      why: "With the old pod stopped first there is never a moment with two schedulers; the price is a short gap with none.",
    },
  },
  {
    title: "The job takes no lock",
    summary: "nothing stops a second copy",
    phase: "cause",
    body: `<p>The overlap alone would be harmless if the job checked whether another copy was already running. <dfn>report-job</dfn> takes <strong>no <dfn>lock</dfn></strong>, so every copy of the scheduler runs it. That is the root cause: the deploy only made it visible.</p>`,
    verdicts: { twoworkers: "confirmed" },
    evidence: { label: "worker/jobs/report.go", text: `func (j *ReportJob) Run(ctx context.Context) error {
	rows, err := j.sales.Yesterday(ctx)   // ← no lock taken first
	…
	return j.mail.Send(ctx, report(rows))
}` },
  },
  {
    title: "Take a lock before sending",
    summary: "one copy wins, the other skips",
    phase: "fix",
    body: `<p>The fix makes each run take a <dfn>lock</dfn> named after the job and the day. The second pod finds it taken and skips. <strong>This holds for any number of pods</strong>, so the deploy strategy can stay as it is.</p>`,
    code: `ok, err := j.locks.TryAcquire(ctx, "report:"+day)   // ← new
if err != nil || !ok {
	return err   // another pod has it
}`,
  },
  {
    title: "Recap",
    body: `<p>Two pods overlapped during a <dfn>rolling update</dfn>, and <dfn>report-job</dfn> took no <dfn>lock</dfn>, so both sent the report. A lock per job and day makes the second copy skip.</p>`,
  },
];
