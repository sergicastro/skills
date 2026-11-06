// Drives a built page in headless Chrome (DevTools protocol, no dependencies) and checks the template's features.
// Skipped when no Chrome/Chromium is found; set CHROME=/path/to/chrome to choose one.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname, relative, resolve, sep } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { build, extract } from "../skills/explain-interactive/build.mjs";
import { launch } from "../skills/explain-interactive/cdp.mjs";
import { skip } from "./chrome.mjs";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "../skills/explain-interactive");

const tmp = mkdtempSync(join(tmpdir(), "explain-page-"));
let browser, send, js, open, problems = [], requests = [];

// Pages are served from the temp folder over http://127.0.0.1 rather than opened as file:// URLs. Under load, Chrome
// sometimes doesn't pass a file:// page's localStorage writes on to the pages loaded after it (a page that writes,
// then the tab moves to another file:// page, whose writes then never show up anywhere else). That made the tests
// that reload a page and check what it saved flaky. Over http it didn't happen once in the same stress runs.
const ROOT = realpathSync(tmpdir());
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
let server, base;
const served = file => base + "/" + relative(ROOT, realpathSync(file)).split(sep).map(encodeURIComponent).join("/");
// Requests other than the page's own files and data: URLs
const external = () => requests.filter(u => !u.startsWith("file:") && !u.startsWith("data:") && !u.startsWith(base + "/"));

