#!/usr/bin/env node
// Builds an explainer page: inlines a content file into the engine and writes one self-contained offline HTML file.
// Node 22+, no dependencies.
//
//   node build.mjs <topic>.content.js [-o <topic>.html]     build (default output: next to the content file)
//   node build.mjs --extract <page>.html [-o <topic>.content.js]
//                                                           recover the content file from a built page,
//                                                           or from a page made with the old template.html
//
// The content file is a plain script that declares META, STEPS and optionally CAST, GLOSSARY, DIAGRAM,
// and DECISION, HYPOTHESES or LAYERS for the page types that need them (see examples/ and SKILL.md). The build checks it first; problems are listed and nothing is written.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = join(HERE, "engine");

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// A literal "</script" inside an inline script would end it early; "<\/script" means the same in JS strings and comments.
const inlineScript = s => s.replace(/<\/(script)/gi, "<\\/$1");
const inlineStyle = s => s.replace(/<\/(style)/gi, "<\\/$1");

// ---------- Load and check the content ----------
const NAMES = ["META", "STEPS", "CAST", "GLOSSARY", "DIAGRAM", "DECISION", "HYPOTHESES", "LAYERS"];
export function loadContent(code, file = "content.js") {
  const ctx = vm.createContext({});
  const expose = `\n;({ ${NAMES.map(n => `${n}: typeof ${n} === "undefined" ? undefined : ${n}`).join(", ")} })`;
  return vm.runInContext(code + expose, ctx, { filename: file, timeout: 2000 });
}

