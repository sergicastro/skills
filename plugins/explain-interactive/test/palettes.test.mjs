// Checks every palette in engine/palettes/*.json, as engine/palettes.mjs loads them: files, ids, groups, order,
// variables, contrast and colour difference. Nothing here lists the palettes, so adding a file needs no test edit.
// A failure names the palette, mode, pair and the measured value, so a palette can be tuned from the output.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { VARS, PALETTES, paletteCss, FONTS, STYLE, GROUPS, PALETTE_DIR, sortPalettes } from "../skills/explain-interactive/engine/palettes.mjs";

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
// Colour-vision deficiency simulation: Machado, Oliveira & Fernandes (2009) matrices at severity 1.0,
// applied in linear RGB, clamped and encoded back to sRGB hex
const MACHADO = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
};
const encode = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const simulate = (hex, type) => {
  const lin = rgb(hex).map(linear);
  return "#" + MACHADO[type].map(row => row.reduce((s, k, i) => s + k * lin[i], 0))
    .map(c => Math.round(encode(Math.min(1, Math.max(0, c))) * 255).toString(16).padStart(2, "0")).join("");
};

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

test("one file per palette: engine/palettes/<id>.json, with only the known keys", () => {
  const files = readdirSync(PALETTE_DIR);
  assert.ok(files.includes("default.json"), "default.json");
  report(files.flatMap(f => {
    if (!f.endsWith(".json")) return [`engine/palettes/${f}: not a .json file`];
    const p = JSON.parse(readFileSync(new URL(f, PALETTE_DIR), "utf8"));
    return [
      ...(f === `${p.id}.json` ? [] : [`engine/palettes/${f}: id is ${p.id}; the file must be named ${p.id}.json`]),
      ...["id", "label", "group", "style", "light", "dark"].filter(k => !(k in p)).map(k => `${f}: missing ${k}`),
      ...Object.keys(p).filter(k => !["id", "label", "group", "style", "light", "dark", "credit"].includes(k)).map(k => `${f}: extra key ${k}`),
    ];
  }));
  assert.equal(PALETTES.length, files.length, "PALETTES has every file");
});

test("every palette names a group from GROUPS; a credit names the original theme and its licence", () => {
  report(PALETTES.flatMap(p => [
    ...(GROUPS.includes(p.group) ? [] : [`${p.id}: group ${p.group}, not one of ${GROUPS.join(", ")}`]),
    ...(p.credit === undefined ? [] :
      ["theme", "licence"].filter(k => typeof p.credit[k] !== "string" || !p.credit[k].trim()).map(k => `${p.id}: credit.${k} is missing`)
        .concat(Object.keys(p.credit).filter(k => !["theme", "licence", "url"].includes(k)).map(k => `${p.id}: extra credit key ${k}`))),
  ]));
});

test("PALETTES order: default first, then by group in GROUPS order, then by label", () => {
  assert.equal(PALETTES[0].id, "default");
  const rest = PALETTES.slice(1);
  for (let i = 1; i < rest.length; i++) {
    const [a, b] = [rest[i - 1], rest[i]], ga = GROUPS.indexOf(a.group), gb = GROUPS.indexOf(b.group);
    assert.ok(ga < gb || (ga === gb && a.label.localeCompare(b.label, "en") < 0), `${a.id} (${a.group}) before ${b.id} (${b.group})`);
  }
  // the rule itself, on a fixture: an unknown group sorts last
  const p = (id, group, label = id) => ({ id, group, label });
  const fixture = [p("z", "Mystery"), p("t", "Editor themes"), p("b", "Looks", "Beta"), p("a", "Looks", "alpha"),
    p("c", "Accessibility"), p("default", "Looks", "Zed")];
  assert.deepEqual(sortPalettes(fixture).map(x => x.id), ["default", "c", "a", "b", "t", "z"]);
  assert.deepEqual(GROUPS, ["Accessibility", "Looks", "Editor themes"]);
});

