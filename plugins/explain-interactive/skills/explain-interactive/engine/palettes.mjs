// Palettes: the only place colour values, and the font, corner and border styles, are defined. Each palette is one
// file, palettes/<id>.json, read here at import time, so adding a palette means adding a file. build.mjs inlines
// paletteCss() into every page and into index.html. Each palette defines every name in VARS for light and dark, as
// #rrggbb, and a style that is the same in both: font (a key of FONTS), radius (a scale for corners: 1 is today's
// 8/10/12px) and border (line width in px). It also names its group (one of GROUPS), which places it in the picker,
// and may carry a credit: { theme, licence } for a palette based on someone else's theme.
// test/palettes.test.mjs checks every palette.
import { readdirSync, readFileSync } from "node:fs";

export const VARS = ["bg", "card", "fg", "muted", "line", "accent", "accent-soft", "ok", "ok-soft",
  "bad", "bad-soft", "hl", "hl-soft", "code-bg", "on-accent", "label"];

// System font stacks only: no web fonts, so a page stays self-contained and offline
export const FONTS = {
  sans: `system-ui, -apple-system, "Segoe UI", sans-serif`,
  serif: `ui-serif, Georgia, Cambria, "Times New Roman", serif`,
  mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
};
export const STYLE = { font: Object.keys(FONTS), radius: [0, .5, 1, 1.5, 2], border: [1, 1.5, 2] };

// The picker's groups, in this order. Default comes first, on its own, whatever its group.
export const GROUPS = ["Accessibility", "Looks", "Editor themes"];

// Default first, then by group in GROUPS order (an unknown group last), then by label
export function sortPalettes(palettes) {
  const rank = p => (p.id === "default" ? -1 : GROUPS.includes(p.group) ? GROUPS.indexOf(p.group) : GROUPS.length);
  return [...palettes].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, "en"));
}

export const PALETTE_DIR = new URL("./palettes/", import.meta.url);
export const PALETTES = sortPalettes(readdirSync(PALETTE_DIR).filter(f => f.endsWith(".json")).sort().map(f => {
  try { return JSON.parse(readFileSync(new URL(f, PALETTE_DIR), "utf8")); }
  catch (e) { throw new Error(`engine/palettes/${f}: ${e.message}`); }
}));

// The style is the same in light and dark, so only the palette's first rule sets it; its dark rules match the same
// element and leave these properties alone
const styleDecls = st => ` --font: ${FONTS[st.font]}; --radius: ${st.radius}; --border: ${st.border}px;`;
const decls = (vars, scheme) => VARS.map(k => `--${k}: ${vars[k]};`).join(" ") + ` color-scheme: ${scheme};`;

// One block per palette, default first. S = :root for default, :root[data-palette="<id>"] otherwise.
// Specificity and source order make a chosen palette win over default in every light/dark state.
export function paletteCss(palettes = PALETTES) {
  const sorted = [...palettes].sort((a, b) => (b.id === "default") - (a.id === "default"));
  return sorted.map(p => {
    const S = p.id === "default" ? ":root" : `:root[data-palette="${p.id}"]`;
    return `${S} { ${decls(p.light, "light")}${p.style ? styleDecls(p.style) : ""} }\n` +
      `@media (prefers-color-scheme: dark) { ${S}:not([data-theme="light"]) { ${decls(p.dark, "dark")} } }\n` +
      `${S}[data-theme="dark"] { ${decls(p.dark, "dark")} }`;
  }).join("\n");
}
