// Drives a built page in headless Chrome (DevTools protocol, no dependencies) and checks the template's features.
// Skipped when no Chrome/Chromium is found; set CHROME=/path/to/chrome to choose one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { build, extract } from "../skills/explain-interactive/build.mjs";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "../skills/explain-interactive");
const CANDIDATES = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const CHROME = CANDIDATES.find(p => p && existsSync(p));
const skip = CHROME ? false : "no Chrome/Chromium found (set CHROME=…)";

const tmp = mkdtempSync(join(tmpdir(), "explain-page-"));
let proc, ws, seq = 0;
const pending = new Map(), events = [];
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
});
const js = async expr => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
async function open(file) {
  const loaded = new Promise(res => { const h = m => m.method === "Page.loadEventFired" && (events.splice(events.indexOf(h), 1), res()); events.push(h); });
  await send("Page.navigate", { url: pathToFileURL(file).href });
  await loaded; await sleep(100);
}
const problems = [], requests = [];

before(async () => {
  if (skip) return;
  const profile = join(tmp, "profile");
  proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--window-size=1280,800", "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) problems.push(m.params.args.map(a => a.value).join(" "));
    if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
    [...events].forEach(h => h(m));
  });
  await Promise.all(["Page.enable", "Runtime.enable", "Network.enable"].map(m => send(m)));
});
after(() => { ws?.close(); proc?.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

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
  const snapshot = `JSON.stringify({ title: document.title, stage: document.querySelector("#stage").innerHTML,
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
