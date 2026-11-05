// node --test plugins/explain-interactive/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { build, check, extract, loadContent, readPage, writeIndex, TYPES } from "../skills/explain-interactive/build.mjs";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "../skills/explain-interactive");
const SAMPLE = join(SKILL, "examples/token-401.content.js");
const sample = readFileSync(SAMPLE, "utf8");
const tmp = mkdtempSync(join(tmpdir(), "explain-build-"));
const run = (...a) => spawnSync(process.execPath, [join(SKILL, "build.mjs"), ...a], { encoding: "utf8" });
const minimal = extra => `const META = { title: "T", bigPicture: "B" };
const DIAGRAM = \`<svg viewBox="0 0 10 10"><g data-id="a"></g></svg>\`;
const STEPS = [{ title: "One", summary: "s", body: "<p>x</p>", diagram: { hl: ["a"] } }, { title: "Recap", body: "<p>y</p>" }];
${extra || ""}`;
// The short fixtures above skip the page's structure (Context step, 4+ steps, a quiz); tests about other rules drop those warnings
const PAGE_RULES = /^STEPS has \d+ steps|: no context card|^the page has \d+ quizz?e?s?|the last step is the Recap|so the Recap shows the whole DIAGRAM/;
const own = ws => ws.filter(w => !PAGE_RULES.test(w));
// A page that follows every structure rule: Context step, 4 steps, a quiz, a Recap showing the whole DIAGRAM
const page = ({ meta = 'title: "T", bigPicture: "B"', first = "", mid = "", last = "", extra = "" } = {}) => `const META = { ${meta} };
const DIAGRAM = \`<svg viewBox="0 0 10 10"><g data-id="a"></g></svg>\`;
${extra}
const STEPS = [
  { title: "Context", summary: "s", body: "<p>c</p>", context: { question: "Why?" }, diagram: {}${first} },
  { title: "One", summary: "s", body: "<p><mark>a</mark></p>", diagram: { hl: ["a"] }${mid} },
  { title: "Two", summary: "s", body: "<p>t</p>", quiz: { q: "Q?", options: ["a", "b", "c"], answer: 0, why: "w" } },
  { title: "Recap", body: "<p>r</p>", diagram: {}${last} },
];`;

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

const specContent = (diagram, steps) => `const META = { title: "T", bigPicture: "B" };
const DIAGRAM = ${diagram};
const STEPS = ${steps || '[{ title: "One", summary: "s", body: "<p><mark>A</mark> calls B</p>", diagram: { hl: ["a", "e"] } }, { title: "Recap", body: "<p>y</p>", diagram: {} }]'};`;
const SPEC = `{ layout: "chain", label: "A calls B", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ id: "e", from: "a", to: "b", label: "GET /x" }] }`;

test("a DIAGRAM spec is laid out into a template the engine reads; the content script keeps the spec", () => {
  const { html, errors, warnings } = build(specContent(SPEC));
  assert.deepEqual(errors, []);
  assert.deepEqual(own(warnings), []);
  const tpl = html.match(/<template id="explain-diagram">([\s\S]*?)<\/template>/);
  assert.ok(tpl, "template");
  assert.match(tpl[1], /<svg viewBox="0 0 \d+ \d+" role="img" aria-label="A calls B">/);
  assert.match(tpl[1], /<g data-id="a">[\s\S]*<g data-id="e">/);
  assert.match(extract(html), /layout: "chain"/);
});

test("a raw <svg> DIAGRAM gets no template", () => {
  const { html, errors } = build(minimal());
  assert.deepEqual(errors, []);
  assert.doesNotMatch(html, /<template id="explain-diagram">/);
});

