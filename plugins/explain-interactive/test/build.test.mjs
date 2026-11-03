// node --test plugins/explain-interactive/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { build, check, extract, loadContent, TYPES } from "../skills/explain-interactive/build.mjs";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "../skills/explain-interactive");
const SAMPLE = join(SKILL, "examples/token-401.content.js");
const sample = readFileSync(SAMPLE, "utf8");
const tmp = mkdtempSync(join(tmpdir(), "explain-build-"));
const run = (...a) => spawnSync(process.execPath, [join(SKILL, "build.mjs"), ...a], { encoding: "utf8" });
const minimal = extra => `const META = { title: "T", bigPicture: "B" };
const DIAGRAM = \`<svg viewBox="0 0 10 10"><g data-id="a"></g></svg>\`;
const STEPS = [{ title: "One", summary: "s", body: "<p>x</p>", diagram: { hl: ["a"] } }, { title: "Recap", body: "<p>y</p>" }];
${extra || ""}`;

test("the sample builds into one self-contained page", () => {
  const { html, errors, warnings } = build(sample, SAMPLE);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Why an expired token gets a 401<\/title>/);
  assert.doesNotMatch(html, /\{\{(TITLE|CSS|CONTENT|ENGINE)\}\}/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|@import|url\(\s*["']?https?:/i);
  assert.equal(html.match(/<script/g).length, 3);   // theme bootstrap, content, engine
});

test("content may contain </script> and $& without breaking the page", () => {
  const code = minimal().replace('"<p>x</p>"', () => '"<p>x</p>", code: "</script> $& $1"');
  const { html, errors } = build(code);
  assert.deepEqual(errors, []);
  assert.match(html, /<\\\/script> \$& \$1/);
  assert.equal(html.match(/<\/script>/g).length, 3);
});

test("check reports broken content", () => {
  const c = loadContent(`const META = { title: "T" };
const CAST = { Gateway: "front door" };
const DIAGRAM = \`<svg><g data-id="gw"></g><rect id="x"/></svg>\`;
const STEPS = [
  { title: "A", body: "<p><dfn>Gateway</dfn> <dfn>gateways</dfn> <dfn data-term='gateway'>it</dfn> <dfn>nope</dfn></p>", diagram: { hl: ["gw", "ghost"] } },
  { title: "B", summary: "b", body: "<p>b</p>", quiz: { q: "?", options: ["a", "b"], answer: 2, why: "w" } },
  { title: "C", body: "<img src='https://example.com/x.png'>" },
];`);
  const { errors, warnings } = check(c);
  assert.ok(errors.some(e => /"ghost", which is not a data-id/.test(e)), errors.join("\n"));
  assert.ok(errors.some(e => /quiz.answer 2/.test(e)));
  assert.ok(errors.some(e => /external resource/.test(e)));
  assert.ok(warnings.some(w => /<dfn>nope<\/dfn> has no CAST/.test(w)), warnings.join("\n"));
  assert.ok(!warnings.some(w => /<dfn>(Gateway|gateways|gateway)<\/dfn>/.test(w)), warnings.join("\n"));
  assert.ok(warnings.some(w => /uses id=/.test(w)));
  assert.ok(warnings.some(w => /2 options/.test(w)));
  assert.ok(warnings.some(w => /bigPicture/.test(w)));
});

test("a code snippet about <script src> is not an external resource", () => {
  const { errors } = build(minimal().replace('"<p>x</p>"', '"<p>x</p>", code: "<script src=\\"https://cdn.example.com/a.js\\"></script>"'));
  assert.deepEqual(errors, []);
});

test("CAST, GLOSSARY and DIAGRAM are optional", () => {
  const { errors } = build(`const META = { title: "T", bigPicture: "B" };
const STEPS = [{ title: "Only", body: "<p>x</p>" }];`);
  assert.deepEqual(errors, []);
});

test("missing META/STEPS is an error and the CLI writes nothing", () => {
  const src = join(tmp, "bad.content.js");
  writeFileSync(src, "const META = { title: 'x' };");
  const r = run(src);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /STEPS is missing/);
  assert.ok(!existsSync(join(tmp, "bad.html")));
});

test("a syntax error in the content is reported with the file name", () => {
  const src = join(tmp, "syntax.content.js");
  writeFileSync(src, "const META = {");
  const r = run(src);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /syntax\.content\.js/);
});

test("CLI: default output sits next to the content file", () => {
  const src = join(tmp, "topic.content.js");
  writeFileSync(src, sample);
  const r = run(src);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(tmp, "topic.html")));
});

test("extract round-trips a built page", () => {
  const { html } = build(sample);
  assert.equal(extract(html), sample.trim() + "\n");
  const page = join(tmp, "rt.html");
  writeFileSync(page, html);
  assert.equal(run("--extract", page).status, 0);
  assert.equal(readFileSync(join(tmp, "rt.content.js"), "utf8"), sample.trim() + "\n");
});