// Things a page may not load: it has to work offline.
const EXTERNAL = [
  [/<script\b[^>]*\bsrc\s*=/i, "<script src=…>"],
  [/<link\b[^>]*\bhref\s*=/i, "<link href=…>"],
  [/<(img|iframe|video|audio|source|embed|object)\b[^>]*\b(src|data|srcset)\s*=\s*["']?(https?:)?\/\//i, "remote media"],
  [/@import\b/i, "@import"],
  [/url\(\s*["']?(https?:)?\/\//i, "remote url(…)"],
  [/<(image|use)\b[^>]*\bhref\s*=\s*["']?(https?:)?\/\//i, "remote SVG href"],
];

export function check(c) {
  const errors = [], warnings = [];
  const { META, STEPS } = c, CAST = c.CAST || {}, GLOSSARY = c.GLOSSARY || {}, DIAGRAM = c.DIAGRAM || "";
  if (!META || typeof META !== "object") errors.push("META is missing (const META = { title, bigPicture })");
  else {
    if (!META.title) errors.push("META.title is missing");
    if (!META.bigPicture) warnings.push("META.bigPicture is empty");
  }
  if (!Array.isArray(STEPS) || !STEPS.length) { errors.push("STEPS is missing or empty"); return { errors, warnings }; }
  for (const [name, v] of [["CAST", c.CAST], ["GLOSSARY", c.GLOSSARY]])
    if (v !== undefined && (typeof v !== "object" || v === null || Array.isArray(v))) errors.push(`${name} must be an object of "name": "one-liner"`);
  if (c.DIAGRAM !== undefined && typeof c.DIAGRAM !== "string") errors.push("DIAGRAM must be a string (an <svg>…</svg> template literal)");
  const type = checkType(c, errors, warnings);

  const ids = new Set([...DIAGRAM.matchAll(/data-id\s*=\s*["']([^"']+)["']/g)].map(m => m[1]));
  if (/<[^>]+\sid\s*=/.test(DIAGRAM.replace(/data-id\s*=/g, ""))) warnings.push("DIAGRAM uses id=…; use data-id (the SVG is cloned once per step, so ids would repeat)");
  if (/<animate/i.test(DIAGRAM)) warnings.push("DIAGRAM uses SMIL <animate>; use the .flow class (reduced-motion can't stop SMIL)");
  const known = new Set([...Object.keys(CAST), ...Object.keys(GLOSSARY)].map(k => k.toLowerCase()));
  const hasTerm = k => known.has(k) || known.has(k.replace(/(es|s)$/, "")) || known.has(k.replace(/s$/, ""));
  const stripTags = s => s.replace(/<[^>]*>/g, "");

  STEPS.forEach((s, i) => {
    const at = `step ${i + 1}${s && s.title ? ` ("${stripTags(s.title)}")` : ""}`;
    if (!s || typeof s !== "object") return errors.push(`step ${i + 1} is not an object`);
    if (!s.title) errors.push(`${at}: title is missing`);
    if (!s.body) warnings.push(`${at}: body is empty`);
    if (i < STEPS.length - 1 && !s.summary) warnings.push(`${at}: summary is missing (shown in the Recap list)`);
    const d = s.diagram;
    if (d && typeof d === "object") {
      if (!DIAGRAM) errors.push(`${at}: has diagram but DIAGRAM is empty`);
      for (const k of ["hl", "hide", "dim", "build"]) {
        if (d[k] === undefined) continue;
        if (!Array.isArray(d[k])) { errors.push(`${at}: diagram.${k} must be an array`); continue; }
        d[k].flat().forEach(id => { if (!ids.has(id)) errors.push(`${at}: diagram.${k} names "${id}", which is not a data-id in DIAGRAM`); });
      }
      if ((d.build || []).length > 4) warnings.push(`${at}: diagram.build has ${d.build.length} stages (keep it ≤ 4)`);
    }
    if (s.visual && s.build && !/data-b\s*=/.test(s.visual)) warnings.push(`${at}: build is set but visual has no data-b parts`);
    const q = s.quiz;
    if (q) {
      if (!q.q || !Array.isArray(q.options)) errors.push(`${at}: quiz needs q and options[]`);
      else {
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length)
          errors.push(`${at}: quiz.answer ${q.answer} is not an index into its ${q.options.length} options`);
        if (q.options.length < 3) warnings.push(`${at}: quiz has ${q.options.length} options; use 3–4 (the retry would give a 2-option answer away)`);
        q.options.forEach((o, j) => { if (typeof o !== "string" && !(o && typeof o.t === "string")) errors.push(`${at}: quiz option ${j} must be a string or { t, why }`); });
      }
    }
    if (s.code && typeof s.code !== "string") errors.push(`${at}: code must be a string`);
    checkStepType(type, c, s, at, errors, warnings);
    // Every <dfn> needs a CAST or GLOSSARY entry, or its tooltip stays empty
    const html = JSON.stringify(s);
    for (const m of html.matchAll(/<dfn([^>]*)>(.*?)<\/dfn>/g)) {
      const term = (m[1].match(/data-term=\\?["']([^"'\\]+)/) || [])[1] || stripTags(m[2]);
      if (!hasTerm(term.trim().toLowerCase())) warnings.push(`${at}: <dfn>${term}</dfn> has no CAST or GLOSSARY entry`);
    }
  });

  checkTypeCoverage(type, c, warnings);
  // `code`, `diff` and `evidence` are shown escaped, so a snippet about <script src> is fine; everything else is rendered as HTML
  const all = JSON.stringify({ META, CAST, GLOSSARY, DECISION: c.DECISION, HYPOTHESES: c.HYPOTHESES, LAYERS: c.LAYERS,
    STEPS: STEPS.map(s => ({ ...s, code: undefined, diff: undefined, evidence: s.evidence && { ...s.evidence, text: undefined } })) }) + DIAGRAM;
  for (const [re, what] of EXTERNAL) if (re.test(all.replace(/\\"/g, '"'))) errors.push(`content loads an external resource (${what}); pages must work offline`);
  return { errors, warnings };
}

// ---------- Page types (META.type) ----------
export const TYPES = ["walkthrough", "decision", "before-after", "debugging", "concept"];
const LEVELS = ["good", "fair", "poor"], VERDICTS = ["open", "ruled-out", "confirmed"];
const PHASES = ["symptom", "hypothesis", "evidence", "cause", "fix"];
const NEEDS = { decision: "DECISION", debugging: "HYPOTHESES", concept: "LAYERS" };
// Each list of { id, … } needs unique ids; returns the set of them
function idsOf(list, name, need, errors) {
  const ids = new Set();
  list.forEach((x, j) => {
    if (!x || typeof x !== "object" || !x.id) return errors.push(`${name}[${j}] needs an id`);
    if (ids.has(x.id)) errors.push(`${name} repeats the id "${x.id}"`);
    ids.add(x.id);
    if (!x[need]) errors.push(`${name} "${x.id}" needs ${need}`);
  });
  return ids;
}
function checkType(c, errors, warnings) {
  const type = (c.META && c.META.type) || "walkthrough";
  if (!TYPES.includes(type)) { errors.push(`META.type "${type}" is not one of ${TYPES.join(", ")}`); return null; }
  for (const [t, name] of Object.entries(NEEDS))
    if (c[name] !== undefined && type !== t) warnings.push(`${name} is only drawn on a "${t}" page (META.type is "${type}")`);
  if ((c.META.before || c.META.after) && type !== "before-after") warnings.push(`META.before/after are only shown on a "before-after" page`);
  const need = NEEDS[type];
  if (need && c[need] === undefined) { errors.push(`a "${type}" page needs ${need} (see SKILL.md)`); return type; }
  if (type === "decision") {
    const D = c.DECISION;
    if (typeof D !== "object" || D === null || !Array.isArray(D.options) || !Array.isArray(D.criteria)) { errors.push("DECISION needs options[] and criteria[]"); return type; }
    const o = idsOf(D.options, "DECISION.options", "name", errors), k = idsOf(D.criteria, "DECISION.criteria", "name", errors);
    if (o.size < 2) warnings.push(`DECISION has ${o.size} option(s); a decision compares at least 2`);
    if (k.has("cost")) errors.push(`DECISION.criteria may not use the id "cost"; it is the row DECISION.cost fills`);
    for (const [oid, row] of Object.entries(D.ratings || {})) {
      if (!o.has(oid)) { errors.push(`DECISION.ratings names the option "${oid}", which is not in DECISION.options`); continue; }
      for (const [kid, v] of Object.entries(row || {})) {
        if (!k.has(kid)) errors.push(`DECISION.ratings.${oid} names the criterion "${kid}", which is not in DECISION.criteria`);
        const lv = typeof v === "string" ? v : v && v.level;
        if (lv !== undefined && !LEVELS.includes(lv)) errors.push(`DECISION.ratings.${oid}.${kid}: level "${lv}" is not one of ${LEVELS.join(", ")}`);
      }
    }
    for (const oid of o) for (const kid of k) if (!((D.ratings || {})[oid] || {})[kid]) warnings.push(`DECISION.ratings has nothing for ${oid} × ${kid}`);
    for (const oid of Object.keys(D.cost || {})) if (!o.has(oid)) errors.push(`DECISION.cost names the option "${oid}", which is not in DECISION.options`);
    if (!D.recommend) warnings.push("DECISION.recommend is empty: say which option you recommend");
    else if (!o.has(D.recommend)) errors.push(`DECISION.recommend "${D.recommend}" is not in DECISION.options`);
    if (D.recommend && !D.why) warnings.push("DECISION.why is empty: say why the recommended option wins");
  }
  if (type === "debugging") {
    if (!Array.isArray(c.HYPOTHESES)) errors.push("HYPOTHESES must be an array of { id, text }");
    else idsOf(c.HYPOTHESES, "HYPOTHESES", "text", errors);
  }
  if (type === "concept") {
    if (!Array.isArray(c.LAYERS)) errors.push("LAYERS must be an array of { id, name, text }");
    else idsOf(c.LAYERS, "LAYERS", "name", errors);
  }
  return type;
}
function checkStepType(type, c, s, at, errors, warnings) {
  if (s.diff !== undefined && (typeof s.diff !== "object" || typeof s.diff.before !== "string" || typeof s.diff.after !== "string"))
    errors.push(`${at}: diff needs before and after strings`);
  if (s.matrix !== undefined) {
    if (type !== "decision") warnings.push(`${at}: matrix is only drawn on a "decision" page`);
    else if (c.DECISION && Array.isArray(c.DECISION.options)) {
      const o = new Set(c.DECISION.options.map(x => x && x.id)), k = new Set((c.DECISION.criteria || []).map(x => x && x.id));
      if (c.DECISION.cost) k.add("cost");
      for (const [f, set, what] of [["options", o, "DECISION.options"], ["criteria", k, "DECISION.criteria"]]) {
        const v = s.matrix[f];
        if (v === undefined) continue;
        if (!Array.isArray(v)) { errors.push(`${at}: matrix.${f} must be an array`); continue; }
        v.forEach(id => { if (!set.has(id)) errors.push(`${at}: matrix.${f} names "${id}", which is not in ${what}`); });
      }
    }
  }
  if (s.phase !== undefined) {
    if (type !== "debugging") warnings.push(`${at}: phase is only shown on a "debugging" page`);
    else if (!PHASES.includes(s.phase)) errors.push(`${at}: phase "${s.phase}" is not one of ${PHASES.join(", ")}`);
  }
  if (s.verdicts !== undefined) {
    if (type !== "debugging") warnings.push(`${at}: verdicts are only drawn on a "debugging" page`);
    else if (Array.isArray(c.HYPOTHESES)) {
      const h = new Set(c.HYPOTHESES.map(x => x && x.id));
      for (const [id, v] of Object.entries(s.verdicts || {})) {
        if (!h.has(id)) errors.push(`${at}: verdicts names "${id}", which is not in HYPOTHESES`);
        if (!VERDICTS.includes(v)) errors.push(`${at}: verdict "${v}" for "${id}" is not one of ${VERDICTS.join(", ")}`);
      }
    }
  }
  if (s.evidence !== undefined && (typeof s.evidence !== "object" || typeof s.evidence.text !== "string"))
    errors.push(`${at}: evidence needs a text string ({ label, text })`);
  if (s.layer !== undefined) {
    if (type !== "concept") warnings.push(`${at}: layer is only drawn on a "concept" page`);
    else if (Array.isArray(c.LAYERS) && !c.LAYERS.some(l => l && l.id === s.layer)) errors.push(`${at}: layer "${s.layer}" is not in LAYERS`);
  }
}
// Whole-page checks: each type's structure is actually used by the steps
function checkTypeCoverage(type, c, warnings) {
  const S = c.STEPS;
  if (type === "before-after" && !S.some(s => s.diff)) warnings.push(`no step has a diff; a "before-after" page shows at least one`);
  if (type === "decision" && !S.some(s => s.matrix && s.matrix.recommend)) warnings.push("no step sets matrix.recommend; the recommendation then appears only on the Recap");
  if (type === "debugging") {
    for (const p of ["symptom", "cause"]) if (!S.some(s => s.phase === p)) warnings.push(`no step has phase "${p}"`);
    const raised = new Set(S.flatMap(s => Object.keys(s.verdicts || {})));
    (Array.isArray(c.HYPOTHESES) ? c.HYPOTHESES : []).forEach(h => { if (h && !raised.has(h.id)) warnings.push(`hypothesis "${h.id}" is never raised by a step's verdicts`); });
    if (!S.some(s => Object.values(s.verdicts || {}).includes("confirmed"))) warnings.push("no step confirms a hypothesis");
  }
  if (type === "concept" && Array.isArray(c.LAYERS)) {
    const used = S.map(s => s.layer).filter(Boolean);
    c.LAYERS.forEach(l => {
      const n = used.filter(x => x === (l && l.id)).length;
      if (l && n === 0) warnings.push(`layer "${l.id}" is never added by a step`);
      if (l && n > 1) warnings.push(`layer "${l.id}" is added by ${n} steps; each step adds one new layer`);
    });
  }
}

// ---------- Build ----------
export function build(code, file) {
  const content = loadContent(code, file);
  const result = check(content);
  if (result.errors.length) return { ...result, html: null };
  const shell = readFileSync(join(ENGINE_DIR, "page.html"), "utf8");
  const parts = {
    TITLE: esc(content.META.title),
    CSS: inlineStyle(readFileSync(join(ENGINE_DIR, "engine.css"), "utf8").trimEnd()),
    CONTENT: inlineScript(code.trim()),
    ENGINE: inlineScript(readFileSync(join(ENGINE_DIR, "engine.js"), "utf8").trimEnd()),
  };
  // Function replacer: content may contain "$&" and friends, which a string replacement would expand
  const html = shell.replace(/\{\{(TITLE|CSS|CONTENT|ENGINE)\}\}/g, (_, k) => parts[k]);
  return { ...result, html };
}

// ---------- Extract ----------
export function extract(html) {
  // Pages built by this script
  let m = html.match(/<script id="explain-content">\n?([\s\S]*?)\n?<\/script>/);
  if (m) return m[1].replace(/<\\\/(script)/gi, "</$1") + "\n";
  // Pages filled in from the old template.html: the data sits between the FILL THIS DATA markers
  m = html.match(/\/\* =+ FILL THIS DATA =+ \*\/\n([\s\S]*?)\n\/\* =+ \*\//);
  if (m) return m[1] + "\n";
  return null;
}

// ---------- CLI ----------
function main(argv) {
  const args = [...argv];
  const take = flag => { const i = args.indexOf(flag); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const out = take("-o") ?? take("--out");
  const extractFrom = take("--extract");
  if (args.includes("-h") || args.includes("--help") || (!extractFrom && args.length !== 1)) {
    console.log("usage: node build.mjs <topic>.content.js [-o <topic>.html]\n       node build.mjs --extract <page>.html [-o <topic>.content.js]");
    return extractFrom || args.length === 1 ? 0 : 2;
  }
  if (extractFrom) {
    const code = extract(readFileSync(extractFrom, "utf8"));
    if (code === null) { console.error(`${extractFrom}: no explain-interactive content found`); return 1; }
    const dest = out ?? extractFrom.replace(/\.html?$/i, "") + ".content.js";
    writeFileSync(dest, code);
    console.log(`extracted ${resolve(dest)}`);
    return 0;
  }
  const src = args[0];
  let res;
  try { res = build(readFileSync(src, "utf8"), src); }
  catch (e) { console.error(`${src}: ${e.message}`); return 1; }
  res.warnings.forEach(w => console.warn(`warning: ${w}`));
  if (res.errors.length) { res.errors.forEach(e => console.error(`error: ${e}`)); console.error(`${src}: not built (${res.errors.length} error${res.errors.length > 1 ? "s" : ""})`); return 1; }
  const dest = out ?? src.replace(/(\.content)?\.m?js$/i, "") + ".html";
  writeFileSync(dest, res.html);
  console.log(`built ${resolve(dest)}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