test("spec problems and step ids missing from the spec are build errors", () => {
  let { errors } = build(specContent(SPEC, '[{ title: "One", summary: "s", body: "<p>x</p>", diagram: { hl: ["ghost"] } }, { title: "R", body: "<p>y</p>" }]'));
  assert.ok(errors.some(e => /"ghost", which is not a data-id/.test(e)), errors.join("\n"));
  ({ errors } = build(specContent(`{ layout: "chain", nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "zz", label: "l" }] }`)));
  assert.ok(errors.some(e => /DIAGRAM.label is missing/.test(e)), errors.join("\n"));
  assert.ok(errors.some(e => /which is not a node id/.test(e)), errors.join("\n"));
  ({ errors } = build(specContent("42")));
  assert.ok(errors.some(e => /DIAGRAM must be a spec object/.test(e)), errors.join("\n"));
});

test("a spec label that loads a remote resource is refused", () => {
  const { errors } = build(specContent(`{ layout: "chain", label: "x", nodes: [{ id: "a", label: "<img src='https://example.com/x.png'>" }] }`, '[{ title: "R", body: "<p>y</p>" }]'));
  assert.ok(errors.some(e => /external resource/.test(e)), errors.join("\n"));
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

test("check: size and focus rules give one clear warning each", () => {
  const long = Array.from({ length: 6 }, (_, k) => `Sentence number ${k + 1} is here.`).join(" ");
  const c = loadContent(`const META = { title: "T", bigPicture: "B" };
const GLOSSARY = { token: "t" };
const DIAGRAM = \`<svg viewBox="0 0 10 10"><g data-id="a"></g><g data-id="b"></g><g data-id="c"></g><g data-id="d"></g></svg>\`;
const STEPS = [
  { title: "Context", summary: "s", body: "<p>x</p>", context: { question: "One. Two. Three.", prereqs: ["a", "b", "c", "d"] } },
  { title: "One two three four five six seven", summary: "one two three four five six seven eight nine", body: ${JSON.stringify(long)},
    diagram: { hl: ["a", "b", "c", "d"] }, code: Array.from({ length: 16 }, () => "x").join("\\n") },
  { title: "Lit", summary: "s", body: "<p>No mark here, e.g. this stays one sentence.</p>", diagram: { hl: ["a"] },
    code: "y".repeat(61), evidence: { text: "z".repeat(200) }, context: { question: "q" },
    quiz: { q: "?", options: ["a", "b", "c", "d", "e"], answer: 0, why: "w" } },
  { title: "Recap", body: "<p>r</p>", diagram: { hl: ["a", "b"] } },
];`);
  const { errors, warnings } = check(c);
  assert.deepEqual(errors, []);
  const has = (re, n = 1) => assert.equal(warnings.filter(w => re.test(w)).length, n, `${re}\n${warnings.join("\n")}`);
  has(/step 2 .*title has 7 words \(≤ 6\)/);
  has(/step 2 .*summary has 9 words \(≤ 8\)/);
  has(/step 2 .*body has 6 sentences \(≤ 5\)/);
  has(/step 2 .*diagram lights 4 parts \(a, b, c, d\); light 1–3/);
  has(/step 2 .*code has 16 lines \(≤ 15\)/);
  has(/step 3 .*diagram lights a but body has no <mark>/);
  has(/step 3 .*code has 1 line over 60 characters/);
  has(/evidence.text has .*over/, 0);      // evidence is real output: no width rule
  has(/step 3 .*body has \d+ sentences/, 0);   // "e.g. this" is not a sentence break
  has(/step 3 .*quiz has 5 options \(3–4\)/);
  has(/step 3 .*context is only for step 1/);
  has(/step 1 .*context.prereqs has 4 items \(≤ 3\)/);
  has(/step 1 .*context.question has 3 sentences/);
  has(/step 4 .*no <mark>/, 0);            // the Recap may light everything without a <mark>
});

test("CLI --check lists problems and writes nothing", () => {
  const src = join(tmp, "chk.content.js");
  writeFileSync(src, page().replace('hl: ["a"]', () => 'hl: ["a", "zz"]').replace(', context: { question: "Why?" }', ""));
  const r = run("--check", src);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /error: step 2 \("One"\): diagram.hl names "zz"/);
  assert.match(r.stderr, /warning: step 1 \("Context"\): no context card/);
  assert.match(r.stderr, /check failed \(1 error, 1 warning\)/);
  assert.ok(!existsSync(join(tmp, "chk.html")));
  writeFileSync(src, page());
  const ok = run("--check", src);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /chk\.content\.js: ok/);
  assert.ok(!existsSync(join(tmp, "chk.html")));
});

