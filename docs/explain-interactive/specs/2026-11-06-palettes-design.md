# explain-interactive: colour palettes — design

Date: 2026-11-06
Status: draft

## 1. Purpose

Let the reader of an explainer page pick a colour palette, for looks or for accessibility
(high contrast, colour-blind safe). Light and dark stay a separate switch inside every palette.

Constraints:

- **No extra tokens.** Claude never picks a palette and SKILL.md gains no new instructions. The
  palettes live in the engine, which `build.mjs` copies into the page without Claude reading it.
- **Self-contained and offline**, as now: every palette is inlined into every page.
- **Fixed set.** Users can't add their own palettes, so palettes are checked by unit tests, not
  by `build.mjs --check`.
- Accessibility is best effort: automated contrast and colour-difference checks, not a WCAG
  audit.

## 2. Palette source

> Update (2026-11-11): each palette now lives in its own file, `engine/palettes/<id>.json` (`id`,
> `label`, `group`, `style`, `light`, `dark`, optional `credit: { theme, licence }`), which
> `palettes.mjs` reads at import time. `PALETTES` is computed: `default` first, then the groups
> in `GROUPS` order (Accessibility, Looks, Editor themes), alphabetical by label within a group.
> The picker shows one `<optgroup>` per group. The exports below are unchanged.

New file `skills/explain-interactive/engine/palettes.mjs`, the only place colour values, and the
font, corner and border styles, are defined:

```js
export const VARS = ["bg", "card", "fg", "muted", "line", "accent", "accent-soft", "ok", "ok-soft",
  "bad", "bad-soft", "hl", "hl-soft", "code-bg", "on-accent", "label"];
export const PALETTES = [
  { id: "default", label: "Default", style: { font: "sans", radius: 1, border: 1 },
    light: { bg: "#f6f5f1", ... }, dark: { bg: "#0d0f12", ... } },
  ...
];
export const FONTS = { sans: `system-ui, …, sans-serif`, serif: `ui-serif, Georgia, …, serif`, mono: `ui-monospace, …, monospace` };
export const STYLE = { font: Object.keys(FONTS), radius: [0, .5, 1, 1.5, 2], border: [1, 1.5, 2] };
export function paletteCss(palettes = PALETTES) { ... }   // returns the CSS text
```

- `default` comes first and is what a page shows when nothing is saved.
- Palette ids match `/^[a-z][a-z-]*$/`, so they are safe in attribute selectors.
- `build(code, file, { palettes = PALETTES } = {})` and `indexHtml(pages, { palettes = PALETTES } = {})`
  take an optional palette list, so tests can build pages with a fixture palette. The skill's
  own calls pass nothing.
- Layout variables (`--side`, `--top`, `--foot`) stay in `engine.css`. Only colour variables,
  `color-scheme` and the three style variables move.

### Style variables

A palette changes shape and type too, not only colour. Its `style` is the same in light and dark
and becomes three variables:

