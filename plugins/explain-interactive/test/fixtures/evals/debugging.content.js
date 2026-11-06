/* Debugging page: why test_report_groups_by_day failed in CI about one run in four. */

const META = {
  type: "debugging",
  title: "Why the day-grouping test was flaky in CI",
  bigPicture: "The test's fixture made timestamps from the clock of the machine running it, while the report groups by the UTC date, so near UTC midnight one event slipped onto the next day and made a fourth group.",
};

const CAST = {
  "test_report_groups_by_day": "The test that builds some events and checks the daily report puts them into the right number of day groups (3).",
  "acme/metrics": "The repository the test lives in; it builds reports from stored events.",
  "events": "The database table the report reads; each row has a <code>created_at</code> timestamp.",
  "datetime.now()": "Python's call for the current time on the machine's own clock and time zone, with no zone attached to the result.",
};

const GLOSSARY = {
  "flaky test": "A test that passes or fails on the same code, depending on something outside the code (timing, order, clock).",
  "fixture": "Setup code that creates the data a test needs before it runs; here, rows in the events table.",
  "UTC": "The world reference time zone with no daylight saving. Madrid is UTC+1 in winter, UTC+2 in summer.",
  "time zone": "The offset from UTC a machine uses to show local time; set per machine, e.g. with the TZ variable.",
  "TZ": "An environment variable that tells a program which time zone to treat as local, e.g. TZ=UTC.",
  "naive datetime": "A Python datetime with no time zone attached: 23:30, but 23:30 where is left to whoever reads it.",
  "time-zone-aware": "A datetime that carries its offset (e.g. 23:30+00:00), so it means the same instant on every machine.",
  "DATE(created_at)": "SQL that cuts a timestamp down to its calendar day; the report groups rows by this value.",
  "test ordering": "The order a test runner runs tests in; if two tests share data, one can leave rows that break the other.",
};

const HYPOTHESES = [
  { id: "order", text: "Another test writing to the events table interferes (test ordering)" },
  { id: "timeout", text: "The CI database is slow and the test times out" },
  { id: "tz", text: "CI and laptops use different time zones, shifting an event's day" },
];