test("check reports broken what-if controls", () => {
  const steps = (whatif, more = "") => check(loadContent(`const META = { title: "T", bigPicture: "B" };
const DIAGRAM = \`<svg viewBox="0 0 10 10"><g data-id="a"></g><g data-id="b"></g></svg>\`;
const STEPS = [{ title: "One", summary: "s", body: "<p><mark>a</mark></p>", diagram: { hl: ["a"] }, whatif: ${whatif} ${more} },
  { title: "Recap", body: "<p>y</p>" }];`));
  const opt = (id, extra = "") => `{ id: "${id}", label: "${id}", outcome: "<p>it is ${id}.</p>" ${extra} }`;
  const ok = steps(`{ label: "x", options: [${opt("p", `, diagram: { hl: ["a"] }`)}, ${opt("q", `, diagram: { hl: ["b"], dim: ["a"] }`)}] }`);
  assert.deepEqual(ok.errors, []); assert.deepEqual(own(ok.warnings), []);
  const e = (...a) => steps(...a).errors.join("\n");
  assert.match(e(`{ options: [] }`), /whatif\.label is missing/);
  assert.match(e(`{ options: [] }`), /whatif has 0 option\(s\); a what-if switches between at least 2/);
  assert.match(e(`[]`), /whatif needs label and options\[\]/);
  assert.match(e(`{ label: "x", control: "dial", options: [${opt("p")}, ${opt("q")}] }`), /whatif\.control "dial" is not one of choice, slider/);
  assert.match(e(`{ label: "x", options: [${opt("p")}, ${opt("p")}] }`), /whatif repeats the option id "p"/);
  assert.match(e(`{ label: "x", options: [${opt("p")}, { id: "q", label: "q" }] }`), /whatif option "q" needs an outcome/);
  assert.match(e(`{ label: "x", options: [${opt("p")}, ${opt("q", `, diagram: { hl: ["zz"] }`)}] }`), /whatif option "q" diagram\.hl names "zz", which is not a data-id in DIAGRAM/);
  assert.match(e(`{ label: "x", options: [${opt("p")}, ${opt("q", `, diagram: { build: ["a"] }`)}] }`), /whatif option "q" diagram can't have build stages/);
  assert.match(e(`{ label: "x", options: [${opt("p")}, ${opt("q")}] }`, `, diagram: { hl: ["a"], build: ["a"] }`), /can't have both build stages and a what-if control/);
  const w = (...a) => steps(...a).warnings.join("\n");
  assert.match(w(`{ label: "x", options: [${["p", "q", "r", "s", "t"].map(x => opt(x)).join(",")}] }`), /whatif has 5 options \(2–4\)/);
  assert.match(w(`{ label: "x", options: [${opt("p")}, { id: "q", label: "q", outcome: "<p>One. Two. Three.</p>" }] }`), /whatif option "q" outcome has 3 sentences \(≤ 2\)/);
  assert.match(w(`{ label: "x", options: [${opt("p")}, ${opt("q", `, diagram: { hl: ["b"] }`)}] }`, `, visual: "<svg></svg>"`), /whatif options set diagram, but the step shows its own visual/);
});

// ---------- Depth, diagram terms, index ----------
const steps3 = mid => `const META = { title: "T", bigPicture: "B" };
const GLOSSARY = { token: "a signed string" };
const DIAGRAM = { layout: "chain", label: "l", nodes: [{ id: "a", label: "A", term: "token" }, { id: "b", label: "B", term: "nope" }], edges: [{ from: "a", to: "b", label: "x" }] };
const STEPS = [{ title: "Ctx", summary: "s", body: "<p>c</p>", diagram: {} }, ${mid}, { title: "Recap", body: "<p>r</p>", diagram: {} }];`;

test("a step field the engine doesn't know is a warning, so a typo doesn't vanish", () => {
  const { errors, warnings } = check(loadContent(minimal().replace('summary: "s"', 'summary: "s", quizz: {}')));
  assert.deepEqual(errors, []);
  const unknown = warnings.filter(w => /unknown field/.test(w));
  assert.equal(unknown.length, 1);
  assert.match(unknown[0], /step 1 \("One"\): unknown field "quizz"/);
});

test("depth: only \"full\" is allowed, and only where it can be skipped", () => {
  let { errors, warnings } = check(loadContent(steps3(`{ title: "Bg", summary: "s", body: "<p>b</p>", depth: "full" }`)));
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some(w => /depth/.test(w)), warnings.join("\n"));
  ({ errors } = check(loadContent(steps3(`{ title: "Bg", summary: "s", body: "<p>b</p>", depth: "short" }`))));
  assert.ok(errors.some(e => /step 2 \("Bg"\): depth must be "full"/.test(e)), errors.join("\n"));
  ({ warnings } = check(loadContent(steps3(`{ title: "Bg", summary: "s", body: "<p><mark>A</mark></p>", depth: "full", diagram: { hl: ["a"] } }`))));
  assert.ok(warnings.some(w => /depth "full" step lights diagram parts/.test(w)), warnings.join("\n"));
  ({ warnings } = check(loadContent(steps3(`{ title: "M", summary: "s", body: "<p>m</p>" }`).replace('body: "<p>c</p>"', 'body: "<p>c</p>", depth: "full"'))));
  assert.ok(warnings.some(w => /step 1 .*ignored on the Context step/.test(w)), warnings.join("\n"));
});

test("diagram terms: the layout writes data-term, and a term with no entry is a warning", () => {
  const { html, warnings } = build(steps3(`{ title: "M", summary: "s", body: "<p>m</p>" }`));
  assert.match(html, /<g data-id="a" data-term="token">/);
  assert.ok(warnings.some(w => w === `DIAGRAM part "b": term "nope" has no CAST or GLOSSARY entry`), warnings.join("\n"));
  assert.ok(!warnings.some(w => /part "a"/.test(w)));
  // a hand-written SVG is checked the same way, whatever the attribute order
  const raw = minimal().replace('<g data-id="a"></g>', '<g data-term="ghost" data-id="a"></g><g data-id="b" data-term="T"></g>')
    .replace('const STEPS', 'const CAST = { T: "t" };\nconst STEPS');
  const r = check(loadContent(raw));
  assert.ok(r.warnings.some(w => w === `DIAGRAM part "a": term "ghost" has no CAST or GLOSSARY entry`), r.warnings.join("\n"));
  assert.ok(!r.warnings.some(w => /part "b"/.test(w)));
});

test("a built page carries the meta tags the index reads", () => {
  const { html } = build(readFileSync(join(SKILL, "examples/session-store.content.js"), "utf8"));
  assert.deepEqual(readPage(html), { title: "Where to keep login sessions", bigPicture: loadContent(readFileSync(join(SKILL, "examples/session-store.content.js"), "utf8")).META.bigPicture, type: "decision", steps: 6 });
  assert.equal(readPage("<!doctype html><title>x</title>"), null, "not an explainer page");
  // a page built before the meta tags existed is read through its content
  const old = html.replace(/<meta name="(description|explain-type|explain-steps)"[^>]*>\n/g, "");
  assert.equal(readPage(old).type, "decision");
  assert.equal(readPage(old).steps, 6);
});

test("index: lists the folder's pages newest first, and the CLI keeps it up to date", () => {
  const dir = join(tmp, "explanations"); mkdirSync(dir);
  const put = (name, file) => { const src = join(dir, name + ".content.js"); writeFileSync(src, readFileSync(join(SKILL, "examples", file), "utf8")); return src; };
  const a = put("token", "token-401.content.js"), b = put("cron", "cron-twice.content.js");
  writeFileSync(join(dir, "notes.html"), "<!doctype html><title>Not a page</title>");
  let r = run(a); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^index .*index\.html$/m);
  r = run(b, "--no-index"); assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /^index /m);
  assert.doesNotMatch(readFileSync(join(dir, "index.html"), "utf8"), /nightly report/, "--no-index left the index alone");
  utimesSync(join(dir, "token.html"), new Date(2020, 0, 1), new Date(2020, 0, 1));
  r = run("--index", dir); assert.equal(r.status, 0, r.stderr);
  const idx = readFileSync(join(dir, "index.html"), "utf8");
  const titles = [...idx.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(titles, [["cron.html", "Why the nightly report was sent twice"], ["token.html", "Why an expired token gets a 401"]]);
  assert.match(idx, /2 pages, newest first/);
  assert.match(idx, /<span class="type">debugging<\/span><span>8 steps<\/span><span>\d{4}-\d\d-\d\d<\/span>/);
  assert.doesNotMatch(idx, /Not a page/);
  assert.doesNotMatch(idx, /<script[^>]+src=|<link[^>]+href=|https?:\/\//i, "self-contained");
  // re-indexing doesn't list the index itself
  writeIndex(dir);
  assert.equal([...readFileSync(join(dir, "index.html"), "utf8").matchAll(/<li /g)].length, 2);
  // an empty folder gets a page that says so
  const empty = join(tmp, "empty"); mkdirSync(empty);
  assert.match(readFileSync(writeIndex(empty), "utf8"), /No pages yet/);
});

test("check: no META lists every problem instead of crashing", () => {
  const { errors } = check(loadContent(`const STEPS = [{ title: "One", summary: "s", body: "<p>x</p>" }, { title: "Recap", body: "<p>y</p>" }];`));
  assert.deepEqual(errors, ["META is missing (const META = { title, bigPicture })"]);
});

test("check: diagram: {} needs no DIAGRAM, naming a part does", () => {
  const code = `const META = { type: "decision", title: "T", bigPicture: "B" };
const DECISION = { options: [{ id: "a", name: "A" }, { id: "b", name: "B" }], criteria: [{ id: "c", name: "C" }, { id: "d", name: "D" }],
  ratings: { a: { c: "good", d: "good" }, b: { c: "poor", d: "poor" } }, recommend: "a", why: "w" };
const STEPS = [{ title: "One", summary: "s", body: "<p>x</p>", diagram: {}, matrix: {} }, { title: "Recap", body: "<p>y</p>", diagram: X }];`;
  assert.deepEqual(check(loadContent(code.replace("X", "{}"))).errors, []);
  assert.match(check(loadContent(code.replace("X", '{ hl: ["a"] }'))).errors.join("\n"), /diagram names parts but DIAGRAM is empty/);
});

test("check: a quiz without why, and data-b stages beyond build, are warnings", () => {
  const code = minimal().replace('summary: "s"', `summary: "s", quiz: { q: "Q?", options: ["a", "b", "c"], answer: 0 }`)
    .replace('{ title: "Recap"', `{ title: "Two", summary: "s", body: "<p>z</p>", visual: '<svg viewBox="0 0 600 100"><g data-b="1"></g><g data-b="2"></g></svg>', build: 1 }, { title: "Recap"`);
  const w = check(loadContent(code)).warnings.join("\n");
  assert.match(w, /step 1 \("One"\): quiz\.why is missing/);
  assert.match(w, /step 2 \("Two"\): visual stages parts up to data-b="2" but build is 1; set build: 2/);
});

test("index: never replaces a page built as index.html, nor an index.html the build didn't write", () => {
  const dir = join(tmp, "own-index"); mkdirSync(dir);
  const src = join(dir, "t.content.js"); writeFileSync(src, sample);
  let r = run(src, "-o", join(dir, "index.html"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, "index.html"), "utf8"), /<title>Why an expired token gets a 401<\/title>/);
  assert.match(r.stdout, /not an explainer index; left alone/);
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>My docs</title>");
  r = run("--index", dir);
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(dir, "index.html"), "utf8"), "<!doctype html><title>My docs</title>");
});

