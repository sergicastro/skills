#!/usr/bin/env node
// Renders every step of an explainer page in headless Chrome and saves one screenshot per step, for review.
// Node 22+, no dependencies; needs Chrome, Chromium or Edge (set CHROME=/path/to/chrome to pick one).
//
//   node shots.mjs <topic>.html | <topic>.content.js [-o <dir>] [--phone] [--dark] [--palette <id>]
//
//   -o <dir>   where to write the images (default: <tmp>/explain-shots/<topic>). Old shots are removed first: in the
//              default folder every step-*.png, elsewhere only the ones an earlier run wrote there (listed in .explain-shots).
//              A folder holding other step-*.png files is refused, so an existing folder's images are never deleted.
//   --phone    also render each step at phone size (390×844): step-NN-phone.png
//   --dark     dark theme instead of light
//   --palette <id>  colour palette to shoot (an id from engine/palettes.mjs; default: the default palette)
//
// A content file is built first (into the output directory). Each step is shown as the reader sees it on arrival,
// with every build stage revealed. A step with a what-if control is also shot once per other option: step-NN-<option>.png
// (naming: see optionNames below; names never collide). Besides the images it lists what it can measure on each step:
// a middle step much taller than the screen, a diagram too wide for its box, diagram text rendered too small,
// console errors or warnings (e.g. a <dfn> with no glossary entry), a dialog the page opens (answered, so it can't
// hang the run), and any request the page makes.
// Exit code: 0 rendered (findings are printed, not fatal), 1 the page failed (or has no picker offering --palette),
// 2 bad arguments (an unknown --palette id among them), no browser, Node older than 22, or an -o folder with step
// images this script didn't write.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { build } from "./build.mjs";
import { findChrome, launch, nodeProblem } from "./cdp.mjs";
import { PALETTES } from "./engine/palettes.mjs";

export const SIZES = { desktop: { width: 1280, height: 800, mobile: false }, phone: { width: 390, height: 844, mobile: true } };
const MIN_TEXT_PX = 10;   // diagram text rendered smaller than this is hard to read
const OVER = 0.15;        // a middle step more than 15% taller than the desktop screen makes the reader scroll

// What the page looks like on step i: measured inside the page
const MEASURE = `(() => {
  const art = document.querySelector(".step.active"), stage = document.querySelector("#stage");
  const over = Math.round(stage.scrollHeight - stage.clientHeight);
  const vis = [...art.querySelectorAll(".visual")];
  const clipped = vis.filter(v => v.scrollWidth > v.clientWidth + 2).length;
  let minText = Infinity;
  art.querySelectorAll(".visual svg").forEach(svg => {
    // The drawing is scaled to fit both sides of the svg's box: a height cap can draw it smaller than the box is wide
    const vb = svg.viewBox && svg.viewBox.baseVal, r = svg.getBoundingClientRect();
    if (!vb || !vb.width || !vb.height || !r.width) return;
    const k = Math.min(r.width / vb.width, r.height / vb.height);
    svg.querySelectorAll("text").forEach(t => { const fs = parseFloat(getComputedStyle(t).fontSize); if (fs) minText = Math.min(minText, fs * k); });
  });
  return { over, clipped, minText: minText === Infinity ? null : Math.round(minText * 10) / 10, title: art.querySelector("h2").textContent };
})()`;

