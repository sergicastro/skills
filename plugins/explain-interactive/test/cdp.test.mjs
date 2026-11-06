// The DevTools driver: finding a browser and Node, and never hanging on a stuck page. Browser tests skip without Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skip } from "./chrome.mjs";
import { chromeArgs, chromeCandidates, launch, nodeProblem, onPath } from "../skills/explain-interactive/cdp.mjs";

test("node: too old or without WebSocket is explained, 22+ passes", () => {
  assert.match(nodeProblem("20.11.1", false), /Node 20\.11\.1 is too old: .*Node 22 or newer/);
  assert.match(nodeProblem("21.7.0", true), /too old/);
  assert.match(nodeProblem("22.4.0", false), /no global WebSocket/);
  assert.equal(nodeProblem("22.0.0", true), null);
  assert.equal(nodeProblem("24.1.0", true), null);
  assert.equal(nodeProblem(), null, "the Node running the tests is supported");
});

test("chrome lookup: usual install places on each platform", () => {
  const win = chromeCandidates({ platform: "win32", env: { PROGRAMFILES: "C:\\Program Files", "PROGRAMFILES(X86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" } });
  assert.ok(win.includes("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"));
  assert.ok(win.includes("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"));
  assert.ok(win.includes("C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"));
  const mac = chromeCandidates({ platform: "darwin", home: "/Users/alice" });
  assert.ok(mac.includes("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
  assert.ok(mac.includes("/Users/alice/Applications/Chromium.app/Contents/MacOS/Chromium"));
  const linux = chromeCandidates({ platform: "linux" });
  for (const p of ["/usr/bin/google-chrome", "/snap/bin/chromium", "/usr/bin/microsoft-edge"]) assert.ok(linux.includes(p), p);
});

test("chrome lookup: falls back to PATH", () => {
  const dir = mkdtempSync(join(tmpdir(), "explain-path-"));
  try {
    mkdirSync(join(dir, "google-chrome"));   // a directory with the name is not a browser
    const a = join(dir, "a"), b = join(dir, "b");
    mkdirSync(a); mkdirSync(b);
    writeFileSync(join(b, "chromium"), "");
    writeFileSync(join(b, "msedge.exe"), "");
    assert.equal(onPath(undefined, { platform: "linux", env: { PATH: [dir, a, b].join(":") } }), join(b, "chromium"));
    assert.equal(onPath(["msedge"], { platform: "win32", env: { Path: `${a};${b}` } }), join(b, "msedge.exe"));
    assert.equal(onPath(undefined, { platform: "linux", env: { PATH: a } }), undefined);
    assert.equal(onPath(undefined, { platform: "linux", env: {} }), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("chrome args: no sandbox only as root", () => {
  const o = { profile: "/tmp/p", width: 10, height: 20 };
  assert.ok(chromeArgs({ ...o, root: true }).includes("--no-sandbox"));
  assert.ok(!chromeArgs({ ...o, root: false }).includes("--no-sandbox"));
  assert.equal(chromeArgs({ ...o, root: false }).at(-1), "about:blank");
});

test("driver: a dialog is answered and recorded, the page keeps working", { skip }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "explain-cdp-"));
  const b = await launch();
  try {
    const page = join(dir, "alert.html");
    writeFileSync(page, `<!doctype html><title>t</title><script>alert("hello"); window.ok = confirm("sure?");</script>`);
    const t = Date.now();
    await b.open(page);
    assert.equal(await b.js("window.ok"), true);
    assert.deepEqual(b.dialogs, ['alert("hello")', 'confirm("sure?")']);
    assert.ok(Date.now() - t < 10000, "did not wait on the dialog");
  } finally { b.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("driver: a call that never answers times out", { skip }, async () => {
  const b = await launch();
  try {
    await assert.rejects(b.send("Runtime.evaluate", { expression: "new Promise(() => {})", awaitPromise: true }, { timeout: 300 }),
      /DevTools call Runtime\.evaluate timed out after 0\.3s/);
    assert.equal(await b.js("1 + 1"), 2, "later calls still work");
  } finally { b.close(); }
});

test("driver: pending and later calls fail when the browser goes away", { skip }, async () => {
  const b = await launch();
  const stuck = b.send("Runtime.evaluate", { expression: "new Promise(() => {})", awaitPromise: true });
  b.close();
  await assert.rejects(stuck, /browser connection closed/);
  await assert.rejects(b.js("1"), /browser connection closed/);
});
