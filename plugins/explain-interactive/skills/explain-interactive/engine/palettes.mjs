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
  {
    id: "high-contrast", label: "High contrast",
    light: {
      bg: "#ffffff", card: "#ffffff", fg: "#000000", muted: "#333333", line: "#6b6b6b",
      accent: "#0040b0", "accent-soft": "#dce6ff", ok: "#006b1f", "ok-soft": "#ccf2d6",
      bad: "#b00010", "bad-soft": "#ffd9db", hl: "#7a4a00", "hl-soft": "#ffe6c7", "code-bg": "#f0f0f0",
      "on-accent": "#ffffff", label: "#1a1a1a",
    },
    dark: {
      bg: "#000000", card: "#121212", fg: "#ffffff", muted: "#d0d0d0", line: "#9a9a9a",
      accent: "#8cb8ff", "accent-soft": "#0f2a55", ok: "#5fe08a", "ok-soft": "#0b3a1c",
      bad: "#ff8a80", "bad-soft": "#4d1210", hl: "#ffc04d", "hl-soft": "#4a3300", "code-bg": "#1e1e1e",
      "on-accent": "#000000", label: "#e8e8e8",
    },
  },
  {
    id: "colour-blind", label: "Colour-blind safe",
    light: {
      bg: "#f7f7f5", card: "#ffffff", fg: "#1a1a1a", muted: "#555b62", line: "#d6d9dd",
      accent: "#4a3fc0", "accent-soft": "#e9e7fb", ok: "#005f9e", "ok-soft": "#dcecf8",
      bad: "#b84300", "bad-soft": "#fbe6da", hl: "#c2185b", "hl-soft": "#fce4ee", "code-bg": "#f1f1ee",
      "on-accent": "#ffffff", label: "#3d434a",
    },
    dark: {
      bg: "#101114", card: "#1c1e22", fg: "#ececec", muted: "#b8bcc2", line: "#474b52",
      accent: "#a99cff", "accent-soft": "#2a2550", ok: "#56b4e9", "ok-soft": "#12324a",
      bad: "#ff8a4c", "bad-soft": "#4a2412", hl: "#f0e442", "hl-soft": "#3d3a10", "code-bg": "#25282d",
      "on-accent": "#14102e", label: "#d6d9dd",
    },
  },
  {
    id: "sepia", label: "Sepia",
    light: {
      bg: "#f4ecd8", card: "#fbf6ea", fg: "#3b2f22", muted: "#6b5a45", line: "#d9cbb0",
      accent: "#2f5f7a", "accent-soft": "#e3ebe8", ok: "#4f6b1a", "ok-soft": "#e8edd0",
      bad: "#a3261f", "bad-soft": "#f5ddd3", hl: "#8a5a00", "hl-soft": "#f6e6c0", "code-bg": "#efe5cf",
      "on-accent": "#ffffff", label: "#4f4030",
    },
    dark: {
      bg: "#1c1712", card: "#2a221a", fg: "#eadfc8", muted: "#c2b399", line: "#54473a",
      accent: "#8fbcd4", "accent-soft": "#24343c", ok: "#a8c46a", "ok-soft": "#2c3417",
      bad: "#f08a70", "bad-soft": "#4a2219", hl: "#f0b04a", "hl-soft": "#47351a", "code-bg": "#332a20",
      "on-accent": "#1c1712", label: "#d9ccb2",
    },
  },
  {
    id: "slate", label: "Slate",
    light: {
      bg: "#eef1f5", card: "#ffffff", fg: "#1e2733", muted: "#556275", line: "#cfd6df",
      accent: "#2f5fa8", "accent-soft": "#e2eaf7", ok: "#1f7a4d", "ok-soft": "#ddf3e7",
      bad: "#b8323a", "bad-soft": "#fae3e4", hl: "#9a5800", "hl-soft": "#fbefdc", "code-bg": "#e8ecf1",
      "on-accent": "#ffffff", label: "#3a4656",
    },
    dark: {
      bg: "#151b23", card: "#1f2833", fg: "#e3e9f0", muted: "#a9b6c6", line: "#3e4b5b",
      accent: "#7fb0f0", "accent-soft": "#213651", ok: "#5ccf8f", "ok-soft": "#173a2a",
      bad: "#f2828a", "bad-soft": "#482228", hl: "#f2b155", "hl-soft": "#463418", "code-bg": "#263140",
      "on-accent": "#0d1a2e", label: "#cdd6e1",
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
