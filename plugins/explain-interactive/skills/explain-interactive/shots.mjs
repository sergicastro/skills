#!/usr/bin/env node
// Renders every step of an explainer page in headless Chrome and saves one screenshot per step, for review.
// Node 22+, no dependencies; needs Chrome, Chromium or Edge (set CHROME=/path/to/chrome to pick one).
//
//   node shots.mjs <topic>.html | <topic>.content.js [-o <dir>] [--phone] [--dark]
//
//   -o <dir>   where to write the images (default: <tmp>/explain-shots/<topic>; old step-*.png there are removed)
//   --phone    also render each step at phone size (390×844): step-NN-phone.png
//   --dark     dark theme instead of light
//
// A content file is built first (into the output directory). Each step is shown as the reader sees it on arrival,
// with every build stage revealed. Besides the images it lists what it can measure on each step:
// a middle step much taller than the screen, a diagram too wide for its box, diagram text rendered too small,
// console errors or warnings (e.g. a <dfn> with no glossary entry), and any request the page makes.
// Exit code: 0 rendered (findings are printed, not fatal), 1 the page failed, 2 bad arguments or no browser.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { build } from "./build.mjs";
import { findChrome, launch } from "./cdp.mjs";

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
    const vb = svg.viewBox && svg.viewBox.baseVal, w = svg.getBoundingClientRect().width;
    if (!vb || !vb.width || !w) return;
    svg.querySelectorAll("text").forEach(t => { const fs = parseFloat(getComputedStyle(t).fontSize); if (fs) minText = Math.min(minText, fs * w / vb.width); });
  });
  return { over, clipped, minText: minText === Infinity ? null : Math.round(minText * 10) / 10, title: art.querySelector("h2").textContent };
})()`;

export async function shoot(page, { out, phone = false, dark = false } = {}) {
  const b = await launch({ width: SIZES.desktop.width, height: SIZES.desktop.height });
  const shots = [], findings = [];
  try {
    await b.send("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: "reduce" },          // no slide-in or pop: capture the settled frame
      { name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
    await b.open(page);
    await b.js(`localStorage.clear()`);   // start fresh: no saved step, quiz answers or theme
    await b.open(page);
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
        await b.js(`document.querySelector("#stage").scrollTop = 0`);
        await sleep(60);
        const m = await b.js(MEASURE);
        const file = join(out, `step-${String(i + 1).padStart(2, "0")}${size === "phone" ? "-phone" : ""}.png`);
        const { data } = await b.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(file, Buffer.from(data, "base64"));
        shots.push(file);
        const at = `step ${i + 1} ("${m.title}")${size === "phone" ? " on a phone" : ""}`;
        // The Context step and the Recap are long by design, and phones always stack and scroll: only middle steps on desktop count
        if (size === "desktop" && i > 0 && i < n - 1 && m.over > OVER * dim.height)
          findings.push(`${at}: ${m.over}px taller than the screen; the reader has to scroll (shorten body, move detail to deeper, or split the step)`);
        if (m.clipped && size === "desktop") findings.push(`${at}: the visual is wider than its box and scrolls sideways (narrow the viewBox, or set wide: true)`);
        if (m.minText !== null && m.minText < MIN_TEXT_PX && size === "desktop") findings.push(`${at}: diagram text renders at ${m.minText}px (< ${MIN_TEXT_PX}px): shrink the viewBox or the parts, or set wide: true`);
      }
    }
    await b.send("Emulation.clearDeviceMetricsOverride");
    [...new Set(b.problems)].forEach(p => findings.push(`console: ${p}`));
    [...new Set(b.requests.filter(u => !u.startsWith("file:") && !u.startsWith("data:")))].forEach(u => findings.push(`external request: ${u} (pages must work offline)`));
  } finally { b.close(); }
  return { shots, findings };
}

async function main(argv) {
  const args = [...argv];
  const flag = f => { const i = args.indexOf(f); return i >= 0 && (args.splice(i, 1), true); };
  const take = f => { const i = args.indexOf(f); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
  const phone = flag("--phone"), dark = flag("--dark"), help = flag("-h") || flag("--help");
  let out = take("-o") ?? take("--out");
  if (help || args.length !== 1) {
    console.log("usage: node shots.mjs <topic>.html | <topic>.content.js [-o <dir>] [--phone] [--dark]");
    return help ? 0 : 2;
  }
  if (!findChrome()) { console.error("no Chrome/Chromium found (set CHROME=/path/to/chrome)"); return 2; }
  const src = args[0], topic = basename(src).replace(/(\.content)?\.(m?js|html?)$/i, "");
  out = resolve(out ?? join(tmpdir(), "explain-shots", topic));
  mkdirSync(out, { recursive: true });
  readdirSync(out).filter(f => /^step-\d+(-phone)?\.png$/.test(f)).forEach(f => rmSync(join(out, f)));
  let page = resolve(src);
  if (/\.m?js$/i.test(src)) {
    let res;
    try { res = build(readFileSync(src, "utf8"), src); } catch (e) { console.error(`${src}: ${e.message}`); return 1; }
    if (!res.html) { res.errors.forEach(e => console.error(`error: ${e}`)); console.error(`${src}: not built; run build.mjs and fix the errors first`); return 1; }
    page = join(out, `${topic}.html`);
    writeFileSync(page, res.html);
  }
  let r;
  try { r = await shoot(page, { out, phone, dark }); } catch (e) { console.error(e.message); return 1; }
  r.shots.forEach(f => console.log(f));
  r.findings.forEach(f => console.warn(`finding: ${f}`));
  console.log(`${r.shots.length} screenshot${r.shots.length === 1 ? "" : "s"} in ${out}${r.findings.length ? `, ${r.findings.length} finding${r.findings.length === 1 ? "" : "s"}` : ""}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(c => { process.exitCode = c; });