// File names: step-NN.png, then step-NN-<option>.png for each what-if option after the first; phone shots add -phone
// before .png. <option> is the option id with each run of characters other than letters, digits and _ turned into _,
// so it never holds a "-" and can't read as the -phone suffix. One that is "phone", or that an earlier option of the step
// already gave, gets _2 (then _3, …) until it is unique, so "a b" and "a_b" become a_b and a_b_2.
export const SHOT_FILE = /^step-\d+(-[\w-]+)?\.png$/;   // what a run removes from the output directory first
export function optionNames(ids) {
  const used = new Set(["phone"]);
  return ids.map((id, k) => {
    if (!k) return null;   // the first option is the step as the reader finds it: step-NN.png
    const base = String(id).replace(/[^A-Za-z0-9_]+/g, "_") || "_";
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}`;
    used.add(name);
    return name;
  });
}
export const shotFile = (i, option, size) => `step-${String(i + 1).padStart(2, "0")}${option ? `-${option}` : ""}${size === "phone" ? "-phone" : ""}.png`;

// The active step's what-if option ids, and how to pick one the way a reader would
const WHATIF_IDS = `[...document.querySelectorAll(".step.active .whatif .wi-out")].map(o => o.dataset.wi)`;
const pickOption = k => `(f => { const r = f.querySelector("input[type=range]");
  if (r) { r.value = ${k}; r.dispatchEvent(new Event("input", { bubbles: true })); } else f.querySelectorAll("input[type=radio]")[${k}].click(); })(document.querySelector(".step.active .whatif"))`;

export async function shoot(page, { out, phone = false, dark = false, palette = null, onShot = () => {} } = {}) {
  const b = await launch({ width: SIZES.desktop.width, height: SIZES.desktop.height });
  const shots = [], findings = [];
  const check = (m, i, n, size, dim, what) => {
    const at = `step ${i + 1} ("${m.title}")${what}${size === "phone" ? " on a phone" : ""}`;
    // The Context step and the Recap are long by design, and phones always stack and scroll: only middle steps on desktop count
    if (size === "desktop" && i > 0 && i < n - 1 && m.over > OVER * dim.height)
      findings.push(`${at}: ${m.over}px taller than the screen; the reader has to scroll (shorten body, move detail to deeper, or split the step)`);
    if (m.clipped && size === "desktop") findings.push(`${at}: the visual is wider than its box and scrolls sideways (narrow the viewBox, or set wide: true)`);
    if (m.minText !== null && m.minText < MIN_TEXT_PX && size === "desktop") findings.push(`${at}: diagram text renders at ${m.minText}px (< ${MIN_TEXT_PX}px): shrink the viewBox or the parts, or set wide: true`);
  };
  try {
    await b.send("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: "reduce" },          // no slide-in or pop: capture the settled frame
      { name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
    await b.open(page);
    await b.js(`localStorage.clear()`);   // start fresh: no saved step, quiz answers or theme
    // The palette as a reader's earlier pick would leave it: saved, then applied by the page's <head> script
    if (palette) await b.js(`localStorage.setItem("explain-palette", ${JSON.stringify(palette)})`);
    await b.open(page);
    if (palette && palette !== "default") {
      const offered = await b.js(`[...document.querySelectorAll("#palette option")].map(o => o.value)`);
      if (!offered.includes(palette) || (await b.js(`document.documentElement.dataset.palette`)) !== palette)
        throw new Error(`${page}: the page has no palette "${palette}"${offered.length ? ` (it has ${offered.join(", ")})` : " picker"}; rebuild it with build.mjs`);
    }
    if (!(await b.js(`!!document.querySelector("#outline button")`))) throw new Error(`${page}: no steps rendered (${b.problems.join("; ") || "not an explainer page?"})`);
    const n = await b.js(`document.querySelectorAll("#outline button").length`);
    for (const [size, dim] of Object.entries(SIZES)) {
      if (size === "phone" && !phone) continue;
      await b.send("Emulation.setDeviceMetricsOverride", { width: dim.width, height: dim.height, deviceScaleFactor: 1, mobile: dim.mobile });
      for (let i = 0; i < n; i++) {
        // Go to step i the way a reader would, then reveal every build stage
        await b.js(`document.querySelectorAll("#outline button")[${i}].click(); document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
        const stages = await b.js(`Math.max(0, ...[...document.querySelectorAll(".step.active [data-b]")].map(e => +e.dataset.b))`);
        for (let k = 0; k < stages; k++) await b.js(`document.querySelector("#next").click()`);
        const options = await b.js(WHATIF_IDS), names = optionNames(options);
        for (let k = 0; k < Math.max(1, options.length); k++) {
          if (k) await b.js(pickOption(k));
          await b.js(`document.querySelector("#stage").scrollTop = 0`);
          await sleep(60);
          const m = await b.js(MEASURE);
          const file = join(out, shotFile(i, names[k], size));
          const { data } = await b.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(file, Buffer.from(data, "base64"));
          shots.push(file); onShot(file);
          check(m, i, n, size, dim, k ? ` with what-if "${options[k]}"` : "");
        }
        if (options.length) await b.js(pickOption(0));   // leave the step as a reader finds it
      }
    }
    await b.send("Emulation.clearDeviceMetricsOverride");
    [...new Set(b.problems)].forEach(p => findings.push(`console: ${p}`));
    [...new Set(b.dialogs)].forEach(d => findings.push(`dialog: ${d} (answered automatically; a page shouldn't open dialogs)`));
    [...new Set(b.requests.filter(u => !u.startsWith("file:") && !u.startsWith("data:")))].forEach(u => findings.push(`external request: ${u} (pages must work offline)`));
  } finally { b.close(); }
  return { shots, findings };
}