// ---------- <dfn> coverage, nested diagram lists, depth with what-if ----------
test("dfn check: every field rendered as HTML is covered, with the field named", () => {
  const code = `const META = { type: "before-after", title: "T", bigPicture: "B", before: "<dfn>m1</dfn>", after: "<p><dfn>m2</dfn></p>" };
const GLOSSARY = { known: "k", "CI&CD": "both", "a<b": "less" };
const CAST = { Alice: "uses <dfn>c1</dfn>" };
const STEPS = [
  { title: "One", summary: "s", body: "<p><dfn>known</dfn> <dfn>CI&amp;CD</dfn> <dfn data-term='a&lt;b'>it</dfn></p>",
    context: { question: "<dfn>x1</dfn>?", prereqs: ["<dfn>x2</dfn>: r"] }, deeper: "<dfn>x3</dfn>",
    quiz: { q: "<dfn>x4</dfn>?", options: ["a", { t: "b", why: "<dfn>x5</dfn>" }, "c"], answer: 0, why: "<dfn>x6</dfn>" },
    code: "<dfn>escaped</dfn>", diff: { before: "<dfn>escaped</dfn>", after: "b" }, evidence: { label: "<dfn>x7</dfn>", text: "<dfn>escaped</dfn>" } },
  { title: "Recap", body: "<p>r</p>" },
];`;
  const w = check(loadContent(code)).warnings.filter(x => /<dfn>/.test(x));
  const has = re => assert.ok(w.some(x => re.test(x)), `${re}\n${w.join("\n")}`);
  has(/^META\.before: <dfn>m1<\/dfn> has no CAST or GLOSSARY entry/);
  has(/^META\.after: <dfn>m2<\/dfn>/);
  has(/^CAST "Alice": <dfn>c1<\/dfn>/);
  for (const k of ["x1", "x2", "x3", "x4", "x5", "x6", "x7"]) has(new RegExp(`^step 1 \\("One"\\): <dfn>${k}</dfn>`));
  assert.ok(!w.some(x => /known|CI&|a<b|escaped/.test(x)), w.join("\n"));
  assert.equal(w.length, 10, w.join("\n"));
});