test("extract recovers content from a page made with the old template.html", t => {
  let old;
  try { old = execFileSync("git", ["show", "7de652b:plugins/explain-interactive/skills/explain-interactive/template.html"], { cwd: SKILL, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return t.skip("old template not in git history here"); }
  const code = extract(old);
  assert.ok(code && code.startsWith("const META"));
  const { errors } = build(code);
  assert.deepEqual(errors, []);
});

test("extract returns null for unrelated HTML", () => {
  assert.equal(extract("<html><body>hi</body></html>"), null);
});

test("every sample builds without errors or warnings, one per page type", () => {
  const types = new Set();
  for (const f of readdirSync(join(SKILL, "examples")).filter(f => f.endsWith(".content.js"))) {
    const code = readFileSync(join(SKILL, "examples", f), "utf8");
    const { errors, warnings, html } = build(code, f);
    assert.deepEqual(errors, [], f);
    assert.deepEqual(warnings, [], f);
    assert.ok(html, f);
    types.add(loadContent(code).META.type || "walkthrough");
  }
  assert.deepEqual([...types].sort(), [...TYPES].sort());
});

test("check reports broken page-type content", () => {
  const typed = (type, extra, steps) => check(loadContent(`const META = { type: ${JSON.stringify(type)}, title: "T", bigPicture: "B" };
${extra}
const STEPS = ${steps || `[{ title: "A", summary: "a", body: "<p>a</p>" }, { title: "Recap", body: "<p>r</p>" }]`};`));
  const has = (r, re) => assert.ok([...r.errors, ...r.warnings].some(m => re.test(m)), [...r.errors, ...r.warnings].join("\n"));

  has(typed("slides", ""), /META.type "slides" is not one of/);
  has(typed("decision", ""), /"decision" page needs DECISION/);
  has(typed("debugging", ""), /"debugging" page needs HYPOTHESES/);
  has(typed("concept", ""), /"concept" page needs LAYERS/);

  const d = typed("decision", `const DECISION = { options: [{ id: "a", name: "A" }, { id: "a", name: "A2" }], criteria: [{ id: "k", name: "K" }],
    ratings: { a: { k: "great", z: "good" }, ghost: {} }, cost: { b: "x" }, recommend: "b" };`,
    `[{ title: "A", summary: "a", body: "<p>a</p>", matrix: { options: ["nope"], criteria: ["k"] } }, { title: "Recap", body: "<p>r</p>" }]`);
  has(d, /repeats the id "a"/);
  has(d, /level "great" is not one of/);
  has(d, /criterion "z"/);
  has(d, /option "ghost"/);
  has(d, /DECISION.cost names the option "b"/);
  has(d, /recommend "b" is not in/);
  has(d, /matrix.options names "nope"/);

  const g = typed("debugging", `const HYPOTHESES = [{ id: "h1", text: "one" }, { id: "h2", text: "two" }];`,
    `[{ title: "A", summary: "a", body: "<p>a</p>", phase: "guess", verdicts: { h1: "maybe", h9: "open" }, evidence: { label: "x" } }, { title: "Recap", body: "<p>r</p>" }]`);
  has(g, /phase "guess" is not one of/);
  has(g, /verdict "maybe"/);
  has(g, /verdicts names "h9"/);
  has(g, /evidence needs a text string/);
  has(g, /hypothesis "h2" is never raised/);
  has(g, /no step confirms/);

  const c = typed("concept", `const LAYERS = [{ id: "a", name: "A" }, { id: "b", name: "B" }];`,
    `[{ title: "A", summary: "a", body: "<p>a</p>", layer: "a" }, { title: "B", summary: "b", body: "<p>b</p>", layer: "a" }, { title: "C", summary: "c", body: "<p>c</p>", layer: "z" }, { title: "Recap", body: "<p>r</p>" }]`);
  has(c, /layer "z" is not in LAYERS/);
  has(c, /layer "b" is never added/);
  has(c, /layer "a" is added by 2 steps/);

  has(typed("before-after", ""), /no step has a diff/);
  has(typed("before-after", "", `[{ title: "A", summary: "a", body: "<p>a</p>", diff: { before: "x" } }, { title: "Recap", body: "<p>r</p>" }]`), /diff needs before and after/);
  // fields of another type are pointed out, not silently ignored
  has(typed("walkthrough", `const LAYERS = [];`, `[{ title: "A", summary: "a", body: "<p>a</p>", layer: "x", phase: "fix" }, { title: "Recap", body: "<p>r</p>" }]`), /LAYERS is only drawn on a "concept" page/);
});

test("a diff about <script src> is not an external resource", () => {
  const code = `const META = { type: "before-after", title: "T", bigPicture: "B" };
const STEPS = [{ title: "A", summary: "a", body: "<p>a</p>", diff: { before: "<script src='https://cdn.example.com/a.js'></script>", after: "" } }, { title: "Recap", body: "<p>r</p>" }];`;
  assert.deepEqual(build(code).errors, []);
});