// Makes the output folder ready and removes the previous run's shots, never other files. In the default folder (ours by
// construction) every step image goes. Anywhere else only the images an earlier run listed in MARKER go, and a folder
// with any other step image is refused (returns why), so `-o ~/Pictures` can't lose a file. Returns the marker's path.
export const MARKER = ".explain-shots";
export function prepareOut(out, { ours = false } = {}) {
  mkdirSync(out, { recursive: true });
  const marker = join(out, MARKER);
  const listed = new Set(existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(f => SHOT_FILE.test(f)) : []);
  const shots = readdirSync(out).filter(f => SHOT_FILE.test(f));
  const foreign = ours ? [] : shots.filter(f => !listed.has(f));
  if (foreign.length) return { error: `${out} already holds step images this script didn't write (${foreign.slice(0, 3).join(", ")}${foreign.length > 3 ? ", …" : ""}); pick an empty or new folder for -o, or remove them` };
  shots.filter(f => ours || listed.has(f)).forEach(f => rmSync(join(out, f), { force: true }));
  writeFileSync(marker, "");
  return { marker };
}

async function main(argv) {
  const args = [...argv];
  const flag = f => { const i = args.indexOf(f); return i >= 0 && (args.splice(i, 1), true); };
  const take = f => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const phone = flag("--phone"), dark = flag("--dark"), help = flag("-h") || flag("--help");
  let out = take("-o") ?? take("--out");
  const hasPalette = args.includes("--palette"), palette = take("--palette");
  if (help || args.length !== 1) {
    console.log("usage: node shots.mjs <topic>.html | <topic>.content.js [-o <dir>] [--phone] [--dark] [--palette <id>]");
    return help ? 0 : 2;
  }
  const ids = PALETTES.map(p => p.id);
  if (hasPalette && !ids.includes(palette)) {
    console.error(`${palette === undefined ? "--palette needs an id" : `--palette ${palette}: no such palette`}; use one of ${ids.join(", ")}`);
    return 2;
  }
  const problem = nodeProblem();
  if (problem) { console.error(problem); return 2; }
  if (!findChrome()) { console.error("no Chrome/Chromium found (set CHROME=/path/to/chrome)"); return 2; }
  const src = args[0], topic = basename(src).replace(/(\.content)?\.(m?js|html?)$/i, "");
  const ours = out === undefined;
  out = resolve(out ?? join(tmpdir(), "explain-shots", topic));
  const { marker, error } = prepareOut(out, { ours });
  if (error) { console.error(error); return 2; }
  let page = resolve(src);
  if (/\.m?js$/i.test(src)) {
    let res;
    try { res = build(readFileSync(src, "utf8"), src); } catch (e) { console.error(`${src}: ${e.message}`); return 1; }
    if (!res.html) { res.errors.forEach(e => console.error(`error: ${e}`)); console.error(`${src}: not built; run build.mjs and fix the errors first`); return 1; }
    page = join(out, `${topic}.html`);
    writeFileSync(page, res.html);
  }
  let r;
  try { r = await shoot(page, { out, phone, dark, palette, onShot: f => appendFileSync(marker, `${basename(f)}\n`) }); } catch (e) { console.error(e.message); return 1; }
  r.shots.forEach(f => console.log(f));
  r.findings.forEach(f => console.warn(`finding: ${f}`));
  console.log(`${r.shots.length} screenshot${r.shots.length === 1 ? "" : "s"} in ${out}${r.findings.length ? `, ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}` : ""}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(c => { process.exitCode = c; });