test("dfn check: DECISION, HYPOTHESES and LAYERS text, and what-if options", () => {
  const page = (type, extra, step = "") => check(loadContent(`const META = { type: "${type}", title: "T", bigPicture: "B" };
${extra}
const STEPS = [{ title: "One", summary: "s", body: "<p>x</p>"${step} }, { title: "Recap", body: "<p>y</p>" }];`)).warnings.filter(x => /<dfn>/.test(x)).join("\n");
  const d = page("decision", `const DECISION = { options: [{ id: "a", name: "<dfn>d1</dfn>", summary: "<dfn>d2</dfn>" }, { id: "b", name: "B" }],
  criteria: [{ id: "c", name: "<dfn>d3</dfn>" }], ratings: { a: { c: { level: "good", note: "<dfn>d4</dfn>" } }, b: { c: "poor" } },
  cost: { a: "<dfn>d5</dfn>" }, recommend: "a", why: "<dfn>d6</dfn>" };`);
  for (const k of ["d1", "d2", "d3", "d4", "d5", "d6"]) assert.match(d, new RegExp(`^DECISION: <dfn>${k}</dfn>`, "m"));
  assert.match(page("debugging", `const HYPOTHESES = [{ id: "h", text: "<dfn>h1</dfn>" }];`), /^HYPOTHESES: <dfn>h1<\/dfn>/m);
  assert.match(page("concept", `const LAYERS = [{ id: "l", name: "<dfn>l1</dfn>", text: "<dfn>l2</dfn>" }];`), /^LAYERS: <dfn>l1<\/dfn>[\s\S]*^LAYERS: <dfn>l2<\/dfn>/m);
  const wi = page("walkthrough", "", `, whatif: { label: "<dfn>w1</dfn>", options: [{ id: "p", label: "<dfn>w2</dfn>", outcome: "<dfn>w3</dfn>" }, { id: "q", label: "q", outcome: "o" }] }`);
  for (const k of ["w1", "w2", "w3"]) assert.match(wi, new RegExp(`^step 1 \\("One"\\): <dfn>${k}</dfn>`, "m"));
});

