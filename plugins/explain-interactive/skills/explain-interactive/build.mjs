#!/usr/bin/env node
// Builds an explainer page: inlines a content file into the engine and writes one self-contained offline HTML file.
// Node 22+, no dependencies.
//
//   node build.mjs <topic>.content.js [-o <topic>.html]     build (default output: next to the content file)
//   node build.mjs --check <topic>.content.js               check only: list errors and warnings, write nothing
//   node build.mjs --extract <page>.html [-o <topic>.content.js]
//                                                           recover the content file from a built page,
//                                                           or from a page made with the old template.html
//   node build.mjs --index [<dir>]                          rewrite <dir>/index.html (default ~/explanations), a list of its pages
//
// A build also rewrites index.html in the folder it wrote the page to; --no-index skips that.
//
// The content file is a plain script that declares META, STEPS and optionally CAST, GLOSSARY, DIAGRAM,
// and DECISION, HYPOTHESES or LAYERS for the page types that need them (see examples/ and SKILL.md). A DIAGRAM spec object is laid out here (engine/layout.mjs) into an SVG;
// an <svg> string is used as written. The build checks it first; problems are listed and nothing is written.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { homedir } from "node:os";
import { render as renderDiagram } from "./engine/layout.mjs";
import { PALETTES, paletteCss } from "./engine/palettes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = join(HERE, "engine");

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// A literal "</script" inside an inline script would end it early; "<\/script" means the same in JS strings and comments.
// A literal "<!--" (followed later by "<script") puts the parser in its double-escaped state, where "</script>" no
// longer ends the element and the next script is swallowed; "<!\x2D-" means the same in strings, templates and regexes.
const inlineScript = s => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<!\\x2D-");
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

// Every step field the engine reads; references/content-file.md, "Fields of a step", documents each one
export const STEP_KEYS = ["title", "summary", "context", "body", "diagram", "visual", "build", "analogy", "code", "deeper",
  "quiz", "whatif", "matrix", "diff", "phase", "verdicts", "evidence", "layer", "panel", "depth", "wide"];

