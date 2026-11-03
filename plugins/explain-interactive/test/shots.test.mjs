// The screenshot script: one image per step, findings for problems it can measure. Skipped without Chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { findChrome } from "../skills/explain-interactive/cdp.mjs";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "../skills/explain-interactive");
const skip = findChrome() ? false : "no Chrome/Chromium found (set CHROME=…)";
const run = (...a) => spawnSync(process.execPath, [join(SKILL, "shots.mjs"), ...a], { encoding: "utf8", timeout: 120000 });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const pngSize = f => { const b = readFileSync(f); assert.ok(b.subarray(0, 4).equals(PNG), `${f} is a PNG`); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("shots: one PNG per step from a content file, plus phone shots", { skip }, () => {
  const out = mkdtempSync(join(tmpdir(), "explain-shots-"));
  try {
    writeFileSync(join(out, "step-99.png"), "stale");   // left over from an earlier run: removed
    const r = run(join(SKILL, "examples/token-401.content.js"), "-o", out, "--phone");
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