test("dfn check: a term spread over lines, and numeric entities, are read as the browser would", () => {
  const code = minimal(`const GLOSSARY = { "rate limit": "r", "café": "c" };`).replace('"<p>x</p>"', '"<p><dfn>rate\\n limit</dfn> <dfn>caf&#233;</dfn> <dfn>caf&#xE9;</dfn> <dfn>gone</dfn></p>"');
  const w = check(loadContent(code)).warnings.filter(x => /<dfn>/.test(x));
  assert.deepEqual(w, ['step 1 ("One"): <dfn>gone</dfn> has no CAST or GLOSSARY entry']);
});

test("check: hl, hide and dim take ids, not nested lists; build stages may be lists", () => {
  const e = d => check(loadContent(minimal().replace('diagram: { hl: ["a"] }', `diagram: ${d}`))).errors.join("\n");
  assert.match(e(`{ hl: [["a"]] }`), /step 1 \("One"\): diagram\.hl item 0 is a list; hl takes data-id strings \(only build stages can be lists\)/);
  assert.match(e(`{ hide: ["a", ["a"]] }`), /diagram\.hide item 1 is a list/);
  assert.match(e(`{ dim: [3] }`), /diagram\.dim item 0 must be a data-id string/);
  assert.equal(e(`{ build: [["a"], "a"] }`), "");
  assert.match(e(`{ build: [[["a"]]] }`), /diagram\.build stage 0 must be a data-id or a list of data-ids/);
  const wi = check(loadContent(minimal().replace('diagram: { hl: ["a"] }', `diagram: {}, whatif: { label: "x", options: [{ id: "p", label: "p", outcome: "o" }, { id: "q", label: "q", outcome: "<mark>o</mark>", diagram: { hl: [["a"]] } }] }`))).errors.join("\n");
  assert.match(wi, /whatif option "q" diagram\.hl item 0 is a list/);
});

