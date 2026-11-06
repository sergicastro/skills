// The screenshot script: one image per step, findings for problems it can measure. Skipped without Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { skip } from "./chrome.mjs";
import { MARKER, optionNames, prepareOut, shotFile, SHOT_FILE } from "../skills/explain-interactive/shots.mjs";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "../skills/explain-interactive");
const run = (...a) => spawnSync(process.execPath, [join(SKILL, "shots.mjs"), ...a], { encoding: "utf8", timeout: 120000 });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const pngSize = f => { const b = readFileSync(f); assert.ok(b.subarray(0, 4).equals(PNG), `${f} is a PNG`); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("shots: one PNG per step from a content file, plus phone shots", { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    writeFileSync(join(out, "step-99.png"), "stale");   // left over from an earlier run there: removed
    writeFileSync(join(out, MARKER), "step-99.png\n");
    let r = run(join(SKILL, "examples/token-401.content.js"), "-o", out);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(join(out, "step-99.png")));
    r = run(join(SKILL, "examples/token-401.content.js"), "-o", out, "--phone");   // its own shots don't block a re-run
    assert.equal(r.status, 0, r.stderr);
    const files = readdirSync(out).filter(f => f.endsWith(".png")).sort();
    assert.deepEqual(files.filter(f => !f.includes("phone")), ["step-01.png", "step-02.png", "step-03.png", "step-04.png", "step-05.png", "step-06.png"]);
    assert.equal(files.filter(f => f.includes("phone")).length, 6);
    assert.deepEqual(pngSize(join(out, "step-01.png")), [1280, 800]);
    assert.deepEqual(pngSize(join(out, "step-01-phone.png")), [390, 844]);
    assert.match(r.stdout, /12 screenshots in /);
    assert.doesNotMatch(r.stderr, /finding:/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("shots: reports what it measures on a built page", { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    const long = "<p>" + "A long line of body text that keeps going. ".repeat(4) + "</p>";
    const src = join(out, "bad.content.js");
    writeFileSync(src, `const META = { title: "Bad page", bigPicture: "B" };
const DIAGRAM = \`<svg viewBox="0 0 2400 100"><g data-id="a"><text x="10" y="50">tiny</text></g></svg>\`;
const STEPS = [
  { title: "Context", summary: "s", body: "<p>c</p>", diagram: {} },
  { title: "Tall", summary: "s", body: ${JSON.stringify(long)}, deeper: "<p>d</p>", diagram: { hl: ["a"] },
    code: Array.from({ length: 15 }, (_, k) => "line " + k).join("\\n"), wide: true, analogy: "x",
    quiz: { q: "Q?", options: ["a", "b", "c"], answer: 0, why: "w" } },
  { title: "Undefined term", summary: "s", body: "<p><mark>a</mark> <dfn>nope</dfn></p>" },
  { title: "Recap", body: "<p>r</p>" },
];`);
    const r = run(src, "-o", out);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readdirSync(out).filter(f => /^step-\d+\.png$/.test(f)).length, 4);
    assert.match(r.stderr, /finding: step 2 \("Tall"\): diagram text renders at [\d.]+px/);
    assert.match(r.stderr, /finding: console: No glossary entry for <dfn> nope/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("shots: a content file with errors is not rendered", { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    const src = join(out, "broken.content.js");
    writeFileSync(src, `const META = { title: "x" };`);
    const r = run(src, "-o", out);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /STEPS is missing/);
    assert.equal(readdirSync(out).filter(f => f.endsWith(".png")).length, 0);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("shots: a what-if step is shot once per option", { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    const r = run(join(SKILL, "examples/cache-read.content.js"), "-o", out);
    assert.equal(r.status, 0, r.stderr);
    const files = readdirSync(out).filter(f => f.endsWith(".png")).sort();
    assert.deepEqual(files.filter(f => /^step-0[46]/.test(f)), ["step-04-miss.png", "step-04.png", "step-06-59s.png", "step-06-61s.png", "step-06.png"]);
    assert.equal(files.length, 11);
    assert.doesNotMatch(r.stderr, /finding:/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("shot names: never collide, whatever the option ids", () => {
  // "a b" and "a_b" sanitise alike; "phone" and "x-phone" would read as phone shots
  const names = optionNames(["first", "a b", "a_b", "phone", "x-phone", "a_b_2", "ok-1"]);
  assert.deepEqual(names, [null, "a_b", "a_b_2", "phone_2", "x_phone", "a_b_2_2", "ok_1"]);
  const files = [];
  for (const size of ["desktop", "phone"]) names.forEach(o => files.push(shotFile(3, o, size)));
  assert.equal(new Set(files).size, files.length, files.join("\n"));
  assert.equal(shotFile(3, null, "desktop"), "step-04.png");
  assert.equal(shotFile(3, null, "phone"), "step-04-phone.png");
  assert.equal(shotFile(3, "miss", "phone"), "step-04-miss-phone.png");
  // every name is still matched by the clean-up of old shots
  files.forEach(f => assert.match(f, SHOT_FILE));
});

test("shots: what-if ids that sanitise alike get their own images", { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    const src = join(out, "ids.content.js");
    const o = id => `{ id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)}, outcome: "o" }`;
    writeFileSync(src, `const META = { title: "Ids", bigPicture: "B" };
const STEPS = [
  { title: "Context", summary: "s", body: "<p>c</p>" },
  { title: "Pick", summary: "s", body: "<p>p</p>", whatif: { label: "x", options: [${o("first")}, ${o("a b")}, ${o("a_b")}, ${o("phone")}] } },
  { title: "Recap", body: "<p>r</p>" },
];`);
    const r = run(src, "-o", out, "--phone");
    assert.equal(r.status, 0, r.stderr);
    const files = readdirSync(out).filter(f => f.endsWith(".png")).sort();
    assert.deepEqual(files.filter(f => f.startsWith("step-02")), ["step-02-a_b-phone.png", "step-02-a_b.png", "step-02-a_b_2-phone.png", "step-02-a_b_2.png",
      "step-02-phone.png", "step-02-phone_2-phone.png", "step-02-phone_2.png", "step-02.png"]);
    assert.match(r.stdout, /12 screenshots in /);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("output folder: only shots an earlier run wrote are removed", () => {
  const out = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    for (const f of ["step-01.png", "step-02-phone.png", "notes.png", "step.png"]) writeFileSync(join(out, f), "x");
    writeFileSync(join(out, MARKER), "step-01.png\nstep-02-phone.png\n../escape.png\n");
    assert.deepEqual(prepareOut(out), { marker: join(out, MARKER) });
    assert.deepEqual(readdirSync(out).sort(), [MARKER, "notes.png", "step.png"]);
    assert.equal(readFileSync(join(out, MARKER), "utf8"), "", "the list starts over");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("output folder: one with step images of its own is refused and left alone", () => {
  const out = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    for (const f of ["step-01.png", "step-07-phone.png"]) writeFileSync(join(out, f), "mine");
    const { error } = prepareOut(out);
    assert.match(error, /already holds step images this script didn't write \(step-01\.png, step-07-phone\.png\)/);
    assert.deepEqual(readdirSync(out).sort(), ["step-01.png", "step-07-phone.png"]);
    const r = run(join(SKILL, "examples/token-401.content.js"), "-o", out);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /already holds step images/);
    assert.equal(readFileSync(join(out, "step-01.png"), "utf8"), "mine");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("output folder: the default one is the script's own and is cleared", () => {
  const out = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    for (const f of ["step-01.png", "notes.txt"]) writeFileSync(join(out, f), "x");
    assert.ok(prepareOut(out, { ours: true }).marker);
    assert.deepEqual(readdirSync(out).sort(), [MARKER, "notes.txt"]);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("output folder: a new one is created", () => {
  const dir = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    assert.ok(prepareOut(join(dir, "a", "b")).marker);
    assert.ok(existsSync(join(dir, "a", "b", MARKER)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