| Variable | From | Used for |
|---|---|---|
| `--font` | a key of `FONTS`: system font stacks only, no web fonts, so pages stay offline | the body (and so all text that inherits it), the index page, diagram text, the diff headers. Code keeps its monospace stack. |
| `--radius` | a unitless scale; `1` is today's corners | every fixed corner in `engine.css` and the index page becomes `calc(<today's px> * var(--radius))`, so 8/10/12px become 0 at `0` and 16/20/24px at `2`. Pills (`999px`) and circles (`50%`) stay. Diagram boxes (`rx="8"`) and label backgrounds (`rx="3"`) follow it through a CSS `rx` rule. |
| `--border` | a width in px; `1` is today's | every `1px` line on the page; thicker ones keep their extra width over it (`1.5px` becomes `calc(var(--border) + .5px)`). Diagram box outlines follow it; arrows and lifelines keep today's widths, because an SVG arrowhead grows with its line. |

`default`'s style is today's (`sans`, `1`, `1`), so a default page computes the same fonts, radii
and border widths as before; a browser test checks this against the values read before the change.

Diagram labels: `build.mjs` sizes boxes and label backgrounds from a table of system-sans widths.
A wider face (monospace, serif) could overrun them, so `engine.js` measures each label in a box or
on a label background (on a canvas, so the diagrams of hidden steps fit too) whenever the palette
is set, and shrinks the font of one that wouldn't fit. A browser test checks that no label
overflows, in every example with a spec diagram, every palette and both modes.
- The colour variable blocks at the top of `engine.css` (`:root`, the dark `@media` block and
  `:root[data-theme="dark"]`) are removed. So are the copies in `build.mjs`'s `indexHtml`. Both
  pages get `paletteCss()` instead. The index page uses the variables it already uses, which are
  a subset of `VARS`.

### Generated CSS

For each palette, with `S` = `:root` for `default` and `:root[data-palette="<id>"]` otherwise:

```css
S { <light vars>; color-scheme: light; --font: …; --radius: …; --border: …; }
@media (prefers-color-scheme: dark) { S:not([data-theme="light"]) { <dark vars>; color-scheme: dark; } }
S[data-theme="dark"] { <dark vars>; color-scheme: dark; }
```

The style variables are written only in the first rule: they are the same in both modes, and the
dark rules match the same element. A palette with no `style` (a test fixture) writes none, so
`default`'s apply. `default` is written first. Why this resolves correctly (specificity, then source order):

| State | Rule that wins |
|---|---|
| no palette, OS light | `:root` (default light) |
| no palette, OS dark, no forced mode | default dark `@media` rule |
| palette P, OS light | `S` (0,2,0) beats `:root` (0,1,0) |
| palette P, OS dark, no forced mode | P's `@media` rule (0,3,0) beats default dark (0,2,0) and P light (0,2,0) |
| palette P, forced light, OS dark | P light; default dark doesn't match (`:not([data-theme="light"])`) |
| palette P, forced dark | P's `[data-theme="dark"]` rule (0,3,0) |
| unknown saved palette id | no `S` matches, so default applies |

A test checks the computed values for these states in a real browser (section 5).

## 3. Palettes

| id | label | intent |
|---|---|---|
| `default` | Default | today's colours, with light `--accent` and `--hl` darkened just enough to pass 4.5:1 (they are 4.41 and 4.28 on `--bg` today) |
| `high-contrast` | High contrast | near-black on white (and white on near-black in dark mode), stronger `--line`, more saturated soft tints |
| `colour-blind` | Colour-blind safe | based on Okabe–Ito: ok = blue, bad = vermillion, hl = a yellow-orange or reddish purple that stays different from both under deuteranopia and protanopia |
| `paper` | Paper | a printed essay: serif text, warm off-white (light) or ink-dark (dark), sharp corners, thin rules |
| `terminal` | Terminal | monospace everywhere, square corners; phosphor green with amber highlights on near-black (dark), dark green text on pale green (light) |
| `soft` | Soft | friendly: large rounded corners, pastel violet surfaces, thicker borders |

Styles:

| id | font | radius | border |
|---|---|---|---|
| `default` | sans | 1 | 1 |
| `high-contrast` | sans | 1 | 2 |
| `colour-blind` | sans | 1 | 1 |
| `paper` | serif | 0 | 1 |
| `terminal` | mono | 0 | 1 |
| `soft` | sans | 2 | 2 |

`high-contrast` and `colour-blind` keep their colours and the system font: they are for
accessibility, not looks. `high-contrast` takes the thicker border. `paper`, `terminal` and `soft`
replace the earlier `sepia` and `slate`, which only changed colours.

Each palette defines all of `VARS` in both light and dark. Exact values are chosen when the
palettes are implemented and must pass section 5's checks.

For reference, the default dark palette's `--ok`/`--bad` differ by ΔE 102 for normal vision but
only ΔE 4.6 under simulated deuteranopia. That's the problem `colour-blind` fixes.

## 4. Picker

### Page

- A native `<select id="palette">` with one `<option>` per palette (the label as text, the id as
  value) is placed in the top bar just before the ☀/☾ button, with class `tool`, so on phones it
  hides with the other top-bar tools.
- A second `<select>` with the same options is placed in `.side-tools` (the phone menu) before
  the long theme button.
- Both have `aria-label="Colour palette"` and are kept in sync.
- `build.mjs` renders the options from `PALETTES` into a `{{PALETTE_OPTIONS}}` placeholder in
  `page.html`, so `engine.js` doesn't need the palette list.
- If `PALETTES` has a single entry, both selects are omitted.

### Behaviour (`engine.js`)

- On change: set `document.documentElement.dataset.palette` (remove the attribute for
  `default`), save the id to `localStorage["explain-palette"]` (or remove the key for
  `default`), and update the other select.
- On load: set the selects to the current `dataset.palette`, or to `default` if the attribute is
  missing or is not one of the options. In that last case, also remove the attribute.
- The ☀/☾ button and the `explain-theme` key are unchanged.

### Before first paint

The `<head>` bootstrap script in `page.html` and in `indexHtml` also reads `explain-palette` and
sets `dataset.palette`, so a page never flashes the default colours first:

```js
try { const s = localStorage, t = s.getItem("explain-theme"), p = s.getItem("explain-palette");
  if (t) document.documentElement.dataset.theme = t; if (p) document.documentElement.dataset.palette = p; } catch (e) {}