test("depth: a full step whose what-if options light parts is a warning too", () => {
  const opts = hl => `whatif: { label: "x", options: [{ id: "p", label: "p", outcome: "o" }, { id: "q", label: "q", outcome: "<mark>A</mark>", diagram: { hl: ${hl} } }] }`;
  let { warnings } = check(loadContent(steps3(`{ title: "Bg", summary: "s", body: "<p>b</p>", depth: "full", diagram: {}, ${opts('["a"]')} }`)));
  assert.ok(warnings.some(w => /step 2 \("Bg"\): a depth "full" step lights diagram parts \(a in its what-if options\)/.test(w)), warnings.join("\n"));
  ({ warnings } = check(loadContent(steps3(`{ title: "Bg", summary: "s", body: "<p>b</p>", depth: "full", diagram: {}, ${opts("[]")} }`))));
  assert.ok(!warnings.some(w => /depth/.test(w)), warnings.join("\n"));
});

// ---------- Types of text fields, and the page's structure (#44) ----------

test("check: a page that follows the structure rules has no errors or warnings", () => {
  assert.deepEqual(check(loadContent(page())), { errors: [], warnings: [], svg: null });
});

test("check: a text field that isn't a string is an error, and check doesn't crash on it", () => {
  const e = opts => check(loadContent(page(opts))).errors.join("\n");
  assert.match(e({ meta: 'title: "T", bigPicture: 42' }), /^META\.bigPicture must be a string \(it is a number\)$/m);
  assert.match(e({ meta: 'title: ["T"], bigPicture: "B"' }), /^META\.title must be a string \(it is an array\)$/m);
  assert.match(e({ meta: 'title: "T", bigPicture: "B", type: "before-after", before: 1, after: "a"' }), /^META\.before must be a string/m);
  assert.match(e({ mid: ", title: 7" }), /^step 2: title must be a string \(it is a number\)$/m);
  for (const k of ["summary", "body", "analogy", "deeper", "visual", "code"])
    assert.match(e({ mid: `, ${k}: { x: 1 }` }), new RegExp(`^step 2 \\("One"\\): ${k} must be a string \\(it is an object\\)$`, "m"), k);
  assert.equal(e({ mid: ", deeper: null, code: null, analogy: null" }), "");   // null means "none", as in the examples
  assert.match(e({ first: ', context: { question: 1, prereqs: ["a", 2] }' }), /step 1 \("Context"\): context\.question must be a string[\s\S]*context\.prereqs item 1 must be a string/);
  assert.match(e({ first: ', context: { question: "q", prereqs: "a" }' }), /context\.prereqs must be a list of strings/);
  assert.match(e({ mid: ', quiz: { q: 3, options: ["a", { t: "b", why: 2 }, "c"], answer: 0, why: false }' }),
    /quiz\.q must be a string[\s\S]*quiz\.why must be a string \(it is a boolean\)[\s\S]*quiz option 1 why must be a string/);
  assert.match(e({ mid: ', diagram: {}, whatif: { label: 5, options: [{ id: "p", label: 1, outcome: 2 }, { id: "q", label: "q", outcome: "o" }] }' }),
    /whatif\.label must be a string[\s\S]*whatif option "p" label must be a string[\s\S]*whatif option "p" outcome must be a string/);
  assert.match(e({ mid: ', evidence: { label: 1, text: "t" }' }), /evidence\.label must be a string/);
  assert.match(e({ extra: 'const CAST = { Alice: 1 }; const GLOSSARY = { term: ["x"] };' }), /^CAST "Alice" must be a string \(it is a number\)$[\s\S]*^GLOSSARY "term" must be a string \(it is an array\)$/m);
  assert.match(check(loadContent(page({ meta: 'type: "concept", title: "T", bigPicture: "B"', extra: 'const LAYERS = [{ id: "l", name: 2, text: "t" }];', mid: ', layer: "l"' }))).errors.join("\n"), /LAYERS "l" name must be a string/);
});