const STEPS = [
  {
    title: "What we're figuring out",
    summary: "green on laptops, red in CI",
    phase: "symptom",
    context: {
      question: "Why did <dfn>test_report_groups_by_day</dfn> fail in CI about one run in four, yet pass on every laptop?",
      setting: "In <dfn>acme/metrics</dfn>, a <dfn>fixture</dfn> inserts rows into the <dfn>events</dfn> table, and a report groups those rows by day. The test expects 3 day groups.",
      why: "A <dfn>flaky test</dfn> erodes trust in CI: people re-run until green and stop noticing real failures.",
      prereqs: ["<dfn>UTC</dfn>: the reference time zone; Madrid is 1 or 2 hours ahead of it.", "<dfn>fixture</dfn>: code that creates a test's data before it runs."],
      example: "The fixture's events are meant to fall on 3 different days, so the report should return 3 day groups. The failing CI run returned 4, with no code change between green and red runs.",
    },
    body: `<p>The next steps follow the investigation in the order it happened: three suspects, the evidence that ruled two out, and the fix.</p>`,
    evidence: { label: "CI failure (as reported)", text: `test_report_groups_by_day  FAILED
  assertion: expected 3 groups, found 4   ← wrong count, not a timeout
  rate: about 1 run in 4, CI only` },
  },
  {
    title: "Suspect: another test's rows",
    summary: "a shared table could leak data",
    phase: "hypothesis",
    body: `<p>The first suspect came from the setup: another test also writes to the <dfn>events</dfn> table. If that test ran first and left rows behind, the report would see extra events, and extra events could form an extra day group. <strong>That would depend on <dfn>test ordering</dfn></strong>, which CI runners and laptops don't always share (CI may run tests in parallel or in a different order).</p>`,
    verdicts: { order: "open" },
  },
  {
    title: "Alone in CI, still failing",
    summary: "no other test, same failure",
    phase: "evidence",
    body: `<p>To test that, the test was run <strong>on its own in CI</strong>, with no other test before it. It still failed. If nothing else touched the <dfn>events</dfn> table and the fourth group still appeared, ordering is not the cause.</p>`,
    verdicts: { order: "ruled-out" },
    evidence: { label: "CI, only this test selected", text: `test_report_groups_by_day  FAILED
  expected 3 groups, found 4` },
    quiz: {
      q: "Running the test alone in CI still fails. What does that tell you?",
      options: [
        "The extra group is produced by this test's own data and setup",
        { t: "Ordering is still the likely cause, just less often", why: "With no other test running, there is no ordering at all, so it can't be the cause of this failure." },
        { t: "The CI database must be broken", why: "Nothing points at the database yet; the result only removes outside tests from the picture." },
      ],
      answer: 0,
      why: "Removing every other test removes any leaked rows. What's left is the test, its fixture, and the machine it runs on.",
    },
  },
  {
    title: "Suspect: a slow database",
    summary: "a wrong count, not a timeout",
    phase: "evidence",
    body: `<p>CI machines are often slower than laptops, so the second suspect was a slow database making the test time out. Looking closer at the failure settled it: <strong>a timeout and a wrong answer fail differently</strong>: a timeout stops the test with a time-limit error, while here the test finished and its assertion found 4 groups. A slow database gives the same answer, just later, so this is out too.</p>`,
    verdicts: { timeout: "ruled-out" },
    evidence: { label: "the failure line again", text: `expected 3 groups, found 4   ← test ran to the end` },
  },
  {
    title: "CI and laptops keep different clocks",
    summary: "CI is UTC, laptops are Madrid",
    phase: "hypothesis",
    body: `<p>With leaked data and speed ruled out, the next question was what else differs between a CI runner and a laptop. A wrong count of <em>days</em> pointed at clocks: <strong>CI runners use <dfn>UTC</dfn>; the laptops use Europe/Madrid</strong>, one or two hours ahead. The <dfn>fixture</dfn> builds event times from <dfn>datetime.now()</dfn>, so its events depend on <strong>when</strong> the test runs and <strong>in which zone</strong>.</p>`,
    verdicts: { tz: "open" },
    evidence: { label: "time zone per machine", text: `CI runner : TZ = UTC
laptops   : TZ = Europe/Madrid  (UTC+1 winter, UTC+2 summer)` },
  },
  {
    title: "An event crosses UTC midnight",
    summary: "one event lands on tomorrow",
    phase: "cause",
    body: `<p>The fixture starts from <dfn>datetime.now()</dfn> and places an event late in the evening, around 23:30 local, as a <dfn>naive datetime</dfn>. The report draws its day lines at <strong>midnight <dfn>UTC</dfn></strong> with <dfn>DATE(created_at)</dfn>. Because the times move with the clock, a CI job running <strong>close to midnight UTC</strong> pushed one event past 00:00 UTC: it got the next day's date and formed a <strong>fourth group</strong>. Laptops ran in Madrid's zone, and their events stayed on the same side of the line.</p>`,
    evidence: { label: "one event, read as a UTC date", text: `test expects    : 3 day groups
CI job runs     : close to 00:00 UTC
one event's time: lands just after 00:00 UTC
its DATE(...)   : the next day          ← new group
report returns  : 4 day groups` },
    deeper: `<p><strong>What wasn't recorded:</strong> the investigation notes don't include the fixture's exact code. So this page doesn't show the arithmetic that moves the event (how <code>now()</code> and the 23:30 time combine), or why the failure rate came out near one in four. Probably that's the share of CI runs that land in the risky window, but that is a guess. What was recorded: times come from <code>datetime.now()</code>, there's an event at 23:30 local, the report groups by UTC date, failures happened when the job ran near midnight UTC, and the <code>TZ=UTC</code> reproduction below.</p>`,
    quiz: {
      q: "Suppose the fixture had used fixed times instead of datetime.now(). Would it matter what time of day CI ran the test?",
      options: [
        "No: the same events, the same UTC dates, the same 3 groups every run",
        { t: "Yes: near UTC midnight it would still make 4 groups", why: "The day line only moved events because their times moved with the clock. Fixed times sit in the same place on every run." },
        { t: "Only on laptops in Madrid", why: "With fixed times, the machine's zone and the time of the run no longer feed into the data." },
      ],
      answer: 0,
      why: "The trap is blaming midnight itself. The boundary is always there. The bug is data that moves relative to it, depending on when the test runs.",
    },
  },
  {
    title: "Reproduce it with TZ=UTC",
    summary: "act like CI: fails after 23:00",
    phase: "evidence",
    body: `<p>To prove it, a laptop was made to use CI's zone by setting <dfn>TZ</dfn><code>=UTC</code>. <strong>The test then failed every time it ran after 23:00</strong>, the hour before UTC midnight. Changing one setting turned a random failure into one you can predict from the clock, and that confirms both the cause and the late-night window.</p>`,
    verdicts: { tz: "confirmed" },
    evidence: { label: "laptop with TZ=UTC", text: `TZ=UTC, run after 23:00 : failed every time   ← reproduced
default Madrid zone     : passed` },
  },
  {
    title: "Fixed, zone-aware timestamps",
    summary: "same instants on every machine",
    phase: "fix",
    body: `<p>The fix stops the fixture from reading the clock at all. It builds events with <strong>fixed, <dfn>time-zone-aware</dfn> timestamps</strong>, so each event is the same instant, with the same UTC date, on any machine at any hour. A fixed 23:30 is safe even though it's near midnight, because it never moves. The change is to the test's fixture only: the report's grouping by UTC date was not the bug.</p>`,
    code: `from datetime import datetime, timezone

# before: depends on machine clock and zone
# t = datetime.now()

# after: same instant everywhere
t = datetime(2026, 3, 1, 23, 30,
             tzinfo=timezone.utc)   # ← fixed + aware`,
    deeper: `<p>The snippet is a sketch of the approach, not the exact change in <code>acme/metrics</code>. Picking times well away from midnight UTC, or deliberately one just after it, also lets a test check the day boundary on purpose.</p>`,
  },
  {
    title: "Recap",
    body: `<p>The fixture took times from the local clock, the report grouped by UTC date, and because times moved with the clock, runs near UTC midnight pushed one event onto the next day. Fixed, time-zone-aware timestamps make the test give the same answer everywhere.</p>`,
  },
];