test("every palette has a style: font, radius and border from the allowed values, no other keys", () => {
  report(PALETTES.flatMap(p => {
    const st = p.style || {};
    return [
      ...Object.keys(STYLE).filter(k => !STYLE[k].includes(st[k])).map(k => `${p.id}: style.${k} is ${st[k]}, not one of ${STYLE[k].join(", ")}`),
      ...Object.keys(st).filter(k => !(k in STYLE)).map(k => `${p.id}: extra style key ${k}`),
    ];
  }));
  // System stacks only: no url() or @font-face, each ends in a generic family
  for (const [k, stack] of Object.entries(FONTS)) {
    assert.doesNotMatch(stack, /url\(|@font-face|[;{}]/, k);
    assert.match(stack, /, (sans-serif|serif|monospace)$/, k);
  }
});

test("style: Default keeps today's look; the accessibility palettes keep the font; each look has its own shape", () => {
  const style = Object.fromEntries(PALETTES.map(p => [p.id, p.style]));
  assert.deepEqual(style.default, { font: "sans", radius: 1, border: 1 });
  assert.equal(FONTS.sans, `system-ui, -apple-system, "Segoe UI", sans-serif`, "today's body font");
  for (const { id } of PALETTES.filter(p => p.group === "Accessibility")) {
    assert.equal(style[id].font, "sans", `${id} keeps the font`);
    assert.equal(style[id].radius, 1, `${id} keeps the corners`);
    assert.ok(style[id].border >= 1, `${id} border`);
  }
  assert.deepEqual(style.paper, { font: "serif", radius: 0, border: 1 }, "paper: serif, sharp corners, thin rules");
  assert.deepEqual(style.terminal, { font: "mono", radius: 0, border: 1 }, "terminal: monospace, square corners");
  assert.ok(style.soft.radius >= 2 && style.soft.border >= 2 && style.soft.font === "sans", "soft: large corners, thicker borders");
});

test("paletteCss() sets --font, --radius and --border once per palette, in its first rule", () => {
  const css = paletteCss(), n = PALETTES.length;
  for (const k of ["font", "radius", "border"]) assert.equal(css.split(`--${k}: `).length - 1, n, `--${k}`);
  for (const p of PALETTES) {
    const S = p.id === "default" ? ":root" : `:root[data-palette="${p.id}"]`;
    const first = css.split("\n").find(l => l.startsWith(`${S} {`));
    assert.ok(first.includes(`--font: ${FONTS[p.style.font]};`), `${p.id} font`);
    assert.ok(first.includes(`--radius: ${p.style.radius};`), `${p.id} radius`);
    assert.ok(first.includes(`--border: ${p.style.border}px;`), `${p.id} border`);
  }
  // a palette without a style (a test fixture) adds no style variables; default's apply to it
  const bare = paletteCss([{ id: "x", label: "X", light: PALETTES[0].light, dark: PALETTES[0].dark }]);
  assert.doesNotMatch(bare, /--font|--radius|--border/);
});

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

test("colour-blind: highlight, accent, ok and bad differ by ΔE ≥ 20 under deuteranopia and protanopia", () => {
  report(each((p, m, v) => {
    if (p.id !== "colour-blind") return [];
    return Object.keys(MACHADO).flatMap(type => DISTINCT_PAIRS
      .map(([a, b]) => [a, b, deltaE(simulate(v[a], type), simulate(v[b], type))]).filter(([, , d]) => !(d >= 20))
      .map(([a, b, d]) => `${p.id} ${m} ${type}: --${a} ${v[a]} vs --${b} ${v[b]} is ΔE ${d.toFixed(1)}`));
  }));
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
  // the real palettes' output: every variable in each of the 3 rules of every palette, both schemes
  const own = paletteCss(), n = PALETTES.length;
  for (const k of VARS) assert.equal(own.split(`--${k}: `).length - 1, 3 * n, `--${k} in each of the 3 rules per palette`);
  assert.equal(own.match(/; color-scheme: light/g).length, n);
  assert.equal(own.match(/; color-scheme: dark/g).length, 2 * n);
  for (const p of PALETTES.slice(1)) assert.ok(own.includes(`:root[data-palette="${p.id}"] {`), p.id);
});

test("contrast and ΔE helpers match known values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(1), "21.0");
  assert.equal(contrast("#777777", "#ffffff").toFixed(2), "4.48");
  assert.ok(deltaE("#000000", "#ffffff") > 99.9 && deltaE("#000000", "#ffffff") < 100.1);
  assert.equal(deltaE("#2f6fd6", "#2f6fd6"), 0);
  // the spec's reference: default dark ok/bad are ΔE ~102 apart, but nearly the same under deuteranopia
  // (ΔE ~5.1 here; the spec's 4.6 came from a slightly different pipeline, both far below 20)
  const ok = "#4ac26b", bad = "#ff7b72";
  assert.ok(Math.abs(deltaE(ok, bad) - 102) < 1, deltaE(ok, bad));
  const d = deltaE(simulate(ok, "deuteranopia"), simulate(bad, "deuteranopia"));
  assert.ok(d > 4 && d < 6, `deuteranopia ok/bad ΔE ${d}`);
  // greys are unchanged by the simulation
  for (const type of Object.keys(MACHADO)) assert.equal(simulate("#808080", type), "#808080");
});
