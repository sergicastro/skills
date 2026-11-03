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

test("spec diagrams: every layout renders, a wide one puts its steps full width, a raw <svg> still works", { skip }, async () => {
  const boxes = `[...document.querySelectorAll(".step.active .visual [data-id]")].map(g => g.getBBox()).filter(b => b.width && b.height)`;
  for (const [f, wide] of [["filter-chain", true], ["config-push", false], ["api-lifecycle", false], ["token-401", false]]) {
    const page = join(tmp, f + ".html");
    writeFileSync(page, build(readFileSync(join(SKILL, "examples", f + ".content.js"), "utf8")).html);
    await open(page); await js("localStorage.clear()"); await open(page);
    await js(`document.querySelector("#next").click()`);
    assert.equal(await js(`document.querySelector(".step.active").classList.contains("wide")`), wide, f);
    // the diagram is drawn: parts have real size, and its text stays at least 11px on screen
    assert.ok(await js(`${boxes}.length`) > 2, f);
    const px = await js(`(s => s.getBoundingClientRect().width / s.viewBox.baseVal.width * 14)(document.querySelector(".step.active .visual svg"))`);
    assert.ok(px >= 11, `${f}: label text renders at ${px.toFixed(1)}px`);
  }
  // raw <svg> escape hatch: a hand-written DIAGRAM still takes hl/dim from the step
  const raw = join(tmp, "raw.html");
  writeFileSync(raw, build(`const META = { title: "Raw", bigPicture: "B" };
const DIAGRAM = \`<svg viewBox="0 0 600 100" role="img" aria-label="two boxes"><g data-id="a"><rect class="box" x="10" y="10" width="100" height="40"/></g><g data-id="b"><rect class="box" x="300" y="10" width="100" height="40"/></g></svg>\`;
const STEPS = [{ title: "One", summary: "s", body: "<p>x</p>", diagram: { hl: ["a"] } }, { title: "Recap", body: "<p>y</p>", diagram: {} }];`).html);
  await open(raw); await js("localStorage.clear()"); await open(raw);
  assert.ok(await js(`document.querySelector('#step-1 [data-id=a]').classList.contains("hl") && document.querySelector('#step-1 [data-id=b]').classList.contains("dim")`));
  assert.equal(await js(`document.querySelectorAll("template#explain-diagram").length`), 0);
  assert.deepEqual(problems, [], "console errors/warnings");
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
