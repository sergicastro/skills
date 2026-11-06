// Checks every palette in engine/palettes.mjs: ids, variables, contrast and colour difference.
// A failure names the palette, mode, pair and the measured value, so a palette can be tuned from the output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { VARS, PALETTES, paletteCss } from "../skills/explain-interactive/engine/palettes.mjs";

const MODES = ["light", "dark"];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
// WCAG 2 relative luminance and contrast ratio
const luminance = hex => { const [r, g, b] = rgb(hex).map(linear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// sRGB → CIE Lab (D65), then CIE76 ΔE
const lab = hex => {
  const [r, g, b] = rgb(hex).map(linear);
  const xyz = [0.4124 * r + 0.3576 * g + 0.1805 * b, 0.2126 * r + 0.7152 * g + 0.0722 * b, 0.0193 * r + 0.1192 * g + 0.9505 * b];
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = xyz.map((v, i) => f(v / [0.95047, 1, 1.08883][i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

// Pairs that must reach 4.5:1: text colours on every surface, accent colours on the plain surfaces and their own tint
const TEXT = ["fg", "muted", "label"], SURFACES = ["bg", "card", "code-bg", "accent-soft", "hl-soft", "ok-soft", "bad-soft"];
const STRONG = ["accent", "hl", "ok", "bad"];
const CONTRAST_PAIRS = [
  ...TEXT.flatMap(t => SURFACES.map(s => [t, s])),
  ...STRONG.flatMap(c => ["bg", "card", `${c}-soft`].map(s => [c, s])),
  ["on-accent", "accent"],
];
// Pairs that must look different (CIE76 ΔE ≥ 30), so the highlight isn't confused with links, success or failure
const DISTINCT_PAIRS = [["hl", "accent"], ["hl", "ok"], ["hl", "bad"], ["ok", "bad"]];

const each = fn => PALETTES.flatMap(p => MODES.flatMap(m => fn(p, m, p[m] || {})));
const report = fails => assert.deepEqual(fails, [], "\n" + fails.join("\n"));

test("palette ids are safe for attribute selectors, unique, and default comes first", () => {
  const ids = PALETTES.map(p => p.id);
  assert.equal(ids[0], "default");
  for (const p of PALETTES) {
    assert.match(p.id, /^[a-z][a-z-]*$/);
    assert.equal(typeof p.label, "string"); assert.ok(p.label);
  }
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids}`);
});

test("every palette defines every VAR as #rrggbb, with no extra keys, in light and dark", () => {
  report(each((p, m, vars) => [
    ...VARS.filter(k => !/^#[0-9a-f]{6}$/.test(vars[k] || "")).map(k => `${p.id} ${m}: --${k} is ${vars[k]}, not #rrggbb`),
    ...Object.keys(vars).filter(k => !VARS.includes(k)).map(k => `${p.id} ${m}: extra key ${k}`),
  ]));
});

test("text and accent colours reach 4.5:1 contrast", () => {
  report(each((p, m, v) => CONTRAST_PAIRS
    .map(([a, b]) => [a, b, contrast(v[a], v[b])]).filter(([, , r]) => !(r >= 4.5))
    .map(([a, b, r]) => `${p.id} ${m}: --${a} ${v[a]} on --${b} ${v[b]} is ${r.toFixed(2)}:1`)));
});

test("high-contrast palettes have --line at 3:1 on --card", () => {
  report(each((p, m, v) => {
    if (p.id !== "high-contrast") return [];
    const r = contrast(v.line, v.card);
    return r >= 3 ? [] : [`${p.id} ${m}: --line ${v.line} on --card ${v.card} is ${r.toFixed(2)}:1`];
  }));
});

test("highlight, accent, ok and bad differ by ΔE ≥ 30", () => {
  report(each((p, m, v) => DISTINCT_PAIRS
    .map(([a, b]) => [a, b, deltaE(v[a], v[b])]).filter(([, , d]) => !(d >= 30))
    .map(([a, b, d]) => `${p.id} ${m}: --${a} ${v[a]} vs --${b} ${v[b]} is ΔE ${d.toFixed(1)}`)));
});

test("paletteCss() writes one block per palette, default first, with the selector scheme", () => {
  const fixture = [
    { id: "other", label: "Other", light: PALETTES[0].light, dark: PALETTES[0].dark },
    PALETTES[0],
  ];
  const css = paletteCss(fixture);
  assert.ok(css.startsWith(":root { --bg: "), css.slice(0, 40));
  assert.equal(css.match(/@media \(prefers-color-scheme: dark\)/g).length, 2);
  assert.ok(css.includes(`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {`));
  assert.ok(css.includes(`:root[data-theme="dark"] {`));
  assert.ok(css.includes(`:root[data-palette="other"] {`));
  assert.ok(css.includes(`:root[data-palette="other"]:not([data-theme="light"]) {`));
  assert.ok(css.includes(`:root[data-palette="other"][data-theme="dark"] {`));
  assert.ok(css.indexOf(`[data-palette="other"]`) > css.indexOf(`:root[data-theme="dark"]`), "default is written first");
  // the default palette's own output: every variable, both schemes
  const own = paletteCss();
  for (const k of VARS) assert.equal(own.split(`--${k}: `).length - 1, 3, `--${k} in each of the 3 rules`);
  assert.equal(own.match(/; color-scheme: light/g).length, 1);
  assert.equal(own.match(/; color-scheme: dark/g).length, 2);
});

test("contrast and ΔE helpers match known values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
  assert.ok(deltaE("#000000", "#ffffff") > 99.9 && deltaE("#000000", "#ffffff") < 100.1);
  assert.equal(deltaE("#2f6fd6", "#2f6fd6"), 0);
});
