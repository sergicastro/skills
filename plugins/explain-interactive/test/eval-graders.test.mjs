// node --test plugins/explain-interactive/test/
// The evals' name-* graders are regexes over out/page.content.js; this runs them the way `claude plugin eval`
// does (new RegExp(pattern, flags).test(text)) against a saved good content file per case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NAMES, files } from "../evals/name-graders.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVALS = join(ROOT, "evals");
const FIXTURES = join(ROOT, "test/fixtures/evals");
const CASES = readdirSync(EVALS, { withFileTypes: true })
  .filter(d => d.isDirectory() && existsSync(join(EVALS, d.name, "prompt.md")))
  .map(d => d.name);

// Reads the few frontmatter keys a name grader uses; the pattern is a YAML single-quoted string ('' is ').
function grader(file) {
  const fm = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---/)[1];
  const field = k => fm.match(new RegExp(`^${k}: (.*)$`, "m"))?.[1];
  const raw = field("pattern");
  assert.ok(raw.startsWith("'") && raw.endsWith("'"), `${file}: pattern must be single-quoted`);
  return {
    type: field("type"),
    re: new RegExp(raw.slice(1, -1).replaceAll("''", "'"), field("flags") ?? ""),
    weight: Number(field("weight") ?? 1),
  };
}
const names = c => readdirSync(join(EVALS, c, "graders")).filter(f => f.startsWith("name-"))
  .map(f => ({ file: f, ...grader(join(EVALS, c, "graders", f)) }));

// The entry lines of the top-level CAST and GLOSSARY objects
function entryLines(text) {
  const lines = text.split("\n"), out = [];
  let inside = false;
  lines.forEach((l, i) => {
    if (/^const (CAST|GLOSSARY)\s*=\s*\{/.test(l)) inside = !/\}\s*;?\s*$/.test(l);
    else if (inside && /^\}/.test(l)) inside = false;
    else if (inside && /^\s+\S/.test(l)) out.push(i);
  });
  return out;
}

test("every case has a name list, and the name-* files match what evals/name-graders.mjs writes", () => {
  assert.deepEqual(Object.keys(NAMES).sort(), [...CASES].sort());
  for (const c of CASES) {
    const want = files(c), dir = join(EVALS, c, "graders");
    const have = readdirSync(dir).filter(f => f.startsWith("name-"));
    assert.deepEqual(have.sort(), Object.keys(want).sort(), `${c}: run node evals/name-graders.mjs`);
    for (const f of have) assert.equal(readFileSync(join(dir, f), "utf8"), want[f], `${c}/${f}: run node evals/name-graders.mjs`);
  }
});

for (const c of CASES) {
  test(`${c}: the names-covered.md judge is gone and the name graders weigh 1 together`, () => {
    const gs = names(c);
    assert.ok(!existsSync(join(EVALS, c, "graders/names-covered.md")));
    assert.ok(gs.length > 0, "no name-* graders");
    for (const g of gs) assert.equal(g.type, "regex", g.file);
    const total = gs.reduce((s, g) => s + g.weight, 0);
    assert.ok(Math.abs(total - 1) < 0.01, `weights sum to ${total}`);
  });

  test(`${c}: every name grader passes on the saved good page`, () => {
    const text = readFileSync(join(FIXTURES, `${c}.content.js`), "utf8");
    for (const g of names(c)) assert.ok(g.re.test(text), `${g.file} fails on the good page`);
  });

  test(`${c}: each name grader fails once its CAST/GLOSSARY entry is removed`, () => {
    const text = readFileSync(join(FIXTURES, `${c}.content.js`), "utf8");
    const lines = text.split("\n");
    const entries = entryLines(text);
    assert.ok(entries.length > 0, "fixture has no CAST/GLOSSARY entries");
    for (const g of names(c)) {
      const failsWithout = entries.filter(i => !g.re.test(lines.filter((_, j) => j !== i).join("\n")));
      assert.ok(failsWithout.length > 0, `${g.file}: removing no single entry makes it fail`);
    }
  });
}

const check = (c, slug) => grader(join(EVALS, c, "graders", `name-${slug}.md`)).re;
const page = (cast, body = "") => `const META = { type: "x", title: "T" };
const CAST = {
${cast}
};
const STEPS = [{ title: "One", body: \`${body}\` }];`;

test("a key may be quoted or not, carry () and differ in case; CAST or GLOSSARY both count", () => {
  const re = check("before-after", "require-user");
  const used = "<p>Each handler called <code>require_user()</code>.</p>";
  for (const key of ['"require_user"', "'require_user()'", "require_user", "`Require_User`", '"require_user()"'])
    assert.ok(re.test(page(`  ${key}: "Checks the session cookie.",`, used)), key);
  assert.ok(re.test(`const GLOSSARY = { "require_user": "Checks the cookie." };\nconst STEPS = [{ body: "${used}" }];`));
});

test("a name used on the page with no entry fails; a name never used passes", () => {
  const re = check("before-after", "require-user");
  assert.ok(!re.test(page('  "AuthMiddleware": "Runs first.",', "<p>Handlers called <code>require_user</code>.</p>")));
  assert.ok(re.test(page('  "AuthMiddleware": "Runs first.",', "<p>One middleware checks every request.</p>")));
});

test("a mention in a body or a key outside CAST/GLOSSARY doesn't count as an entry", () => {
  const re = check("decision", "jobs-table");
  const body = "<p>The <code>jobs</code> table holds one row per email.</p>";
  assert.ok(!re.test(page('  "recipe-site": "The app.",', body)));
  assert.ok(!re.test(page('  "recipe-site": "The app.",', body) + "\nconst DECISION = { ratings: { jobs: { cost: 1 } } };"));
  assert.ok(re.test(page('  "jobs table": "One row per email to send.",', body)));
});

test("a one-line CAST ends at its }, so keys in a later object don't count", () => {
  const re = check("decision", "jobs-table");
  const rest = `const DECISION = {\n  ratings: {\n    jobs: { cost: "low" },\n  },\n};\nconst STEPS = [{ body: "<p>The <code>jobs</code> table.</p>" }];`;
  assert.ok(!re.test(`const CAST = { "recipe-site": "The app." };\n${rest}`));
  assert.ok(!re.test(`const CAST = { "recipe-site": "The app." }\n${rest}`));
  assert.ok(re.test(`const CAST = { "recipe-site": "The app.", jobs: "One row per email." };\n${rest}`));
});

test("PATH is matched case-sensitively, so the word 'path' needs no entry", () => {
  const re = check("concept", "path-variable");
  assert.ok(re.test(page('  ".venv": "The folder.",', "<p>Take the short path.</p>")));
  assert.ok(!re.test(page('  ".venv": "The folder.",', "<p><code>bin/</code> goes first on <code>PATH</code>.</p>")));
  assert.ok(re.test(page('  "PATH": "The list of folders the shell searches.",', "<p>first on <code>$PATH</code></p>")));
});