test("check: the structure rules SKILL.md gives are warnings", () => {
  const w = (code, re, n = 1) => {
    const ws = check(loadContent(code)).warnings;
    assert.equal(ws.filter(x => re.test(x)).length, n, `${re}\n${ws.join("\n")}`);
  };
  // step 1 is the Context step
  w(page().replace(', context: { question: "Why?" }', ""), /^step 1 \("Context"\): no context card; step 1 is the Context step/);
  // the last step is the Recap, and shows the whole DIAGRAM
  w(page().replace('title: "Recap"', 'title: "Done"'), /^step 4 \("Done"\): the last step is the Recap; title it "Recap"/);
  w(page().replace('body: "<p>r</p>", diagram: {}', 'body: "<p>r</p>"'), /^step 4 \("Recap"\): no diagram; set diagram: \{\} so the Recap shows the whole DIAGRAM/);
  w(page().replace('body: "<p>r</p>", diagram: {}', 'body: "<p>r</p>", visual: "<svg></svg>"'), /Recap shows the whole DIAGRAM/);   // a visual is for pages without a DIAGRAM
  w(page().replace(/const DIAGRAM.*\n/, "").replace(/diagram: \{[^}]*\}/g, "").replace("<mark>a</mark>", "a"), /Recap/, 0);
  // step count, Context and Recap included
  const steps = n => page().replace(/\{ title: "Two".*\n/, Array.from({ length: n - 3 }, (_, k) => `{ title: "S${k}", summary: "s", body: "<p>s</p>", quiz: { q: "Q?", options: ["a", "b", "c"], answer: 0, why: "w" } },\n`).join(""));
  w(steps(3), /^STEPS has 3 steps; plan 4–10, Context and Recap included$/);
  w(steps(4), /^STEPS has/, 0);
  w(steps(10), /^STEPS has/, 0);
  w(steps(11), /^STEPS has 11 steps; plan 4–10/);
  // quizzes
  w(page().replace(/, quiz: \{[^}]*\}/, ""), /^the page has 0 quizzes \(at least 1\): add one where a reader most likely gets confused$/);
});
