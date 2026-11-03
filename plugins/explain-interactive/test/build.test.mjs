// node --test plugins/explain-interactive/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { build, check, extract, loadContent } from "../skills/explain-interactive/build.mjs";

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
