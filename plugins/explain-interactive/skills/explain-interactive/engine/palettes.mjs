// Palettes: the only place colour values, and the font, corner and border styles, are defined. build.mjs inlines
// paletteCss() into every page and into index.html. Each palette defines every name in VARS for light and dark,
// as #rrggbb, and a style that is the same in both: font (a key of FONTS), radius (a scale for corners: 1 is
// today's 8/10/12px) and border (line width in px). test/palettes.test.mjs checks every palette.
export const VARS = ["bg", "card", "fg", "muted", "line", "accent", "accent-soft", "ok", "ok-soft",
  "bad", "bad-soft", "hl", "hl-soft", "code-bg", "on-accent", "label"];

// System font stacks only: no web fonts, so a page stays self-contained and offline
export const FONTS = {
  sans: `system-ui, -apple-system, "Segoe UI", sans-serif`,
  serif: `ui-serif, Georgia, Cambria, "Times New Roman", serif`,
  mono: `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`,
};
export const STYLE = { font: Object.keys(FONTS), radius: [0, .5, 1, 1.5, 2], border: [1, 1.5, 2] };

export const PALETTES = [
  {
    id: "default", label: "Default", style: { font: "sans", radius: 1, border: 1 },
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
    id: "high-contrast", label: "High contrast", style: { font: "sans", radius: 1, border: 2 },
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
    id: "colour-blind", label: "Colour-blind safe", style: { font: "sans", radius: 1, border: 1 },
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
    id: "paper", label: "Paper", style: { font: "serif", radius: 0, border: 1 },
    light: {
      bg: "#f7f3ea", card: "#fffdf8", fg: "#1e1b16", muted: "#5e574c", line: "#d6cdbd",
      accent: "#1f4e8c", "accent-soft": "#e6ecf4", ok: "#2c6a2c", "ok-soft": "#e2eddb",
      bad: "#a4262c", "bad-soft": "#f6e0dc", hl: "#8a5300", "hl-soft": "#f7ead2", "code-bg": "#f0ebe0",
      "on-accent": "#ffffff", label: "#47413a",
    },
    dark: {
      bg: "#15130f", card: "#1f1c17", fg: "#ece5d6", muted: "#bdb4a2", line: "#4a4438",
      accent: "#8fb4e6", "accent-soft": "#24303f", ok: "#8cc97a", "ok-soft": "#22331d",
      bad: "#f08a7a", "bad-soft": "#47221d", hl: "#e8b04a", "hl-soft": "#45351a", "code-bg": "#29251e",
      "on-accent": "#111a28", label: "#d8d0c0",
    },
  },
  {
    id: "terminal", label: "Terminal", style: { font: "mono", radius: 0, border: 1 },
    light: {
      bg: "#e8f3e4", card: "#f4faf1", fg: "#0d2b12", muted: "#2f5634", line: "#b9d3b2",
      accent: "#005f73", "accent-soft": "#d9ecee", ok: "#1d6b1d", "ok-soft": "#d5edd0",
      bad: "#b3261e", "bad-soft": "#f6dcd8", hl: "#8a5200", "hl-soft": "#f3e6c8", "code-bg": "#dcebd7",
      "on-accent": "#ffffff", label: "#1f4425",
    },
    dark: {
      bg: "#070b07", card: "#0d140d", fg: "#7cf08a", muted: "#58c066", line: "#245a2b",
      accent: "#4fd6e6", "accent-soft": "#0e2c30", ok: "#a6f04f", "ok-soft": "#1b2e0c",
      bad: "#ff6b5f", "bad-soft": "#3a1310", hl: "#ffb000", "hl-soft": "#352600", "code-bg": "#111c11",
      "on-accent": "#04191c", label: "#6ad879",
    },
  },
  {
    id: "soft", label: "Soft", style: { font: "sans", radius: 2, border: 2 },
    light: {
      bg: "#f6f3fb", card: "#ffffff", fg: "#2a2540", muted: "#5f5878", line: "#ddd5ee",
      accent: "#6a3fc8", "accent-soft": "#ece5fb", ok: "#23764a", "ok-soft": "#dcf3e6",
      bad: "#c0344d", "bad-soft": "#fde3e8", hl: "#9a4f0a", "hl-soft": "#fdecd9", "code-bg": "#f1edf8",
      "on-accent": "#ffffff", label: "#4a4462",
    },
    dark: {
      bg: "#1a1724", card: "#252135", fg: "#ece8f6", muted: "#bdb5d4", line: "#4a4363",
      accent: "#b9a2ff", "accent-soft": "#352c55", ok: "#6fd3a0", "ok-soft": "#1f3f30",
      bad: "#ff8fa3", "bad-soft": "#4a2230", hl: "#ffbf73", "hl-soft": "#4a3418", "code-bg": "#2d2840",
      "on-accent": "#1a1330", label: "#d6d0e8",
    },
  },
];

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