```

### Index page

`index.html` follows the saved palette and mode but has no picker.

### Print

`@media print` keeps its current rules. The palette in use is printed as it is.

## 5. Testing

### `test/palettes.test.mjs` (Node only, no browser)

For every palette × mode:

- The id matches `/^[a-z][a-z-]*$/` and ids are unique.
- Every name in `VARS` is defined, as a `#rrggbb` value, and there are no extra keys.
- Contrast is at least 4.5:1 (WCAG relative luminance) for:
  - `fg`, `muted`, `label` on `bg`, `card`, `code-bg`, `accent-soft`, `hl-soft`, `ok-soft`, `bad-soft`
  - `accent`, `hl`, `ok`, `bad` on `bg`, `card` and on their own `-soft`
  - `on-accent` on `accent`
- Contrast is at least 3:1 for `line` on `card` in `high-contrast` only (other palettes keep
  subtle borders).
- Colour difference (CIE76 ΔE in Lab) is at least 30 for `hl` vs `accent`, `hl` vs `ok`,
  `hl` vs `bad`, and `ok` vs `bad`. This keeps "the highlight means this step" from being
  confused with links, success or failure.
- `colour-blind` only: the same four pairs are at least ΔE 20 under simulated deuteranopia and
  protanopia (Machado et al. 2009 matrices, severity 1.0).
- `paletteCss()` output contains one block per palette and starts with `default`.

The test prints the failing pair and its ratio or ΔE, so a palette can be tuned from the output.

### `test/page.test.mjs` (headless Chrome, existing harness)

- Each row of the table in section 2: set the attribute and the emulated colour scheme, then check
  the computed `--bg` against the palette's value.
- Picking a palette in the top-bar select changes `--bg`, updates the menu select, and writes
  `explain-palette`. After a reload, the palette is applied and selected.
- A saved unknown id shows default and the select shows Default.
- The index page applies the saved palette.
- No external requests (the existing check still passes).

### `test/build.test.mjs`

- The page's `<script>` count assertion stays the same: the bootstrap script is extended, not
  added.
- The page contains one `<option>` per palette in each select.

### `shots.mjs`

New `--palette <id>` flag that sets `explain-palette` before shooting, so maintainers can look at
every palette. An unknown id is an error listing the valid ids.

## 6. Docs

- `README.md`: the "Light and dark" feature line becomes "Palettes and light/dark", naming the
  palettes and saying the choice is remembered. `shots.mjs --palette` goes wherever the README
  describes shots.
- `SKILL.md` line ~186 and `diagram-recipes.md` line ~55: "orange" becomes "the highlight colour",
  because the colour now depends on the palette. Line ~196 "light/dark mode" becomes "every
  palette, light and dark". No other SKILL.md changes.

## 7. Task split

| # | Task | Depends on |
|---|---|---|
| 1 | `palettes.mjs` with `default` only (light `accent`/`hl` darkened), `paletteCss()`, remove the colour blocks from `engine.css` and `indexHtml`, `palettes.test.mjs`, and the computed-colour browser tests for the default palette. No other visible change. | — |
| 2 | Add the `high-contrast`, `colour-blind`, `sepia` and `slate` palettes so they pass `palettes.test.mjs`. Add the deuteranopia/protanopia checks. | 1 |
| 3 | Picker: the two selects, `{{PALETTE_OPTIONS}}`, the `engine.js` behaviour, the bootstrap script in both pages, browser and build tests, `shots.mjs --palette`. Tested against a second throwaway palette in the test fixture, so it doesn't wait for 2. | 1 |
| 4 | Docs (section 6). | 2, 3 |
| 5 | Release: bump the `explain-interactive` version (minor). | 4 |

Tasks 1–4 are opened with the `skip-version-bump` label. Task 5 carries the bump, as in earlier
epics.

## 8. Out of scope

- Palettes chosen by Claude or by the content file.
- User-defined palettes.
- A picker on the index page.
- A full WCAG audit beyond the checks in section 5.
- Web fonts, or any font a reader's system doesn't have: `--font` is a system stack only.
- Styles beyond font, corners and border width (spacing, shadows, font size), and styles set
  apart from the palette (a reader can't pick Terminal's font with Default's colours).
- Laying out diagrams per font: boxes are sized once at build time for a system sans; a wider
  font shrinks the label to fit instead.
