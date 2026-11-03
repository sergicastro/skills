// Drives a built page in headless Chrome (DevTools protocol, no dependencies) and checks the template's features.
// Skipped when no Chrome/Chromium is found; set CHROME=/path/to/chrome to choose one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { build, extract } from "../skills/explain-interactive/build.mjs";
import { findChrome, launch } from "../skills/explain-interactive/cdp.mjs";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "../skills/explain-interactive");
const skip = findChrome() ? false : "no Chrome/Chromium found (set CHROME=…)";

const tmp = mkdtempSync(join(tmpdir(), "explain-page-"));
let browser, send, js, open, problems = [], requests = [];

before(async () => {
  if (skip) return;
  browser = await launch();
  ({ send, js, open, problems, requests } = browser);
});
after(() => { browser?.close(); try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

test("built sample: features work in a browser", { skip }, async () => {
  const page = join(tmp, "sample.html");
  writeFileSync(page, build(readFileSync(join(SKILL, "examples/token-401.content.js"), "utf8")).html);
  await open(page);
  await js("localStorage.clear()"); await open(page);
  const step = () => js(`[...document.querySelectorAll(".step")].findIndex(a => a.classList.contains("active"))`);

  // shell, outline, context card, big picture
  assert.equal(await js(`document.title`), "Why an expired token gets a 401");
  assert.equal(await js(`document.querySelectorAll(".step").length`), 6);
  assert.equal(await js(`document.querySelectorAll("#outline button").length`), 6);
  assert.equal(await step(), 0);
  assert.ok(await js(`!!document.querySelector("#step-1 .ctx") && !!document.querySelector("#step-1 .bigpic")`));
  assert.equal(await js(`document.querySelector("#outline [aria-current=step] .t").textContent`), "What we're figuring out");

  // Next → step 2; diagram: new parts .hl, later parts ghosted, legend
  await js(`document.querySelector("#next").click()`);
  assert.equal(await step(), 1);
  assert.equal(await js(`location.hash`), "#step-2");
  assert.ok(await js(`document.querySelector('#step-2 [data-id=client]').classList.contains("hl") && document.querySelector('#step-2 [data-id=gw]').classList.contains("dim")`));
  assert.ok(await js(`!!document.querySelector("#step-2 .legend")`));
  assert.ok(await js(`!!document.querySelector("#step-2 .analogy")`));

  // keyboard → step 3; previously lit parts look normal; code line marked with ← highlighted
  await js(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`);
  assert.equal(await step(), 2);
  assert.ok(await js(`(c => !c.contains("hl") && !c.contains("dim"))(document.querySelector('#step-3 [data-id=client]').classList)`));
  assert.ok(await js(`!!document.querySelector("#step-3 pre .hl-line")`));

  // quiz: wrong → retry with option hint, wrong again → miss and the answer shown; sidebar mark
  const wrong = await js(`[...document.querySelectorAll("#step-3 .opts button")].filter(b => b.dataset.i !== "0").map(b => b.dataset.i)`);
  await js(`document.querySelector('#step-3 .opts button[data-i="${wrong[0]}"]').click()`);
  assert.ok(await js(`document.querySelector("#step-3 .quiz").classList.contains("retrying")`));
  await js(`document.querySelector('#step-3 .opts button[data-i="${wrong[1]}"]').click()`);
  assert.ok(await js(`(q => q.classList.contains("miss") && q.querySelector('[data-i="0"]').classList.contains("right"))(document.querySelector("#step-3 .quiz"))`));
  assert.equal(await js(`document.querySelectorAll("#outline .mk")[2].textContent`), "?");
  assert.match(await js(`document.querySelector("#live").textContent`), /Nothing is forwarded/);

  // "Still confused here": copies a prompt with the step's text, its terms, the missed check and what the reader typed
  await js(`window.__copied = null; navigator.clipboard.writeText = t => (window.__copied = t, Promise.resolve())`);
  await js(`(d => (d.open = true, d.querySelector("textarea").value = "why not the service?", d.querySelector("[data-copy]").click()))(document.querySelector("#step-3 .stuck"))`);
  await sleep(50);
  const prompt = await js(`window.__copied`);
  assert.match(prompt, /"Why an expired token gets a 401".*step 3 of 6: "/s);
  assert.match(prompt, /What this step says:\n- In short: .+\n- \S/);
  assert.doesNotMatch(prompt, /Terms it uses/, "step 3 has no <dfn>");
  assert.match(prompt, /I got this step's check wrong\. Question: ".+" The answer is ".+"\./);
  assert.match(prompt, /What's unclear to me: why not the service\?/);
  assert.doesNotMatch(prompt, /file:|\/Users\/|\/home\/|<\w/, "no path or markup in the prompt");
  assert.ok(await js(`document.querySelector("#step-3 .stuck .stuck-out").hidden`));
  assert.match(await js(`document.querySelector("#step-3 .stuck-msg").textContent`), /^Copied/);
  // step 2 uses <dfn>Gateway</dfn>: its definition goes along; nothing typed gets a stock line
  await js(`document.querySelector("#step-2 .stuck [data-copy]").click()`);
  await sleep(50);
  const prompt2 = await js(`window.__copied`);
  assert.match(prompt2, /Terms it uses, as the page defines them:\n- Gateway: \S/);
  assert.match(prompt2, /What's unclear to me: I can't say exactly/);
  assert.doesNotMatch(prompt2, /check wrong/);
  // no clipboard at all: the prompt is shown, selected, to copy by hand
  await js(`navigator.clipboard.writeText = () => Promise.reject(new Error("denied")); document.execCommand = () => false`);
  await js(`document.querySelector("#step-3 .stuck [data-copy]").click()`);
  await sleep(50);
  assert.ok(await js(`(o => !o.hidden && o.value.includes("step 3 of 6") && document.activeElement === o && getComputedStyle(o).display !== "none")(document.querySelector("#step-3 .stuck-out"))`));
  assert.match(await js(`document.querySelector("#live").textContent`), /Couldn't copy/);
  // typing in the box doesn't change step
  await js(`document.querySelector("#step-3 .stuck textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`);
  assert.equal(await step(), 2);

  // build stages: step 4 hides "deny" until Reveal
  await js(`document.querySelector("#next").click()`);
  assert.equal(await step(), 3);
  assert.equal(await js(`document.querySelector("#next .lbl").textContent`), "Reveal ▸");
  assert.ok(await js(`document.querySelector('#step-4 [data-id=deny]').classList.contains("pend")`));
  await js(`document.querySelector("#next").click()`);
  assert.equal(await step(), 3);
  assert.ok(await js(`!document.querySelector('#step-4 [data-id=deny]').classList.contains("pend")`));

  // browser Back moves between steps
  await js(`history.back()`); await sleep(200);
  assert.equal(await step(), 2);
  await js(`history.forward()`); await sleep(200);
  assert.equal(await step(), 3);

  // glossary tooltip and drawer (focus moves in, Esc closes and returns focus)
  await js(`document.querySelector("#step-1 dfn").dispatchEvent(new MouseEvent("mouseenter"))`);
  assert.ok(await js(`document.querySelector("#tip").classList.contains("on") && document.querySelector("#tip").textContent.length > 0`));
  await js(`(b => (b.focus(), b.click()))(document.querySelector('.top [data-act="gloss"]'))`);   // a real click focuses the button
  assert.ok(await js(`document.body.classList.contains("gloss") && document.activeElement.matches("#gloss .x")`));
  assert.match(await js(`document.querySelector("#gloss").textContent`), /Who's who.*orders-svc.*Terms.*token/s);
  await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  assert.ok(await js(`!document.body.classList.contains("gloss") && document.activeElement.matches('.top [data-act="gloss"]')`));

  // theme switch is remembered
  const dark = await js(`document.querySelector('.top [data-act="theme"]').click(), document.documentElement.dataset.theme`);
  assert.equal(await js(`localStorage.getItem("explain-theme")`), dark);

  // Show all, then back to step mode
  await js(`document.querySelector('.top [data-act="all"]').click()`);
  assert.ok(await js(`document.body.classList.contains("all") && [...document.querySelectorAll(".step")].every(a => getComputedStyle(a).display === "block")`));
  await js(`document.querySelector('.top [data-act="all"]').click()`);

  // progress survives a reload (last step, quiz result)
  await open(page);
  assert.equal(await step(), 3);
  assert.equal(await js(`document.querySelectorAll("#outline .mk")[2].textContent`), "?");
  assert.equal(await js(`document.documentElement.dataset.theme`), dark);

  // Recap: generated list, finish panel with score, Start over
  await js(`document.querySelectorAll("#outline button")[5].click()`);
  assert.equal(await js(`document.querySelectorAll("#step-6 .recap-list li").length`), 5);
  assert.match(await js(`document.querySelector("#score").textContent`), /0 of 1/);
  assert.equal(await js(`document.querySelector("#next .lbl").textContent`), "Finish ✓");
  await js(`document.querySelector('[data-finish="restart"]').click()`);
  assert.equal(await step(), 0);
  assert.equal(await js(`document.querySelectorAll("#outline .mk")[2].textContent`), "");

  // narrow screen: ☰ drawer and n / N counter
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  assert.equal(await js(`getComputedStyle(document.querySelector("#menu")).display !== "none" && document.querySelector("#count").textContent`), "1 / 6");
  await js(`document.querySelector("#menu").click()`);
  assert.ok(await js(`document.body.classList.contains("menu") && document.querySelector("#side").getAttribute("role") === "dialog" && document.activeElement.matches("#side .x")`));
  await send("Emulation.clearDeviceMetricsOverride");

  assert.deepEqual(problems, [], "console errors/warnings");
  assert.deepEqual(requests.filter(u => !u.startsWith("file:") && !u.startsWith("data:")), [], "external requests");
});

test("a page from the old template.html renders the same after extract + rebuild", { skip }, async t => {
  let old;
  try { old = execFileSync("git", ["show", "7de652b:plugins/explain-interactive/skills/explain-interactive/template.html"], { cwd: SKILL, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return t.skip("old template not in git history here"); }
  // The rebuilt page has engine features the old template lacked ("Still confused here"); compare the rest
  const snapshot = `document.querySelectorAll(".stuck").forEach(e => e.remove()), JSON.stringify({ title: document.title,
    stage: document.querySelector("#stage").innerHTML.replace(/>\\s+</g, "><"),
    outline: document.querySelector("#outline").innerHTML, gloss: document.querySelector("#gloss").innerHTML,
    next: document.querySelector("#next").textContent })`;
  const a = join(tmp, "old.html"), b = join(tmp, "rebuilt.html");
  writeFileSync(a, old);
  writeFileSync(b, build(extract(old)).html);
  await open(a); await js("localStorage.clear()"); await open(a);
  const before = await js(snapshot);
  await open(b); await js("localStorage.clear()"); await open(b);
  assert.equal(await js(snapshot), before);
});

// One page per type: each draws its own panel, and walking every step raises no console problems
async function openSample(name) {
  const page = join(tmp, `${name}.html`);
  writeFileSync(page, build(readFileSync(join(SKILL, `examples/${name}.content.js`), "utf8")).html);
  await open(page); await js("localStorage.clear()"); await open(page);
  return page;
}
const goTo = n => js(`document.querySelectorAll("#outline button")[${n - 1}].click()`);
const walkAll = async () => { const n = await js(`document.querySelectorAll(".step").length`); for (let i = 1; i < n; i++) await js(`document.querySelector("#next").click()`); };

test("decision page: options × criteria matrix, lit per step, recommendation", { skip }, async () => {
  problems.length = 0;
  await openSample("session-store");
  assert.ok(await js(`document.body.classList.contains("type-decision")`));
  assert.equal(await js(`document.querySelectorAll("#step-1 .matrix thead th[scope=col]").length`), 3);
  assert.equal(await js(`document.querySelectorAll("#step-1 .matrix tbody tr").length`), 4);   // 3 criteria + cost
  // step 2 lights the "shared" row and the memory column; later rows are ghosted; no recommendation yet
  assert.ok(await js(`(t => t.querySelector("tbody tr").classList.contains("hl") && t.querySelectorAll("tbody tr.dim").length === 3
    && t.querySelector("thead th.hl").textContent.startsWith("Server memory"))(document.querySelector("#step-2 .matrix"))`));
  assert.ok(await js(`!document.querySelector("#step-2 .matrix .rec") && !document.querySelector("#step-2 .rec-why")`));
  // ratings carry their level for screen readers too
  assert.match(await js(`document.querySelector("#step-2 .matrix .lv.poor").textContent`), /poor/);
  // step 5 sets recommend: the Redis column is marked and the reason shown, on that step and on the Recap
  for (const s of [5, 6]) {
    assert.match(await js(`document.querySelector("#step-${s} .matrix thead th.rec").textContent`), /Redis.*Recommended/);
    assert.match(await js(`document.querySelector("#step-${s} .rec-why").textContent`), /^Why Redis:/);
  }
  assert.ok(await js(`!document.querySelector("#step-6 .matrix .dim")`));
  await walkAll();
  assert.deepEqual(problems, []);
});

test("before/after page: banner and an aligned line diff that stacks on phones", { skip }, async () => {
  problems.length = 0;
  await openSample("multistage-build");
  assert.ok(await js(`document.body.classList.contains("type-before-after")`));
  assert.match(await js(`document.querySelector("#step-1 .ba").textContent`), /Before.*After/s);
  // step 2: one line changed → one del and one add on the same row
  assert.deepEqual(await js(`[...document.querySelectorAll("#step-2 .diff-grid .c:not(.hd)")].map(c => c.classList[2])`), ["del", "add", "same", "same"]);
  assert.ok(await js(`(c => c[0].style.getPropertyValue("--r") === c[1].style.getPropertyValue("--r"))(document.querySelectorAll("#step-2 .diff-grid .del, #step-2 .diff-grid .add"))`));
  // step 4: three added lines on the After side are padded on the Before side
  assert.equal(await js(`document.querySelectorAll("#step-4 .diff-grid .R.add").length`), 3);
  assert.equal(await js(`document.querySelectorAll("#step-4 .diff-grid .L.pad").length`), 3);
  assert.ok(await js(`document.querySelector("#step-4").classList.contains("wide")`));
  // diff text is shown as text, not markup
  assert.match(await js(`document.querySelector("#step-4 .diff-grid").textContent`), /COPY --from=build/);
  // two columns on a wide screen, one on a phone (the whole Before, then the whole After)
  await goTo(4);
  const cols = () => js(`getComputedStyle(document.querySelector("#step-4 .diff-grid")).gridTemplateColumns.split(" ").length`);
  assert.equal(await cols(), 2);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  assert.equal(await cols(), 1);
  // every Before line sits above the After header
  assert.ok(await js(`(g => { const top = e => e.getBoundingClientRect().top, after = top(g.querySelector(".R.hd"));
    return [...g.querySelectorAll(".L:not(.pad)")].every(e => top(e) < after); })(document.querySelector("#step-4 .diff-grid"))`));
  assert.ok(await js(`document.querySelector("#stage").scrollWidth <= document.querySelector("#stage").clientWidth + 1`), "no sideways scroll on a phone");
  await send("Emulation.clearDeviceMetricsOverride");
  await walkAll();
  assert.deepEqual(problems, []);
});

test("debugging page: phases, evidence and a case board that changes per step", { skip }, async () => {
  problems.length = 0;
  await openSample("cron-twice");
  assert.ok(await js(`document.body.classList.contains("type-debugging")`));
  assert.equal(await js(`document.querySelector("#step-1 .eyebrow .phase").textContent`), "Symptom");
  assert.equal(await js(`document.querySelectorAll("#outline .ph").length`), 7);
  assert.ok(await js(`!!document.querySelector("#step-1 .evidence pre") && !document.querySelector("#step-1 .board")`));
  // the board shows only hypotheses raised so far, with their state as of that step
  const board = s => js(`[...document.querySelectorAll("#step-${s} .board li")].map(l => l.className)`);
  assert.deepEqual(await board(2), ["v-open hl"]);
  assert.deepEqual(await board(3), ["v-ruled-out hl"]);
  assert.deepEqual(await board(5), ["v-ruled-out", "v-ruled-out", "v-open hl"]);
  assert.deepEqual(await board(6), ["v-ruled-out", "v-ruled-out", "v-confirmed hl"]);
  assert.deepEqual(await board(8), ["v-ruled-out", "v-ruled-out", "v-confirmed"]);
  await walkAll();
  assert.deepEqual(problems, []);
});

test("concept page: a layer stack that grows bottom-up", { skip }, async () => {
  problems.length = 0;
  await openSample("https-layers");
  assert.ok(await js(`document.body.classList.contains("type-concept")`));
  const stack = s => js(`[...document.querySelectorAll("#step-${s} .layer")].map(l => l.querySelector("b").textContent + ":" + (l.classList[1] || ""))`);
  assert.deepEqual(await stack(1), ["HTTP:dim", "TLS:dim", "TCP:dim", "IP:dim"]);
  assert.deepEqual(await stack(2), ["HTTP:dim", "TLS:dim", "TCP:dim", "IP:hl"]);
  assert.deepEqual(await stack(4), ["HTTP:dim", "TLS:hl", "TCP:", "IP:"]);
  assert.deepEqual(await stack(6), ["HTTP:", "TLS:", "TCP:", "IP:"]);
  // a layer not reached yet shows its name only, so the page doesn't explain it early
  assert.equal(await js(`document.querySelector("#step-2 .layer.dim span")`), null);
  await walkAll();
  assert.deepEqual(problems, []);
});
