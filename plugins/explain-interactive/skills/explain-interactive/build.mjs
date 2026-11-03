#!/usr/bin/env node
// Builds an explainer page: inlines a content file into the engine and writes one self-contained offline HTML file.
// Node 22+, no dependencies.
//
//   node build.mjs <topic>.content.js [-o <topic>.html]     build (default output: next to the content file)
//   node build.mjs --extract <page>.html [-o <topic>.content.js]
//                                                           recover the content file from a built page,
//                                                           or from a page made with the old template.html
//
// The content file is a plain script that declares META, STEPS and optionally CAST, GLOSSARY, DIAGRAM
// (see examples/ and SKILL.md). A DIAGRAM spec object is laid out here (engine/layout.mjs) into an SVG; an <svg> string is used as written. The build checks it first; problems are listed and nothing is written.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { render as renderDiagram } from "./engine/layout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = join(HERE, "engine");

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// A literal "</script" inside an inline script would end it early; "<\/script" means the same in JS strings and comments.
const inlineScript = s => s.replace(/<\/(script)/gi, "<\\/$1");
const inlineStyle = s => s.replace(/<\/(style)/gi, "<\\/$1");

// ---------- Load and check the content ----------
export function loadContent(code, file = "content.js") {
  const ctx = vm.createContext({});
  const expose = `\n;({ META: typeof META === "undefined" ? undefined : META, STEPS: typeof STEPS === "undefined" ? undefined : STEPS,
    CAST: typeof CAST === "undefined" ? undefined : CAST, GLOSSARY: typeof GLOSSARY === "undefined" ? undefined : GLOSSARY,
    DIAGRAM: typeof DIAGRAM === "undefined" ? undefined : DIAGRAM })`;
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
  const { META, STEPS } = c, CAST = c.CAST || {}, GLOSSARY = c.GLOSSARY || {};
  const spec = c.DIAGRAM && typeof c.DIAGRAM === "object" ? c.DIAGRAM : null;
  let DIAGRAM = typeof c.DIAGRAM === "string" ? c.DIAGRAM : "";
  if (!META || typeof META !== "object") errors.push("META is missing (const META = { title, bigPicture })");
  else {
    if (!META.title) errors.push("META.title is missing");
    if (!META.bigPicture) warnings.push("META.bigPicture is empty");
  }
  if (!Array.isArray(STEPS) || !STEPS.length) { errors.push("STEPS is missing or empty"); return { errors, warnings }; }
  for (const [name, v] of [["CAST", c.CAST], ["GLOSSARY", c.GLOSSARY]])
    if (v !== undefined && (typeof v !== "object" || v === null || Array.isArray(v))) errors.push(`${name} must be an object of "name": "one-liner"`);
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
      if (!DIAGRAM && !spec) errors.push(`${at}: has diagram but DIAGRAM is empty`);
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
    // Every <dfn> needs a CAST or GLOSSARY entry, or its tooltip stays empty
    const html = JSON.stringify(s);
    for (const m of html.matchAll(/<dfn([^>]*)>(.*?)<\/dfn>/g)) {
      const term = (m[1].match(/data-term=\\?["']([^"'\\]+)/) || [])[1] || stripTags(m[2]);
      if (!hasTerm(term.trim().toLowerCase())) warnings.push(`${at}: <dfn>${term}</dfn> has no CAST or GLOSSARY entry`);
    }
  });

  // `code` is shown escaped, so a snippet about <script src> is fine; everything else is rendered as HTML
  const all = JSON.stringify({ META, CAST, GLOSSARY, spec, STEPS: STEPS.map(s => ({ ...s, code: undefined })) }) + DIAGRAM;
  for (const [re, what] of EXTERNAL) if (re.test(all.replace(/\\"/g, '"'))) errors.push(`content loads an external resource (${what}); pages must work offline`);
  return { errors, warnings, svg: spec ? DIAGRAM : null };
}

// ---------- Build ----------
export function build(code, file) {
  const content = loadContent(code, file);
  const result = check(content);
  if (result.errors.length) { const { svg, ...rest } = result; return { ...rest, html: null }; }
  const shell = readFileSync(join(ENGINE_DIR, "page.html"), "utf8");
  const parts = {
    TITLE: esc(content.META.title),
    CSS: inlineStyle(readFileSync(join(ENGINE_DIR, "engine.css"), "utf8").trimEnd()),
    CONTENT: inlineScript(code.trim()),
    ENGINE: inlineScript(readFileSync(join(ENGINE_DIR, "engine.js"), "utf8").trimEnd()),
    // A laid-out spec goes in an inert <template> the engine reads, so the content script stays exactly as written
    DIAGRAM: result.svg ? `<template id="explain-diagram">\n${result.svg}\n</template>` : "",
  };
  // Function replacer: content may contain "$&" and friends, which a string replacement would expand
  const html = shell.replace(/\{\{(TITLE|CSS|CONTENT|ENGINE|DIAGRAM)\}\}/g, (_, k) => parts[k]);
  const { svg, ...rest } = result;
  return { ...rest, html };
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
