// Colour palettes: the only place colour values are defined. build.mjs inlines paletteCss() into every page
// and into index.html. Each palette defines every name in VARS for light and dark, as #rrggbb.
// test/palettes.test.mjs checks contrast and colour difference for every palette.
export const VARS = ["bg", "card", "fg", "muted", "line", "accent", "accent-soft", "ok", "ok-soft",
  "bad", "bad-soft", "hl", "hl-soft", "code-bg", "on-accent", "label"];

export const PALETTES = [
  {
    id: "default", label: "Default",
    light: {
      bg: "#f6f5f1", card: "#ffffff", fg: "#1f2328", muted: "#5d656e", line: "#dcdfe3",
      accent: "#2d6ace", "accent-soft": "#e8f0ff", ok: "#1a7f37", "ok-soft": "#dafbe1",
      bad: "#cf222e", "bad-soft": "#ffebe9", hl: "#ad5b00", "hl-soft": "#fff4e0", "code-bg": "#f3f1ec",
      "on-accent": "#ffffff", label: "#454d56",
    },
    dark: {
      bg: "#0d0f12", card: "#1d2127", fg: "#e6e8eb", muted: "#b4bcc6", line: "#48515c",
      accent: "#6ea8ff", "accent-soft": "#1f3354", ok: "#4ac26b", "ok-soft": "#164028",
      bad: "#ff7b72", "bad-soft": "#4a2020", hl: "#ffb547", "hl-soft": "#4a3512", "code-bg": "#272c34",
      "on-accent": "#0b1a33", label: "#d3d9e0",
    },
  },
];

const decls = (vars, scheme) => VARS.map(k => `--${k}: ${vars[k]};`).join(" ") + ` color-scheme: ${scheme};`;

// One block per palette, default first. S = :root for default, :root[data-palette="<id>"] otherwise.
// Specificity and source order make a chosen palette win over default in every light/dark state.
export function paletteCss(palettes = PALETTES) {
  const sorted = [...palettes].sort((a, b) => (b.id === "default") - (a.id === "default"));
  return sorted.map(p => {
    const S = p.id === "default" ? ":root" : `:root[data-palette="${p.id}"]`;
    return `${S} { ${decls(p.light, "light")} }\n` +
      `@media (prefers-color-scheme: dark) { ${S}:not([data-theme="light"]) { ${decls(p.dark, "dark")} } }\n` +
      `${S}[data-theme="dark"] { ${decls(p.dark, "dark")} }`;
  }).join("\n");
}