export function check(c) {
  const errors = [], warnings = [];
  const { META, STEPS } = c, CAST = c.CAST || {}, GLOSSARY = c.GLOSSARY || {};
  const spec = c.DIAGRAM && typeof c.DIAGRAM === "object" ? c.DIAGRAM : null;
  let DIAGRAM = typeof c.DIAGRAM === "string" ? c.DIAGRAM : "";
  if (!META || typeof META !== "object") errors.push("META is missing (const META = { title, bigPicture })");
  else {
    if (!META.title) errors.push("META.title is missing");
    if (!META.bigPicture) warnings.push("META.bigPicture is empty");
    for (const k of ["title", "bigPicture", "before", "after"]) mustBeText(META[k], `META.${k}`, errors);
  }
  if (!Array.isArray(STEPS) || !STEPS.length) { errors.push("STEPS is missing or empty"); return { errors, warnings }; }
  for (const [name, v] of [["CAST", c.CAST], ["GLOSSARY", c.GLOSSARY]])
    if (v !== undefined && (typeof v !== "object" || v === null || Array.isArray(v))) errors.push(`${name} must be an object of "name": "one-liner"`);
    else if (v) for (const [k, t] of Object.entries(v)) mustBeText(t, `${name} "${k}"`, errors);
  if (c.DIAGRAM !== undefined && typeof c.DIAGRAM !== "string" && !spec)
    errors.push("DIAGRAM must be a spec object { layout, label, nodes, edges } or an <svg>…</svg> string");
  let ids;
  if (spec) {
    const r = renderDiagram(spec);
    errors.push(...r.errors); warnings.push(...r.warnings);
    DIAGRAM = r.svg || "";
    ids = new Set([...(Array.isArray(spec.nodes) ? spec.nodes : []), ...(Array.isArray(spec.edges) ? spec.edges : [])]
      .filter(x => x && typeof x === "object").map(x => x.id ?? `${x.from}-${x.to}`));
  } else ids = new Set([...DIAGRAM.matchAll(/data-id\s*=\s*["']([^"']+)["']/g)].map(m => m[1]));
  const hasTerm = hasTermIn(CAST, GLOSSARY);
  checkTerms(spec, DIAGRAM, hasTerm, warnings);
  const type = checkType(c, errors, warnings);
  if (/<[^>]+\sid\s*=/.test(DIAGRAM.replace(/data-id\s*=/g, ""))) warnings.push("DIAGRAM uses id=…; use data-id (the SVG is cloned once per step, so ids would repeat)");
  if (/<animate/i.test(DIAGRAM)) warnings.push("DIAGRAM uses SMIL <animate>; use the .flow class (reduced-motion can't stop SMIL)");
  const stripTags = s => s.replace(/<[^>]*>/g, "");

  STEPS.forEach((s, i) => {
    const at = `step ${i + 1}${s && typeof s.title === "string" && s.title ? ` ("${stripTags(s.title)}")` : ""}`;
    if (!s || typeof s !== "object") return errors.push(`step ${i + 1} is not an object`);
    if (!s.title) errors.push(`${at}: title is missing`);
    for (const k of TEXT_KEYS) mustBeText(s[k], `${at}: ${k}`, errors);
    checkContextTypes(s.context, at, errors);
    // The engine ignores a field it doesn't know, so a misspelt one would vanish from the page without a word
    Object.keys(s).filter(k => !STEP_KEYS.includes(k))
      .forEach(k => warnings.push(`${at}: unknown field "${k}" (known: ${STEP_KEYS.join(", ")})`));
    if (!s.body) warnings.push(`${at}: body is empty`);
    if (i < STEPS.length - 1 && !s.summary) warnings.push(`${at}: summary is missing (shown in the Recap list)`);
    const d = s.diagram;
    if (d && typeof d === "object") {
      if (!DIAGRAM && !spec && ["hl", "hide", "dim", "build"].some(k => d[k] && d[k].length)) errors.push(`${at}: diagram names parts but DIAGRAM is empty`);
      for (const k of ["hl", "hide", "dim", "build"]) {
        if (d[k] === undefined) continue;
        if (!Array.isArray(d[k])) { errors.push(`${at}: diagram.${k} must be an array`); continue; }
        checkParts(d[k], k, `${at}: diagram`, ids, errors);
      }
      if ((d.build || []).length > 4) warnings.push(`${at}: diagram.build has ${d.build.length} stages (keep it ≤ 4)`);
    }
    if (s.visual && s.build && !/data-b\s*=/.test(s.visual)) warnings.push(`${at}: build is set but visual has no data-b parts`);
    const maxB = Math.max(0, ...[...String(s.visual || "").matchAll(/data-b\s*=\s*["']?(\d+)/g)].map(m => +m[1]));
    if (maxB > (s.build || 0)) warnings.push(`${at}: visual stages parts up to data-b="${maxB}" but build is ${s.build || 0}; set build: ${maxB}`);
    checkWhatif(s, i, STEPS.length, at, { ids, hasDiagram: !!(DIAGRAM || spec) }, errors, warnings);
    const q = s.quiz;
    if (q) {
      if (!q.q || !Array.isArray(q.options)) errors.push(`${at}: quiz needs q and options[]`);
      else {
        if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length)
          errors.push(`${at}: quiz.answer ${q.answer} is not an index into its ${q.options.length} options`);
        mustBeText(q.q, `${at}: quiz.q`, errors); mustBeText(q.why, `${at}: quiz.why`, errors);
        if (!q.why) warnings.push(`${at}: quiz.why is missing (shown once the quiz is answered: why the answer is right)`);
        if (q.options.length < 3) warnings.push(`${at}: quiz has ${q.options.length} options; use 3–4 (the retry would give a 2-option answer away)`);
        q.options.forEach((o, j) => {
          if (typeof o !== "string" && !(o && typeof o.t === "string")) errors.push(`${at}: quiz option ${j} must be a string or { t, why }`);
          else if (typeof o === "object") mustBeText(o.why, `${at}: quiz option ${j} why`, errors);
        });
      }
    }
    if (s.depth !== undefined) {
      if (s.depth !== "full") errors.push(`${at}: depth must be "full" (a background step the short version skips) or left out`);
      else if (i === 0 || i === STEPS.length - 1) warnings.push(`${at}: depth "full" is ignored on ${i === 0 ? "the Context step" : "the Recap"}; both are always shown`);
      else {
        // The short version skips this step, yet later steps show what it (or any of its what-if options) lit as introduced
        const lit = x => (x && Array.isArray(x.hl) ? x.hl : []);
        const own = [...new Set(lit(d))], wi = [...new Set(wiOptions(s).flatMap(o => lit(o && o.diagram)))].filter(x => !own.includes(x));
        const where = [own.join(", "), wi.length && `${wi.join(", ")} in its what-if options`].filter(Boolean).join("; ");
        if (where) warnings.push(`${at}: a depth "full" step lights diagram parts (${where}); in the short version later steps show them as already introduced`);
      }
    }
    checkStepType(type, c, s, at, errors, warnings);
    for (const x of ["evidence", "diff"]) if (s[x] && typeof s[x] === "object") mustBeText(s[x].label, `${at}: ${x}.label`, errors);
    checkSize(s, i, STEPS.length, at, warnings);
    checkDfns(rendered(s), at, hasTerm, warnings);
  });

  checkTypeCoverage(type, c, warnings);
  checkStructure(STEPS, !!(DIAGRAM || spec), warnings);
  // The rest of the text rendered as HTML (META.title and bigPicture are shown as plain text)
  if (META && typeof META === "object") for (const k of ["before", "after"]) checkDfns(META[k], `META.${k}`, hasTerm, warnings);
  for (const [name, v] of [["CAST", CAST], ["GLOSSARY", GLOSSARY]])
    if (v && typeof v === "object") for (const [k, t] of Object.entries(v)) checkDfns(t, `${name} "${k}"`, hasTerm, warnings);
  for (const name of ["DECISION", "HYPOTHESES", "LAYERS"]) checkDfns(c[name], name, hasTerm, warnings);
  // A snippet about <script src> in code, diff or evidence is fine: they are shown escaped
  const all = JSON.stringify({ META, CAST, GLOSSARY, spec, DECISION: c.DECISION, HYPOTHESES: c.HYPOTHESES, LAYERS: c.LAYERS,
    STEPS: STEPS.map(rendered) }) + DIAGRAM;
  for (const [re, what] of EXTERNAL) if (re.test(all.replace(/\\"/g, '"'))) errors.push(`content loads an external resource (${what}); pages must work offline`);
  return { errors, warnings, svg: spec ? DIAGRAM : null };
}

// ---------- Types of text fields ----------
// The engine writes these into the page as text or HTML; a number or an object there renders as "42" or
// "[object Object]", or breaks the page, so anything but a string is an error. null, like leaving the field out, means none.
const TEXT_KEYS = ["title", "summary", "body", "analogy", "deeper", "visual", "code"];
const kind = v => (Array.isArray(v) ? "an array" : `a ${typeof v}`).replace(/^a ([aeiou])/, "an $1");
function mustBeText(v, where, errors) {
  if (v !== undefined && v !== null && typeof v !== "string") errors.push(`${where} must be a string (it is ${kind(v)})`);
}
function checkContextTypes(c, at, errors) {
  if (c === undefined || c === null) return;
  if (!c || typeof c !== "object" || Array.isArray(c)) return errors.push(`${at}: context must be { question, setting, why, prereqs, example }`);
  for (const k of ["question", "setting", "why", "example"]) mustBeText(c[k], `${at}: context.${k}`, errors);
  if (c.prereqs === undefined || c.prereqs === null) return;
  if (!Array.isArray(c.prereqs)) errors.push(`${at}: context.prereqs must be a list of strings`);
  else c.prereqs.forEach((x, j) => mustBeText(x, `${at}: context.prereqs item ${j}`, errors));
}

// ---------- The page's structure: Context step first, Recap last, enough steps and quizzes (SKILL.md, "Workflow" and "Rules for every page") ----------
function checkStructure(STEPS, hasDiagram, warnings) {
  const n = STEPS.length, first = STEPS[0], last = STEPS[n - 1];
  const at = (s, i) => `step ${i + 1}${s && typeof s.title === "string" && s.title ? ` ("${s.title.replace(/<[^>]*>/g, "")}")` : ""}`;
  const [lo, hi] = LIMITS.steps;
  if (n < lo || n > hi) warnings.push(`STEPS has ${n} steps; plan ${lo}–${hi}, Context and Recap included`);
  if (first && typeof first === "object" && !first.context)
    warnings.push(`${at(first, 0)}: no context card; step 1 is the Context step (context: { question, setting, why, prereqs, example })`);
  if (n > 1 && last && typeof last === "object") {
    if (typeof last.title === "string" && !/\brecap\b/i.test(last.title)) warnings.push(`${at(last, n - 1)}: the last step is the Recap; title it "Recap"`);
    if (hasDiagram && !last.diagram) warnings.push(`${at(last, n - 1)}: no diagram; set diagram: {} so the Recap shows the whole DIAGRAM`);
  }
  const quizzes = STEPS.filter(s => s && s.quiz).length;
  const [qlo, qhi] = LIMITS.quizzes, has = `the page has ${quizzes} quiz${quizzes === 1 ? "" : "zes"} (plan ${qlo}–${qhi})`;
  if (quizzes < qlo) warnings.push(`${has}: add one where a reader most likely gets confused`);
  if (quizzes > qhi) warnings.push(`${has}: keep the ones on the steps readers most likely get wrong`);
}

// ---------- What-if control: options that switch the step's outcome text and diagram state ----------
const CONTROLS = ["choice", "slider"];
function checkWhatif(s, i, n, at, { ids, hasDiagram }, errors, warnings) {
  const w = s.whatif;
  if (w === undefined) return;
  if (!w || typeof w !== "object" || !Array.isArray(w.options)) return errors.push(`${at}: whatif needs label and options[] ({ id, label, outcome, diagram? })`);
  if (!w.label) errors.push(`${at}: whatif.label is missing (it reads "What if <label>")`);
  mustBeText(w.label, `${at}: whatif.label`, errors);
  if (w.control !== undefined && !CONTROLS.includes(w.control)) errors.push(`${at}: whatif.control "${w.control}" is not one of ${CONTROLS.join(", ")}`);
  if (w.options.length < 2) errors.push(`${at}: whatif has ${w.options.length} option(s); a what-if switches between at least 2`);
  if (w.options.length > LIMITS.whatifOptions) warnings.push(`${at}: whatif has ${w.options.length} options (2–${LIMITS.whatifOptions}): keep the cases that change the outcome`);
  if (i === n - 1 && n > 1) warnings.push(`${at}: the Recap shows the whole picture; put the what-if on the step it is about`);
  if (((s.diagram || {}).build || []).length || s.build) errors.push(`${at}: a step can't have both build stages and a what-if control`);
  if (s.visual && w.options.some(o => o && o.diagram)) warnings.push(`${at}: whatif options set diagram, but the step shows its own visual, so they change nothing`);
  const seen = new Set();
  w.options.forEach((o, j) => {
    const name = `whatif option ${o && o.id ? `"${o.id}"` : j}`;
    if (!o || typeof o !== "object") return errors.push(`${at}: whatif option ${j} is not an object`);
    if (!o.id) errors.push(`${at}: whatif option ${j} needs an id`);
    else if (seen.has(o.id)) errors.push(`${at}: whatif repeats the option id "${o.id}"`);
    seen.add(o.id);
    if (!o.label) errors.push(`${at}: ${name} needs a label`);
    for (const k of ["label", "outcome"]) mustBeText(o[k], `${at}: ${name} ${k}`, errors);
    if (!o.outcome) errors.push(`${at}: ${name} needs an outcome (what happens in that case)`);
    else if (sentences(o.outcome) > LIMITS.outcomeSentences) warnings.push(`${at}: ${name} outcome has ${sentences(o.outcome)} sentences (≤ ${LIMITS.outcomeSentences})`);
    const d = o.diagram;
    if (d === undefined) return;
    if (!d || typeof d !== "object") return errors.push(`${at}: ${name} diagram must be { hl, hide, dim }`);
    if (!hasDiagram) errors.push(`${at}: ${name} has a diagram but DIAGRAM is empty`);
    if (d.build !== undefined) errors.push(`${at}: ${name} diagram can't have build stages`);
    for (const k of ["hl", "hide", "dim"]) {
      if (d[k] === undefined) continue;
      if (!Array.isArray(d[k])) { errors.push(`${at}: ${name} diagram.${k} must be an array`); continue; }
      checkParts(d[k], k, `${at}: ${name} diagram`, ids, errors);
    }
    const hl = [...new Set(d.hl || [])];
    if (hl.length > LIMITS.hlParts) warnings.push(`${at}: ${name} lights ${hl.length} parts (${hl.join(", ")}); light 1–${LIMITS.hlParts}`);
    if (hl.length && o.outcome && !/<mark\b/.test(o.outcome) && !/<mark\b/.test(s.body || ""))
      warnings.push(`${at}: ${name} lights ${hl.join(", ")} but neither its outcome nor the body has a <mark>`);
  });
}
// Same lookup as the page's tooltips: the name, then its singular, case-insensitive
function hasTermIn(CAST, GLOSSARY) {
  const known = new Set([...Object.keys(CAST), ...Object.keys(GLOSSARY)].map(k => k.toLowerCase()));
  return k => known.has(k) || known.has(k.replace(/(es|s)$/, "")) || known.has(k.replace(/s$/, ""));
}
// A step's fields as the page renders them: code, diff and evidence.text are shown escaped, so their markup is just text
const rendered = s => ({ ...s, code: undefined, diff: undefined, evidence: s.evidence && { ...s.evidence, text: undefined } });
const wiOptions = s => (s.whatif && Array.isArray(s.whatif.options) ? s.whatif.options : []);
// A term as the browser reads it: tags dropped, entities decoded, white space collapsed (the page's lookup does the same)
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
  const n = /x/i.test(e[1]) ? parseInt(e.slice(2), 16) : +e.slice(1);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
});
// Every <dfn> in every string of value needs a CAST or GLOSSARY entry, or its tooltip stays empty
function checkDfns(value, where, hasTerm, warnings) {
  if (typeof value === "string") {
    for (const [, attrs, inner] of value.matchAll(/<dfn\b([^>]*)>([\s\S]*?)<\/dfn>/gi)) {
      const a = attrs.match(/\sdata-term\s*=\s*(?:"([^"]*)"|'([^']*)')/);
      const term = decode(a ? a[1] ?? a[2] : inner.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
      if (!hasTerm(term.toLowerCase())) warnings.push(`${where}: <dfn>${term}</dfn> has no CAST or GLOSSARY entry`);
    }
  } else if (value && typeof value === "object") Object.values(value).forEach(v => checkDfns(v, where, hasTerm, warnings));
}
// hl, hide and dim list data-ids; a build stage is a data-id or a list of them (parts revealed together).
// The engine skips anything else without a word, so a nested list would leave its parts unlit.
function checkParts(list, k, where, ids, errors) {
  list.forEach((x, j) => {
    const part = k === "build" && Array.isArray(x) ? x : [x];
    if (part.some(y => typeof y !== "string")) return errors.push(k === "build" ? `${where}.build stage ${j} must be a data-id or a list of data-ids`
      : Array.isArray(x) ? `${where}.${k} item ${j} is a list; ${k} takes data-id strings (only build stages can be lists)`
      : `${where}.${k} item ${j} must be a data-id string`);
    part.forEach(id => { if (!ids.has(id)) errors.push(`${where}.${k} names "${id}", which is not a data-id in DIAGRAM`); });
  });
}
// A diagram part with a term opens that CAST/GLOSSARY entry on click; one that names nothing would stay inert
function checkTerms(spec, svg, hasTerm, warnings) {
  const named = spec ? [...(Array.isArray(spec.nodes) ? spec.nodes : []), ...(Array.isArray(spec.edges) ? spec.edges : [])]
      .filter(x => x && typeof x === "object" && x.term).map(x => [x.id ?? `${x.from}-${x.to}`, String(x.term)])
    : [...svg.matchAll(/<[^>]*\sdata-term\s*=[^>]*>/g)].map(([tag]) => {
        const attr = n => (tag.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`)) || [])[1];
        return [attr("data-id") || "?", attr("data-term") || ""];
      });
  for (const [id, term] of named)
    if (!hasTerm(term.trim().toLowerCase())) warnings.push(`DIAGRAM part "${id}": term "${term}" has no CAST or GLOSSARY entry`);
}

// ---------- Size and focus: each step fits one screen and is about one thing ----------
// The limits SKILL.md gives; over them is a warning, since a page can still be built.
export const LIMITS = { titleWords: 6, summaryWords: 8, bodySentences: 5, bodyWords: 120, hlParts: 3,
  codeLines: 15, codeWidth: 60, prereqs: 3, contextSentences: 2, quizOptions: 4, whatifOptions: 4, outcomeSentences: 2,
  steps: [5, 10], quizzes: [2, 3] };
const text = s => String(s).replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const words = s => (text(s).match(/\S+/g) || []).length;
// A sentence ends at . ! ? (or …) followed by the end or by a space and a capital, digit or quote; "e.g. this" stays one sentence
const sentences = s => { const t = text(s); return t ? (t.match(/[.!?…]+["')\]]*(?=\s+["'(\[`]?[A-Z0-9]|\s*$)/g) || [t]).length : 0; };
function checkSize(s, i, n, at, warnings) {
  const L = LIMITS, recap = i === n - 1 && n > 1;
  const w = msg => warnings.push(`${at}: ${msg}`);
  if (s.title && words(s.title) > L.titleWords) w(`title has ${words(s.title)} words (≤ ${L.titleWords}): name the one idea`);
  if (s.summary && words(s.summary) > L.summaryWords) w(`summary has ${words(s.summary)} words (≤ ${L.summaryWords})`);
  if (s.body) {
    const k = sentences(s.body), m = words(s.body);
    if (k > L.bodySentences) w(`body has ${k} sentences (≤ ${L.bodySentences}): move detail to deeper, or split the step`);
    else if (m > L.bodyWords) w(`body has ${m} words (≤ ~${L.bodyWords}): shorten it, or move detail to deeper`);
  }
  const hl = [...new Set(((s.diagram || {}).hl || []).flat())];
  if (hl.length > L.hlParts) w(`diagram lights ${hl.length} parts (${hl.join(", ")}); light 1–${L.hlParts}, or split the step`);
  if (hl.length && !recap && s.body && !/<mark\b/.test(s.body)) w(`diagram lights ${hl.join(", ")} but body has no <mark>: wrap the lit part's name in <mark> so text and picture match`);
  // width only for code: evidence is real output, quoted as it was
  const block = (label, src, width = true) => {
    if (typeof src !== "string") return;
    const ls = src.replace(/\n+$/, "").split("\n"), wide = ls.filter(l => [...l].length > L.codeWidth).length;
    if (ls.length > L.codeLines) w(`${label} has ${ls.length} lines (≤ ${L.codeLines}): keep only the lines that matter`);
    if (width && wide) w(`${label} has ${wide} line${wide > 1 ? "s" : ""} over ${L.codeWidth} characters (they wrap in the narrow column)`);
  };
  block("code", s.code);
  if (s.evidence) block("evidence.text", s.evidence.text, false);
  if (s.diff && !recap) for (const side of ["before", "after"]) {
    const k = typeof s.diff[side] === "string" ? s.diff[side].replace(/\n+$/, "").split("\n").length : 0;
    if (k > L.codeLines) w(`diff.${side} has ${k} lines (≤ ${L.codeLines}): show only the part this step changes`);
  }
  if (s.quiz && Array.isArray(s.quiz.options) && s.quiz.options.length > L.quizOptions) w(`quiz has ${s.quiz.options.length} options (3–${L.quizOptions})`);
  const c = s.context;
  if (c && typeof c === "object") {
    if (i > 0) w("context is only for step 1");
    if (Array.isArray(c.prereqs) && c.prereqs.length > L.prereqs) w(`context.prereqs has ${c.prereqs.length} items (≤ ${L.prereqs})`);
    for (const k of ["question", "setting", "why", "example"])
      if (c[k] && sentences(c[k]) > L.contextSentences) w(`context.${k} has ${sentences(c[k])} sentences (1–${L.contextSentences})`);
  }
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
    for (const k of ["name", "text", "summary"]) mustBeText(x[k], `${name} "${x.id}" ${k}`, errors);
  });
  return ids;
}
function checkType(c, errors, warnings) {
  const type = (c.META && c.META.type) || "walkthrough";
  if (!TYPES.includes(type)) { errors.push(`META.type "${type}" is not one of ${TYPES.join(", ")}`); return null; }
  for (const [t, name] of Object.entries(NEEDS))
    if (c[name] !== undefined && type !== t) warnings.push(`${name} is only drawn on a "${t}" page (META.type is "${type}")`);
  if (c.META && (c.META.before || c.META.after) && type !== "before-after") warnings.push(`META.before/after are only shown on a "before-after" page`);
  const need = NEEDS[type];
  if (need && c[need] === undefined) { errors.push(`a "${type}" page needs ${need} (see references/${type}.md)`); return type; }
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
// The pickers' options, in paletteCss()'s order: default first
const paletteOptions = palettes => [...palettes].sort((a, b) => (b.id === "default") - (a.id === "default"))
  .map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("");
// Run in <head> before the CSS, so a page never shows the default colours or mode first
const BOOTSTRAP = `<script>try { const s = localStorage, t = s.getItem("explain-theme"), p = s.getItem("explain-palette");
  if (t) document.documentElement.dataset.theme = t; if (p) document.documentElement.dataset.palette = p; } catch (e) {}</script>`;
export function build(code, file, { palettes = PALETTES } = {}) {
  const content = loadContent(code, file);
  const result = check(content);
  if (result.errors.length) { const { svg, ...rest } = result; return { ...rest, html: null }; }
  let shell = readFileSync(join(ENGINE_DIR, "page.html"), "utf8");
  // The palette pickers list every palette; with nothing to choose from they are left out
  if (palettes.length < 2) shell = shell.replace(/\n[ \t]*<select\b[^>]*>\{\{PALETTE_OPTIONS\}\}<\/select>/g, "");
  const parts = {
    TITLE: esc(content.META.title),
    // Read by the index page (build.mjs --index), so it needn't run the content
    META: `<meta name="description" content="${esc(content.META.bigPicture || "")}">\n` +
      `<meta name="explain-type" content="${esc(content.META.type || "walkthrough")}">\n<meta name="explain-steps" content="${content.STEPS.length}">`,
    CSS: inlineStyle(paletteCss(palettes) + "\n" + readFileSync(join(ENGINE_DIR, "engine.css"), "utf8").trimEnd()),
    CONTENT: inlineScript(code.trim()),
    ENGINE: inlineScript(readFileSync(join(ENGINE_DIR, "engine.js"), "utf8").trimEnd()),
    // A laid-out spec goes in an inert <template> the engine reads, so the content script stays exactly as written
    DIAGRAM: result.svg ? `<template id="explain-diagram">\n${result.svg}\n</template>` : "",
    PALETTE_OPTIONS: paletteOptions(palettes),
  };
  // Function replacer: content may contain "$&" and friends, which a string replacement would expand
  const html = shell.replace(/\{\{(TITLE|META|CSS|CONTENT|ENGINE|DIAGRAM|PALETTE_OPTIONS)\}\}/g, (_, k) => parts[k]);
  const { svg, ...rest } = result;
  return { ...rest, html };
}

// ---------- Extract ----------
export function extract(html) {
  // Pages built by this script
  let m = html.match(/<script id="explain-content">\n?([\s\S]*?)\n?<\/script>/);
  if (m) return m[1].replace(/<\\\/(script)/gi, "</$1").replace(/<!\\x2D-/g, "<!--") + "\n";
  // Pages filled in from the old template.html: the data sits between the FILL THIS DATA markers
  m = html.match(/\/\* =+ FILL THIS DATA =+ \*\/\n([\s\S]*?)\n\/\* =+ \*\//);
  if (m) return m[1] + "\n";
  return null;
}

// ---------- Index ----------
// index.html lists every page built into a folder, newest first. It reads each page's <meta> tags; a page built
// before they existed is read through its content script. The reader's progress comes from the same localStorage
// key the page writes, so it shows wherever the browser shares storage between file:// pages (Chrome does).
const INDEX_GENERATOR = "explain-interactive-index";
const metaOf = (html, name) => { const m = html.match(new RegExp(`<meta name="${name}" content="([^"]*)">`)); return m && m[1]; };
const unesc = s => s.replace(/&(lt|gt|quot|amp);/g, (_, k) => ({ lt: "<", gt: ">", quot: '"', amp: "&" }[k]));
export function readPage(html) {
  if (metaOf(html, "generator") !== "explain-interactive") return null;
  const title = unesc((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
  let bigPicture = metaOf(html, "description"), type = metaOf(html, "explain-type"), steps = +metaOf(html, "explain-steps") || 0;
  if (bigPicture === null) {
    try {
      const c = loadContent(extract(html) || "");
      bigPicture = (c.META && c.META.bigPicture) || ""; type = (c.META && c.META.type) || "walkthrough";
      steps = Array.isArray(c.STEPS) ? c.STEPS.length : 0;
    } catch { bigPicture = ""; }
  } else bigPicture = unesc(bigPicture);
  return { title, bigPicture, type: type || "walkthrough", steps };
}
export function indexHtml(pages, { palettes = PALETTES } = {}) {
  const item = p => `<li data-title="${esc(p.title)}" data-steps="${p.steps}" data-text="${esc((p.title + " " + p.bigPicture).toLowerCase())}">
  <a href="${esc(encodeURIComponent(p.file))}">${esc(p.title || p.file)}</a>
  <p>${esc(p.bigPicture)}</p>
  <div class="meta"><span class="type">${esc(p.type)}</span><span>${p.steps} steps</span><span>${p.date}</span><span class="prog"></span></div>
</li>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${INDEX_GENERATOR}">
<title>Explanations</title>
${BOOTSTRAP}
<style>
${paletteCss(palettes)}
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 var(--font); }
main { max-width: 760px; margin: 0 auto; padding: 32px 20px 48px; }
h1 { margin: 0 0 4px; font-size: 1.5rem; } .sub { margin: 0 0 20px; color: var(--muted); }
input { width: 100%; box-sizing: border-box; font: inherit; color: inherit; padding: 9px 12px; border: var(--border) solid var(--line); border-radius: calc(10px * var(--radius)); background: var(--card); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
ul { list-style: none; margin: 16px 0 0; padding: 0; display: grid; gap: 10px; }
li { padding: 14px 16px; border: var(--border) solid var(--line); border-radius: calc(12px * var(--radius)); background: var(--card); }
li a { font-weight: 600; color: var(--accent); text-decoration: none; } li a:hover { text-decoration: underline; }
li p { margin: 4px 0 8px; color: var(--muted); font-size: .92rem; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: .8rem; color: var(--muted); }
.type { text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
.prog.done { color: var(--ok); font-weight: 600; }
.empty { color: var(--muted); }
</style>
</head>
<body>
<main>
<h1>Explanations</h1>
<p class="sub">${pages.length} page${pages.length === 1 ? "" : "s"}, newest first. Rebuilt each time a page is built.</p>
${pages.length ? `<input type="search" id="q" placeholder="Filter by title or big picture" aria-label="Filter pages">
<ul id="list">
${pages.map(item).join("\n")}
</ul>
<p class="empty" id="none" hidden>No page matches.</p>` : `<p class="empty">No pages yet. Build one with <code>node build.mjs &lt;topic&gt;.content.js</code>.</p>`}
</main>
<script>
// Progress as each page saved it (visited steps); the key is the page's path plus its title.
// A page saves the step indexes it showed (seen); one built by an older engine saved a high-water mark (maxSeen).
// Reaching the Recap counts as read to the end, since the Short version never shows its background steps.
document.querySelectorAll("#list li").forEach(li => {
  try {
    const path = new URL(li.querySelector("a").getAttribute("href"), location.href).pathname;
    const p = JSON.parse(localStorage.getItem("explain-progress:" + path + ":" + li.dataset.title));
    if (!p) return;
    const n = +li.dataset.steps, el = li.querySelector(".prog");
    const seen = Array.isArray(p.seen) ? p.seen : [...Array((p.maxSeen || 0) + 1).keys()];
    const end = seen.includes(n - 1);
    el.textContent = end ? "✓ read to the end" : "read " + seen.length + " of " + n;
    el.classList.toggle("done", end);
  } catch (e) {}
});
const q = document.getElementById("q");
if (q) q.addEventListener("input", () => {
  const t = q.value.trim().toLowerCase(); let shown = 0;
  document.querySelectorAll("#list li").forEach(li => { li.hidden = !!t && !li.dataset.text.includes(t); shown += !li.hidden; });
  document.getElementById("none").hidden = shown > 0;
});
</script>
</body>
</html>
`;
}
// Rewrites <dir>/index.html from the pages in it; returns its path
export function writeIndex(dir) {
  const pages = readdirSync(dir).filter(f => /\.html?$/i.test(f) && f !== "index.html").flatMap(file => {
    const path = join(dir, file);
    let html; try { html = readFileSync(path, "utf8"); } catch { return []; }
    const p = readPage(html); if (!p) return [];
    const mtime = statSync(path).mtime;
    return [{ ...p, file, mtime, date: mtime.toISOString().slice(0, 10) }];
  }).sort((a, b) => b.mtime - a.mtime || a.title.localeCompare(b.title));
  const dest = join(dir, "index.html");
  // A folder's own index.html (a docs site, a page built as index.html) is not ours to replace
  if (existsSync(dest) && metaOf(readFileSync(dest, "utf8"), "generator") !== INDEX_GENERATOR) return null;
  writeFileSync(dest, indexHtml(pages));
  return dest;
}

// ---------- CLI ----------
function main(argv) {
  const args = [...argv];
  const take = flag => { const i = args.indexOf(flag); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const out = take("-o") ?? take("--out");
  const extractFrom = take("--extract");
  const noIndex = args.includes("--no-index") && (args.splice(args.indexOf("--no-index"), 1), true);
  if (args[0] === "--index") {
    const dir = args[1] ?? join(homedir(), "explanations");
    try { const ix = writeIndex(dir); if (!ix) { console.error(`${join(dir, "index.html")} is not an explainer index; left alone`); return 1; } console.log(`index ${resolve(ix)}`); return 0; }
    catch (e) { console.error(`${dir}: ${e.message}`); return 1; }
  }
  const checkOnly = args.includes("--check") && (args.splice(args.indexOf("--check"), 1), true);
  if (args.includes("-h") || args.includes("--help") || (!extractFrom && args.length !== 1)) {
    console.log("usage: node build.mjs <topic>.content.js [-o <topic>.html] [--no-index]\n       node build.mjs --check <topic>.content.js\n       node build.mjs --extract <page>.html [-o <topic>.content.js]\n       node build.mjs --index [<dir>]");
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
  res.errors.forEach(e => console.error(`error: ${e}`));
  res.warnings.forEach(w => console.warn(`warning: ${w}`));
  const count = (n, what) => `${n} ${what}${n === 1 ? "" : "s"}`;
  if (res.errors.length) { console.error(`${src}: ${checkOnly ? "check failed" : "not built"} (${count(res.errors.length, "error")}, ${count(res.warnings.length, "warning")})`); return 1; }
  if (checkOnly) { console.log(`${src}: ${res.warnings.length ? count(res.warnings.length, "warning") : "ok"}`); return 0; }
  const dest = out ?? src.replace(/(\.content)?\.m?js$/i, "") + ".html";
  writeFileSync(dest, res.html);
  console.log(`built ${resolve(dest)}`);
  if (!noIndex) {
    try { const ix = writeIndex(dirname(resolve(dest))); console.log(ix ? `index ${resolve(ix)}` : `index.html in that folder is not an explainer index; left alone`); }
    catch (e) { console.warn(`warning: index not updated (${e.message})`); }
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