before(async () => {
  if (skip) return;
  server = createServer((req, res) => {
    const path = resolve(ROOT, "." + decodeURIComponent(new URL(req.url, "http://x").pathname));
    let body; try { if (path.startsWith(ROOT + sep)) body = readFileSync(path); } catch {}
    if (!body) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }).end(body);
  });
  await new Promise(res => server.listen(0, "127.0.0.1", res));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await launch();
  ({ send, js, problems, requests } = browser);
  open = file => browser.open(served(file));
});
after(() => { browser?.close(); server?.close(); try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

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
  assert.doesNotMatch(prompt, /file:|https?:|\/Users\/|\/home\/|<\w/, "no path or markup in the prompt");
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
  assert.match(await js(`document.querySelector("#score").textContent`), /0 of 2/);
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
  assert.deepEqual(external(), [], "external requests");
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
    // the drawing fits both sides of the svg's box, so the smaller scale is the one it is drawn at
    const px = await js(`(s => (r => Math.min(r.width / s.viewBox.baseVal.width, r.height / s.viewBox.baseVal.height))(s.getBoundingClientRect()) * 14)(document.querySelector(".step.active .visual svg"))`);
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
  // The rebuilt page has engine features the old template lacked ("Still confused here", depth, clickable
  // diagram parts); take them out and compare the rest
  const snapshot = `document.querySelectorAll(".stuck, .depth-note, .def-hint").forEach(e => e.remove());
    document.querySelectorAll(".legend").forEach(e => { if (!e.children.length) e.remove(); });
    document.querySelectorAll(".eyebrow .pos, .eyebrow .tot").forEach(e => e.replaceWith(e.textContent));
    document.querySelectorAll("[data-def]").forEach(e => ["data-def", "tabindex", "role", "aria-label"].forEach(a => e.removeAttribute(a)));
    document.querySelectorAll(".visual svg[role=group]").forEach(e => e.setAttribute("role", "img"));
    document.querySelectorAll(".full-only").forEach(e => { e.classList.remove("full-only"); if (!e.classList.length) e.removeAttribute("class"); });
    document.querySelector("#stage").normalize();
    JSON.stringify({ title: document.title,
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

test("what-if controls: a choice and a slider switch the outcome and the diagram, by mouse, keyboard and screen reader", { skip }, async () => {
  problems.length = 0;
  const page = await openSample("cache-read");
  const lit = s => js(`[...document.querySelectorAll("#step-${s} .wi-view:not([hidden]) [data-id].hl")].map(e => e.dataset.id).sort()`);
  const shown = s => js(`[...document.querySelectorAll("#step-${s} .wi-out")].filter(o => !o.hidden).map(o => o.dataset.wi)`);
  const key = async k => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code: k, windowsVirtualKeyCode: { ArrowRight: 39, ArrowLeft: 37 }[k] }); };

  // choice: the first option is picked on arrival, and only its outcome and its diagram are shown
  await goTo(4);
  assert.deepEqual(await shown(4), ["hit"]);
  assert.deepEqual(await lit(4), ["hit"]);
  assert.equal(await js(`document.querySelectorAll("#step-4 .wi-view:not([hidden])").length`), 1);
  assert.ok(await js(`document.querySelector('#step-4 input[value="hit"]').checked`));
  // a click picks the other one, and the outcome is announced
  await js(`document.querySelector('#step-4 input[value="miss"]').click()`);
  assert.deepEqual(await shown(4), ["miss"]);
  assert.deepEqual(await lit(4), ["db", "miss", "query"]);
  assert.match(await js(`document.querySelector("#live").textContent`), /^not in Redis: A cache miss: Redis returns \(nil\)/);
  // keyboard: arrows move between the radios (native group) and don't change the step
  await js(`document.querySelector('#step-4 input[value="miss"]').focus()`);
  await key("ArrowLeft");
  assert.deepEqual(await shown(4), ["hit"]);
  assert.equal(await js(`location.hash`), "#step-4");
  // screen reader: a group named by its legend, holding radios named by their labels
  const ax = await send("Accessibility.getFullAXTree");
  const named = (role, name) => ax.nodes.some(n => n.role && n.role.value === role && n.name && n.name.value.replace(/\s+/g, " ").trim() === name);
  assert.ok(named("group", "What if the key is…"), "fieldset named by its legend");
  assert.ok(named("radio", "in Redis") && named("radio", "not in Redis"));

  // slider: a native range input; its value is read out as the option's label
  await goTo(6);
  assert.deepEqual(await shown(6), ["10s"]);
  assert.equal(await js(`document.querySelector("#step-6 input[type=range]").getAttribute("aria-valuetext")`), "10 s old");
  await js(`document.querySelector("#step-6 input[type=range]").focus()`);
  await key("ArrowRight"); await key("ArrowRight");
  assert.deepEqual(await shown(6), ["61s"]);
  assert.deepEqual(await lit(6), ["miss", "query"]);
  assert.equal(await js(`document.querySelector("#step-6 input[type=range]").getAttribute("aria-valuetext")`), "61 s old");
  assert.equal(await js(`document.querySelector("#step-6 .wi-ticks .on").textContent`), "61 s old");
  assert.equal(await js(`location.hash`), "#step-6");
  // a tick label is clickable too
  await js(`document.querySelectorAll("#step-6 .wi-ticks span")[1].click()`);
  assert.deepEqual(await shown(6), ["59s"]);

  // parts any option lit count as introduced on later steps, so they are not ghosted there
  assert.ok(await js(`!document.querySelector('#step-7 [data-id=query]').classList.contains("dim")`));

  // "Still confused here" says which case the reader was looking at
  await js(`window.__copied = null; navigator.clipboard.writeText = t => (window.__copied = t, Promise.resolve())`);
  await js(`document.querySelector("#step-6 .stuck [data-copy]").click()`);
  await sleep(50);
  assert.match(await js(`window.__copied`), /I set its "What if the cached entry is…" control to "59 s old", which shows: One second left/);

  // the choice is remembered across a reload, and Start over resets it
  await open(page);
  await goTo(6);
  assert.deepEqual(await shown(6), ["59s"]);
  await goTo(8);
  await js(`document.querySelector('[data-finish="restart"]').click()`);
  assert.deepEqual(await shown(6), ["10s"]);

  // every step can be walked without console problems
  await walkAll();
  assert.deepEqual(problems, []);
});

test("depth: the short version skips background steps, renumbers, and is remembered", { skip }, async () => {
  problems.length = 0;
  await openSample("filter-chain");
  const step = () => js(`[...document.querySelectorAll(".step")].findIndex(a => a.classList.contains("active"))`);
  const btn = `document.querySelector('.top [data-act="depth"]')`;
  assert.ok(await js(`!${btn}.hidden && ${btn}.getAttribute("aria-pressed") === "false"`));
  assert.equal(await js(`document.querySelector("#count").textContent`), "1 / 6");
  assert.match(await js(`document.querySelector("#step-2 .eyebrow").textContent`), /Step 2 of 6 · Background/);
  // full: Next goes to the background step
  await js(`document.querySelector("#next").click()`);
  assert.equal(await step(), 1);
  // switching to short while on it moves back to a step the short version shows
  await js(`${btn}.click()`);
  assert.ok(await js(`document.body.classList.contains("short") && ${btn}.getAttribute("aria-pressed") === "true"`));
  assert.equal(await step(), 0);
  assert.equal(await js(`localStorage.getItem("explain-depth")`), "short");
  assert.equal(await js(`document.querySelector("#count").textContent`), "1 / 5");
  assert.equal(await js(`document.querySelector("#next .sub").textContent`), "The listener accepts the call");
  // the skipped step is gone from the outline and the Recap list; the others are renumbered
  assert.equal(await js(`getComputedStyle(document.querySelectorAll("#outline li")[1]).display`), "none");
  assert.deepEqual(await js(`[...document.querySelectorAll("#outline li")].filter(l => getComputedStyle(l).display !== "none").map(l => l.querySelector(".n").textContent)`), ["1", "2", "3", "4", "5"]);
  assert.match(await js(`document.querySelector("#step-3 .eyebrow").textContent`), /Step 2 of 5/);
  // the Context card keeps the question and the example, and says what was left out
  assert.deepEqual(await js(`[...document.querySelectorAll("#step-1 .ctx dt")].filter(d => getComputedStyle(d).display !== "none").map(d => d.textContent)`), ["The question", "The example we'll follow"]);
  assert.match(await js(`(n => getComputedStyle(n).display !== "none" && n.textContent)(document.querySelector("#step-1 .depth-note"))`), /1 background step and part of this card left out/);
  // Next / Back step over it
  await js(`document.querySelector("#next").click()`);
  assert.equal(await step(), 2);
  await js(`document.querySelector("#prev").click()`);
  assert.equal(await step(), 0);
  // remembered across a reload; a link to the skipped step lands on the next one
  await js(`history.replaceState(null, "", "#step-2"); location.reload()`); await sleep(400);
  assert.ok(await js(`document.body.classList.contains("short")`));
  assert.equal(await step(), 2);
  // the "Still confused" prompt counts what the reader walks
  await js(`window.__copied = null; navigator.clipboard.writeText = t => (window.__copied = t, Promise.resolve())`);
  await js(`document.querySelector("#step-3 .stuck [data-copy]").click()`); await sleep(50);
  assert.match(await js(`window.__copied`), /step 2 of 5: "The listener accepts the call"/);
  // Show all hides it too
  await js(`document.querySelector('.top [data-act="all"]').click()`);
  assert.equal(await js(`getComputedStyle(document.querySelector("#step-2")).display`), "none");
  await js(`document.querySelector('.top [data-act="all"]').click()`);
  // the link on step 1 brings the full version back
  await js(`document.querySelectorAll("#outline button")[0].click()`);
  await js(`document.querySelector("#step-1 .depth-note button").click()`);
  assert.ok(await js(`!document.body.classList.contains("short")`));
  assert.equal(await js(`localStorage.getItem("explain-depth")`), "full");
  assert.equal(await js(`document.querySelector("#count").textContent`), "1 / 6");
  await js(`localStorage.removeItem("explain-depth")`);
  assert.deepEqual(problems, []);
});

test("a wide, tall diagram with a quiz: the quiz sits beside it and the step fits 1280×800; a narrow screen stacks them", { skip }, async () => {
  problems.length = 0;
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await openSample("dns-lookup");
  const fit = `(st => st.scrollHeight - st.clientHeight)(document.querySelector("#stage"))`;
  const rects = `(a => [a.querySelector(".visual"), a.querySelector(".quiz")].map(e => e.getBoundingClientRect()))(document.querySelector(".step.active"))`;
  const px = `(s => (r => Math.min(r.width / s.viewBox.baseVal.width, r.height / s.viewBox.baseVal.height))(s.getBoundingClientRect()) * 14)(document.querySelector(".step.active .visual svg"))`;
  for (const n of [2, 4, 5]) {
    await goTo(n);
    assert.ok(await js(`document.querySelector(".step.active").classList.contains("wide")`), `step ${n}`);
    const [v, q] = await js(`${rects}.map(r => ({ left: r.left, right: r.right, top: r.top }))`);
    assert.ok(q.left >= v.right && Math.abs(q.top - v.top) < 2, `step ${n}: the quiz is beside the diagram`);
    assert.ok(await js(fit) <= 0.15 * 800, `step ${n}: ${await js(fit)}px taller than the screen`);
    assert.ok(await js(px) >= 10, `step ${n}: label text renders at ${(await js(px)).toFixed(1)}px`);
  }
  // a step with no quiz keeps the diagram on its own
  await goTo(3);
  assert.ok(!(await js(`!!document.querySelector(".step.active .beside")`)));
  // too narrow for both side by side: the quiz goes under the diagram
  await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
  await goTo(4);
  const [v, q] = await js(`${rects}.map(r => ({ bottom: r.bottom, top: r.top }))`);
  assert.ok(q.top >= v.bottom, "the quiz wraps under the diagram");
  await send("Emulation.clearDeviceMetricsOverride");
  assert.deepEqual(problems, []);
});

test("depth: a step skipped in the short version is not marked visited in the full one, nor counted by the index", { skip }, async () => {
  problems.length = 0;
  const page = await openSample("filter-chain");
  const done = () => js(`[...document.querySelectorAll("#outline button")].map((b, i) => b.classList.contains("done") ? i : -1).filter(i => i >= 0)`);
  // short: step 1 → (background step 2 skipped) → step 3 → step 4
  await js(`document.querySelector('.top [data-act="depth"]').click()`);
  await js(`document.querySelector("#next").click()`); await js(`document.querySelector("#next").click()`);
  // back to full: steps 1 and 3 are visited, the background step is not
  await js(`document.querySelector('.top [data-act="depth"]').click()`);
  assert.deepEqual(await done(), [0, 2]);
  // the same after a reload
  await open(page);
  assert.deepEqual(await done(), [0, 2]);
  // a step visited only in full stays marked when going short and back
  await goTo(2); await goTo(4);
  assert.deepEqual(await done(), [0, 1, 2]);
  await js(`document.querySelector('.top [data-act="depth"]').click()`);
  await js(`document.querySelector('.top [data-act="depth"]').click()`);
  assert.deepEqual(await done(), [0, 1, 2]);
  // progress saved by an older engine (a high-water mark) still reads as the steps up to it
  await js(`localStorage.setItem(Object.keys(localStorage).find(k => k.startsWith("explain-progress:")), JSON.stringify({ cur: 2, maxSeen: 2, results: {}, choices: {} }))`);
  await open(page);
  assert.deepEqual(await done(), [0, 1]);
  await js(`localStorage.removeItem("explain-depth")`);
  assert.deepEqual(problems, []);
});

test("index page: counts the steps a page saved as visited, old and new format", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "explain-index-"));
  writeFileSync(join(dir, "filter-chain.html"), build(readFileSync(join(SKILL, "examples/filter-chain.content.js"), "utf8")).html);
  const { writeIndex } = await import("../skills/explain-interactive/build.mjs");
  const index = writeIndex(dir), page = join(dir, "filter-chain.html");
  await open(page); await js("localStorage.clear()"); await open(page);
  const prog = async () => { await open(index); return js(`document.querySelector("#list .prog").textContent`); };
  // short: steps 1, 3, 4 visited, the background step 2 skipped
  await js(`document.querySelector('.top [data-act="depth"]').click()`);
  await js(`document.querySelector("#next").click()`); await js(`document.querySelector("#next").click()`);
  assert.equal(await prog(), "read 3 of 6");
  // reaching the Recap in the short version reads to the end
  await open(page); await goTo(6);
  assert.equal(await prog(), "✓ read to the end");
  // an older page's high-water mark
  await js(`localStorage.setItem(Object.keys(localStorage).find(k => k.startsWith("explain-progress:")), JSON.stringify({ cur: 1, maxSeen: 1 }))`);
  assert.equal(await prog(), "read 2 of 6");
  await js("localStorage.clear()");
  rmSync(dir, { recursive: true, force: true });
});

test("depth: no switch on a page with nothing to skip", { skip }, async () => {
  const page = join(tmp, "flat.html");
  writeFileSync(page, build(`const META = { title: "Flat", bigPicture: "B" };
const STEPS = [{ title: "One", summary: "s", body: "<p>x</p>", context: { question: "q", example: "e" } }, { title: "Recap", body: "<p>y</p>" }];`).html);
  await open(page); await js(`localStorage.setItem("explain-depth", "short")`); await open(page);
  assert.ok(await js(`[...document.querySelectorAll('[data-act="depth"]')].every(b => b.hidden) && !document.querySelector(".depth-note")`));
  assert.ok(await js(`!document.body.classList.contains("short")`));
  await js(`localStorage.clear()`);
});

test("diagram parts with a CAST/GLOSSARY entry show it on click or Enter", { skip }, async () => {
  problems.length = 0;
  await openSample("token-401");
  await js(`document.querySelector("#next").click()`);
  const part = id => `document.querySelector('#step-2 [data-id=${id}]')`;
  // by label (Gateway is in CAST), by term (the req edge stands for "token"); Client names nothing
  assert.deepEqual(await js(`[...document.querySelectorAll("#step-2 [data-def]")].map(g => g.dataset.id + "=" + g.dataset.def)`), ["gw=Gateway", "svc=orders-svc", "req=token", "deny=401"]);
  assert.ok(await js(`${part("gw")}.getAttribute("role") === "button" && ${part("gw")}.tabIndex === 0 && !${part("client")}.hasAttribute("tabindex")`));
  assert.equal(await js(`document.querySelector("#step-2 .visual svg").getAttribute("role")`), "group");
  assert.match(await js(`document.querySelector("#step-2 .legend").textContent`), /Click a part to see what it is/);
  await js(`${part("gw")}.dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
  assert.ok(await js(`document.querySelector("#tip").classList.contains("on")`));
  assert.equal(await js(`document.querySelector("#tip b").textContent`), "Gateway");
  assert.match(await js(`document.querySelector("#tip").textContent`), /^Gateway The front door/);
  assert.equal(await js(`${part("gw")}.getAttribute("aria-describedby")`), "tip");
  // the tip sits next to the part's box (a sequence node's group also holds its lifeline, which runs much lower)
  assert.ok(await js(`(r => { const t = document.querySelector("#tip").getBoundingClientRect(); return Math.abs(t.top - r.bottom) < 12 || Math.abs(t.bottom - r.top) < 12; })(${part("gw")}.querySelector(".box").getBoundingClientRect())`));
  // a click elsewhere closes it
  await js(`document.querySelector("#step-2 h2").click()`);
  assert.ok(await js(`!document.querySelector("#tip").classList.contains("on")`));
  // keyboard: focus + Enter; Esc closes; ←/→ still change step
  await js(`${part("deny")}.focus(); ${part("deny")}.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  assert.match(await js(`document.querySelector("#tip").textContent`), /^401 The HTTP status/);
  await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  assert.ok(await js(`!document.querySelector("#tip").classList.contains("on") && document.activeElement !== ${part("deny")}`));
  // moving on closes it as well
  await js(`${part("svc")}.dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
  await js(`document.querySelector("#next").click()`);
  assert.ok(await js(`!document.querySelector("#tip").classList.contains("on")`));
  assert.deepEqual(problems, []);
});

test("index page: lists pages, filters them, shows reading progress", { skip }, async () => {
  problems.length = 0; requests.length = 0;
  const dir = mkdtempSync(join(tmpdir(), "explain-index-"));
  for (const f of ["token-401", "cron-twice"]) writeFileSync(join(dir, f + ".html"), build(readFileSync(join(SKILL, `examples/${f}.content.js`), "utf8")).html);
  const { writeIndex } = await import("../skills/explain-interactive/build.mjs");
  const index = writeIndex(dir);
  // read two steps of one page, then open the index
  await open(join(dir, "token-401.html")); await js("localStorage.clear()"); await open(join(dir, "token-401.html"));
  await js(`document.querySelector("#next").click()`);
  await open(index);
  assert.deepEqual(await js(`[...document.querySelectorAll("#list li a")].map(a => a.textContent).sort()`), ["Why an expired token gets a 401", "Why the nightly report was sent twice"]);
  assert.equal(await js(`[...document.querySelectorAll("#list li")].find(l => l.textContent.includes("401")).querySelector(".prog").textContent`), "read 2 of 6");
  await js(`(q => (q.value = "nightly", q.dispatchEvent(new Event("input"))))(document.querySelector("#q"))`);
  assert.deepEqual(await js(`[...document.querySelectorAll("#list li")].filter(l => !l.hidden).map(l => l.querySelector("a").getAttribute("href"))`), ["cron-twice.html"]);
  await js(`(q => (q.value = "zzz", q.dispatchEvent(new Event("input"))))(document.querySelector("#q"))`);
  assert.ok(await js(`!document.querySelector("#none").hidden`));
  // links open the page
  await js(`document.querySelector('#list a[href="cron-twice.html"]').click()`); await sleep(300);
  assert.equal(await js(`document.title`), "Why the nightly report was sent twice");
  assert.deepEqual(problems, []);
  assert.deepEqual(external(), []);
  await js("localStorage.clear()");
  rmSync(dir, { recursive: true, force: true });
});

test("Show all reveals a step left halfway through its stages; a page with no big picture still renders", { skip }, async () => {
  const page = join(tmp, "stages.html");
  const code = readFileSync(join(SKILL, "examples/token-401.content.js"), "utf8").replace(/bigPicture: "[^"]*",/, "");
  writeFileSync(page, build(code).html);
  await open(page); await js("localStorage.clear()"); await open(page);
  assert.equal(await js(`document.querySelectorAll(".step").length`), 6);
  const staged = await js(`[...document.querySelectorAll(".step")].findIndex(a => a.querySelector("[data-b]"))`);
  assert.ok(staged > 0, "the sample has a step with build stages");
  await js(`location.hash = "#step-${staged + 1}"`); await sleep(100);
  assert.ok(await js(`document.querySelectorAll("#step-${staged + 1} .pend").length > 0`));
  await js(`document.querySelector("#prev").click()`); await sleep(50);
  await js(`document.querySelector('[data-act="all"]').click()`); await sleep(50);
  assert.equal(await js(`document.querySelectorAll(".pend").length`), 0);
});

test("a <dfn> that wraps over a line break finds its entry, as build.mjs --check expects", { skip }, async () => {
  const page = join(tmp, "wrapped.html");
  writeFileSync(page, build(`const META = { title: "Wrapped", bigPicture: "B" };
const GLOSSARY = { "rate limit": "how many calls a client may make", "CI&CD": "both" };
const STEPS = [{ title: "One", summary: "s", body: \`<p>A <dfn>rate
  limit</dfn> and <dfn>CI&amp;CD</dfn>.</p>\` }, { title: "Recap", body: "<p>y</p>" }];`).html);
  problems.length = 0;
  await open(page);
  assert.equal(await js(`[...document.querySelectorAll("#step-1 dfn")].filter(d => d.tabIndex === 0).length`), 2);
  assert.deepEqual(problems.filter(p => /glossary/i.test(p)), []);
});
