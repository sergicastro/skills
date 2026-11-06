/* explain-interactive engine: renders a step-by-step explainer from the page's content.
   The content script (inlined before this one by build.mjs) declares META, CAST, GLOSSARY, DIAGRAM and STEPS,
   plus DECISION, HYPOTHESES or LAYERS for the page types that need them (META.type).
   Don't edit pages by hand: change the content file and rebuild. Field reference: references/content-file.md. */
((META, CAST, GLOSSARY, DIAGRAM, STEPS, DECISION, HYPOTHESES, LAYERS) => {
if (!META || !Array.isArray(STEPS) || !STEPS.length) {
  document.getElementById("stage").textContent = "This page has no content: META and STEPS are missing (rebuild it from its content file).";
  return;
}
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const plain = h => new DOMParser().parseFromString(String(h || ""), "text/html").body.textContent.replace(/\s+/g, " ").trim();
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const N = STEPS.length, LAST = N - 1;
const terms = Object.keys(GLOSSARY), cast = Object.keys(CAST);
// Page type: picks the panel drawn next to each step's text. A walkthrough has none and renders as it always has.
const TYPE = ["decision", "before-after", "debugging", "concept"].includes(META.type) ? META.type : "walkthrough";
document.body.classList.add("type-" + TYPE);
document.title = META.title;
$("#title").textContent = META.title;
$$(".bigpic-text").forEach(e => e.textContent = META.bigPicture || "");

// Saved progress (visited steps, quiz answers, last step) — per page, in this browser only
const KEY = "explain-progress:" + location.pathname + ":" + META.title;
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
// Visited steps are kept as a list of step indexes, not a high-water mark: the Short version jumps over background
// steps, and a mark past them would count them as read. Progress an older engine saved as maxSeen reads as 0..maxSeen.
let results = saved.results || {}, cur = 0, choices = saved.choices || {};
let seen = new Set(Array.isArray(saved.seen) ? saved.seen : [...Array((saved.maxSeen || 0) + 1).keys()]);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ cur, seen: [...seen].sort((a, b) => a - b), results, choices })); } catch (e) {} };

// Glossary lookup shared by <dfn> tooltips, diagram parts and the "Still confused" prompt: the name, then its singular.
// <dfn data-term="token">tokens</dfn> names the entry explicitly; otherwise its text is looked up.
const GL = Object.fromEntries([...cast.map(t => [t.toLowerCase(), CAST[t]]), ...terms.map(t => [t.toLowerCase(), GLOSSARY[t]])]);
const lookup = t => { const k = String(t).replace(/\s+/g, " ").trim().toLowerCase(); return GL[k] ?? GL[k.replace(/(es|s)$/, "")] ?? GL[k.replace(/s$/, "")]; };
const findTerm = d => lookup(d.dataset.term || d.textContent);

// Diagram parts that name a CAST/GLOSSARY entry (by data-term, else their own text, else their id) show it on click
const DEFS = {};
{ const box = document.createElement("div"); box.innerHTML = DIAGRAM;
  box.querySelectorAll("[data-id]").forEach(el => {
    const t = el.querySelector("text"), name = [el.dataset.term, t && t.textContent, el.dataset.id].find(k => k && lookup(k));
    if (name) DEFS[el.dataset.id] = name.trim();
  }); }
const HAS_DEFS = Object.keys(DEFS).length > 0;

// Depth: Short skips the steps marked depth: "full" (background a reader may already have) and the Context card's
// setting / why / prereqs. The Context step and the Recap are always shown. The choice is remembered, like the theme.
const FULL = STEPS.map((s, i) => i > 0 && i < LAST && s.depth === "full");
const FULL_CTX = ["setting", "why", "prereqs"].filter(k => { const c = STEPS[0].context || {}; return c[k] && c[k].length; });
const HAS_DEPTH = FULL.some(Boolean) || FULL_CTX.length > 0;
let short = false; try { short = HAS_DEPTH && localStorage.getItem("explain-depth") === "short"; } catch (e) {}
const shown = i => !(short && FULL[i]);
const order = () => STEPS.map((_, i) => i).filter(shown);   // the steps the reader walks, in order
const pos = i => order().indexOf(i) + 1, total = () => order().length;
const nextShown = (i, dir) => { for (let j = i + dir; j >= 0 && j <= LAST; j += dir) if (shown(j)) return j; return -1; };

// Shared diagram: clone DIAGRAM for step i. New parts get .hl, parts not introduced yet are ghosted (.dim), the Recap shows all.
// A visual's highest data-b counts too, so a part staged without a matching `build` is still revealed
const buildStages = STEPS.map(s => Math.max(s.build || 0, ((s.diagram || {}).build || []).length,
  ...[...String(s.visual || "").matchAll(/data-b\s*=\s*["']?(\d+)/g)].map(m => +m[1])));
// What-if options: each may relight the step's diagram. Whatever any option lit counts as introduced for later steps,
// since the reader may have picked it.
const wiOpts = s => (s.whatif && Array.isArray(s.whatif.options) ? s.whatif.options : []);
const litBy = s => [...((s.diagram || {}).hl || []), ...wiOpts(s).flatMap(o => (o.diagram || {}).hl || [])];
// The step's diagram with option o's hl/hide/dim in place of the step's own
const diagramOf = (s, o) => o && o.diagram ? { ...(s.diagram || {}), ...o.diagram } : s.diagram || {};
function diagramFor(i, d = STEPS[i].diagram || {}) {
  const recap = i === LAST && N > 1;
  const seen = new Set(); STEPS.slice(0, i).forEach(t => litBy(t).forEach(x => seen.add(x)));
  const hl = new Set(d.hl || []), hide = new Set(d.hide || []), dim = new Set(d.dim || []);
  const box = document.createElement("div"); box.innerHTML = DIAGRAM;
  box.querySelectorAll("[data-id]").forEach(el => {
    const id = el.dataset.id;
    if (hide.has(id)) el.classList.add("hidden");
    else if (hl.has(id)) el.classList.add("hl");
    else if (dim.has(id) || (!recap && !seen.has(id))) el.classList.add("dim");
    (d.build || []).forEach((stage, n) => { if ([].concat(stage).includes(id)) el.setAttribute("data-b", n + 1); });
    if (DEFS[id] && !hide.has(id)) {
      el.setAttribute("data-def", DEFS[id]); el.setAttribute("tabindex", "0"); el.setAttribute("role", "button");
      el.setAttribute("aria-label", `${DEFS[id]}: what it is`);
    }
  });
  // An image's parts can't be buttons for a screen reader; a labelled group's can
  const svg = box.querySelector("svg"); if (HAS_DEFS && svg && svg.getAttribute("role") === "img") svg.setAttribute("role", "group");
  return box.innerHTML + (recap ? (HAS_DEFS ? `<div class="legend">${defHint}</div>` : "") : legend);
}
const defHint = `<span class="def-hint">Click a part to see what it is</span>`;
const legendOf = hint => `<div class="legend"><span><i class="new"></i>new in this step</span><span><i></i>already introduced</span><span><i class="soon"></i>coming later</span>${hint}</div>`;
// Only diagram parts are clickable, so the panels' legend leaves the hint out
const legend = legendOf(HAS_DEFS ? defHint : ""), panelLegend = legendOf("");
// Ids a field of the earlier steps introduced, so a panel can ghost what the reader hasn't met yet (same rule as the diagram)
const seenBefore = (i, pick) => new Set(STEPS.slice(0, i).flatMap(t => [].concat(pick(t) || [])));

// Decision: options as columns, criteria (then cost) as rows. A step lights the rows/columns it discusses;
// the recommendation shows from the step that sets matrix.recommend, and always on the Recap.
const LEVEL = { good: ["✓", "good"], fair: ["~", "fair"], poor: ["✗", "poor"] };
function matrixFor(i) {
  const D = DECISION, m = STEPS[i].matrix || {}, recap = i === LAST && N > 1;
  const opts = D.options || [], rows = [...(D.criteria || [])];
  if (D.cost) rows.push({ id: "cost", name: "Cost" });
  const sO = seenBefore(i, t => (t.matrix || {}).options), sC = seenBefore(i, t => (t.matrix || {}).criteria);
  const hO = new Set(m.options || []), hC = new Set(m.criteria || []);
  const st = (h, s, id) => h.has(id) ? "hl" : recap || s.has(id) ? "" : "dim";
  const rec = (recap || STEPS.slice(0, i + 1).some(t => (t.matrix || {}).recommend)) && D.recommend;
  const col = o => [st(hO, sO, o.id), rec === o.id ? "rec" : ""].filter(Boolean).join(" ");
  const cell = (o, r) => {
    if (r.id === "cost") return `<td class="${col(o)}">${(D.cost || {})[o.id] || ""}</td>`;
    const v = ((D.ratings || {})[o.id] || {})[r.id], lv = typeof v === "string" ? v : v && v.level, note = v && v.note;
    const [sym, word] = LEVEL[lv] || ["", ""];
    return `<td class="${col(o)}">${sym ? `<span class="lv ${lv}" title="${word}">${sym}<span class="sr"> ${word}</span></span>` : ""}${note ? ` ${note}` : ""}</td>`;
  };
  return `<div class="matrix-wrap"><table class="matrix">
    <thead><tr><th></th>${opts.map(o => `<th scope="col" class="${col(o)}">${o.name}${rec === o.id ? `<span class="badge">Recommended</span>` : ""}${o.summary ? `<small>${o.summary}</small>` : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr class="${st(hC, sC, r.id)}"><th scope="row">${r.name}</th>${opts.map(o => cell(o, r)).join("")}</tr>`).join("")}</tbody>
  </table></div>${rec && D.why ? `<p class="rec-why"><b>Why ${(opts.find(o => o.id === rec) || {}).name || rec}:</b> ${D.why}</p>` : ""}${recap ? "" : panelLegend}`;
}

// Debugging: the case board lists every hypothesis raised so far with its state as of this step.
// Hypotheses not raised yet are left off (they would give the story away); the ones this step changes are lit.
const VERDICT = { open: ["?", "open"], "ruled-out": ["✗", "ruled out"], confirmed: ["✓", "confirmed"] };
const PHASE = { symptom: "Symptom", hypothesis: "Hypothesis", evidence: "Evidence", cause: "Root cause", fix: "Fix" };
function boardFor(i) {
  const state = {}, now = STEPS[i].verdicts || {};
  STEPS.slice(0, i + 1).forEach(t => Object.assign(state, t.verdicts || {}));
  const raised = HYPOTHESES.filter(h => h.id in state);
  if (!raised.length) return "";
  return `<div class="board"><b class="board-h">Hypotheses</b><ul>${raised.map(h => {
    const [sym, word] = VERDICT[state[h.id]] || VERDICT.open;
    return `<li class="v-${state[h.id]}${h.id in now ? " hl" : ""}"><span class="vs" aria-hidden="true">${sym}</span><span class="vt">${h.text}</span><span class="vw">${word}</span></li>`;
  }).join("")}</ul></div>`;
}
const evidenceHtml = e => `<figure class="evidence">${e.label ? `<figcaption>${e.label}</figcaption>` : ""}<pre><code>${codeHtml(e.text || "")}</code></pre></figure>`;

// Concept: layers stacked bottom-up (LAYERS[0] is the foundation). Each step adds one; later ones show their name only.
function stackFor(i) {
  const recap = i === LAST && N > 1, seen = seenBefore(i, t => t.layer), now = STEPS[i].layer;
  return `<div class="stack">${[...LAYERS].reverse().map(l => {
    const c = l.id === now ? "hl" : recap || seen.has(l.id) ? "" : "dim";
    return `<div class="layer ${c}"><b>${l.name}</b>${c === "dim" ? "" : `<span>${l.text || ""}</span>`}</div>`;
  }).join("")}</div>${recap ? "" : panelLegend}`;
}

// Before/after: a line diff (longest common subsequence) shown as aligned Before | After columns;
// narrow screens stack the two columns (CSS reorders the cells by --r).
function diffOps(a, b) {
  const A = a.split("\n"), B = b.split("\n"), L = A.map(() => new Array(B.length + 1).fill(0));
  L.push(new Array(B.length + 1).fill(0));
  for (let x = A.length - 1; x >= 0; x--) for (let y = B.length - 1; y >= 0; y--)
    L[x][y] = A[x] === B[y] ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
  const ops = []; let x = 0, y = 0;
  while (x < A.length || y < B.length) {
    if (x < A.length && y < B.length && A[x] === B[y]) { ops.push([" ", A[x++]]); y++; }
    else if (y < B.length && (x >= A.length || L[x][y + 1] >= L[x + 1][y])) ops.push(["+", B[y++]]);
    else ops.push(["-", A[x++]]);
  }
  return ops;
}
function diffHtml(d) {
  const rows = [], ops = diffOps(d.before || "", d.after || "");
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] === " ") { rows.push([["same", ops[k][1]], ["same", ops[k][1]]]); k++; continue; }
    const del = [], add = [];
    while (k < ops.length && ops[k][0] !== " ") (ops[k][0] === "-" ? del : add).push(ops[k++][1]);
    for (let j = 0; j < Math.max(del.length, add.length); j++)
      rows.push([j < del.length ? ["del", del[j]] : ["pad", ""], j < add.length ? ["add", add[j]] : ["pad", ""]]);
  }
  const c = (side, r, [k, t]) => `<code class="c ${side} ${k}" style="--r:${r}">${k === "del" ? "−" : k === "add" ? "+" : " "} ${esc(t) || " "}</code>`;
  const changed = ops.filter(o => o[0] !== " ").length;
  return `<div class="diff" role="group" aria-label="${d.label ? esc(d.label).replace(/"/g, "&quot;") + ": " : ""}before and after, ${changed} changed line${changed === 1 ? "" : "s"}">
    ${d.label ? `<div class="diff-label">${esc(d.label)}</div>` : ""}
    <div class="diff-grid"><b class="c L hd" style="--r:1">Before</b><b class="c R hd" style="--r:1">After</b>${rows.map(([l, r], j) => c("L", j + 2, l) + c("R", j + 2, r)).join("")}</div></div>`;
}
// The type's own panel for step i, drawn above any diagram/visual/code
function panelFor(i) {
  const s = STEPS[i];
  if (s.panel === false) return "";
  if (TYPE === "decision" && DECISION) return matrixFor(i);
  if (TYPE === "debugging" && HYPOTHESES.length) return boardFor(i);
  if (TYPE === "concept" && LAYERS.length) return stackFor(i);
  return "";
}

// Context card: the fixed questions a newcomer needs answered before the mechanism starts
const CTX = [["question", "The question"], ["setting", "Where this happens"], ["why", "Why it matters"],
  ["prereqs", "What you need to know first"], ["example", "The example we'll follow"]];
const contextHtml = c => `<dl class="ctx">${CTX.filter(([k]) => c[k] && c[k].length).map(([k, label]) => {
  const f = FULL_CTX.includes(k) ? ` class="full-only"` : "";
  return `<dt${f}>${label}</dt><dd${f}>${Array.isArray(c[k]) ? `<ul>${c[k].map(x => `<li>${x}</li>`).join("")}</ul>` : c[k]}</dd>`; }).join("")}</dl>`;
// On step 1 in the short version: what was left out, and a way back to the full one
const skippedN = FULL.filter(Boolean).length;
const depthNote = HAS_DEPTH ? `<p class="depth-note short-only">Short version: ${skippedN ? `${skippedN} background step${skippedN === 1 ? "" : "s"}` : "background"}${skippedN && FULL_CTX.length ? " and part of this card" : ""} left out.
  <button class="linkish" data-act="depth">Show the full version</button></p>` : "";
// Quiz options are shown shuffled, seeded by the question text so the order survives reloads.
// Buttons keep the original index in data-i, so `answer`, per-option `why` and saved results still line up.
function shuffled(n, seed) {
  let h = [...seed].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const idx = [...Array(n).keys()];
  for (let k = n - 1; k > 0; k--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const r = h % (k + 1); [idx[k], idx[r]] = [idx[r], idx[k]];
  }
  return idx;
}
// What-if control: one native radio group (choice) or range input (slider), so arrow keys and screen readers work as usual.
// Every option's outcome is rendered up front and only the picked one shown, so <dfn> tooltips work in all of them.
const attr = s => esc(String(s)).replace(/"/g, "&quot;");
function whatifHtml(i) {
  const w = STEPS[i].whatif, opts = wiOpts(STEPS[i]), name = `wi-${i}`;
  const ctl = w.control === "slider"
    ? `<input type="range" id="${name}" min="0" max="${opts.length - 1}" step="1" value="0" aria-label="${attr(plain(w.label))}">
       <div class="wi-ticks" aria-hidden="true" style="--n:${opts.length}">${opts.map((o, k) => `<span data-k="${k}">${o.label}</span>`).join("")}</div>`
    : `<div class="wi-opts">${opts.map(o => `<label><input type="radio" name="${name}" value="${attr(o.id)}"><span>${o.label}</span></label>`).join("")}</div>`;
  return `<fieldset class="whatif${w.control === "slider" ? " slider" : ""}" data-step="${i}"><legend><span class="wi-q">What if</span> ${w.label}</legend>
    ${ctl}${opts.map(o => `<div class="wi-out" data-wi="${attr(o.id)}" hidden>${o.outcome || ""}</div>`).join("")}</fieldset>`;
}
// Code lines carrying a "←" marker get the diagram's highlight colour
const codeHtml = c => esc(c).split("\n").map(l => `<span class="ln${l.includes("←") ? " hl-line" : ""}">${l || " "}</span>`).join("");

// "Still confused here": the reader says what's unclear and copies a prompt to paste back into Claude. Nothing is sent anywhere.
const stuckHtml = i => `<details class="stuck" data-step="${i}"><summary>Still confused here</summary>
  <label for="stuck-${i}">What's unclear? <span>(optional)</span></label>
  <textarea id="stuck-${i}" rows="2" placeholder="e.g. which part decides this, and why there?"></textarea>
  <div class="stuck-acts"><button class="primary" data-copy>Copy a prompt for Claude</button><span class="stuck-msg"></span></div>
  <textarea class="stuck-out" readonly hidden aria-label="Prompt to copy"></textarea></details>`;
// Before/after pages open with the two states side by side, under the big picture
const baHtml = TYPE === "before-after" && (META.before || META.after)
  ? `<div class="ba"><div><b>Before</b>${META.before || ""}</div><div><b>After</b>${META.after || ""}</div></div>` : "";
// A diagram wider than this would shrink its text below ~12px in the side column, so its steps go full width
const VIEWBOX = (DIAGRAM.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)/) || []).slice(1).map(Number);
const WIDE_DIAGRAM = (VIEWBOX[0] || 0) > 680;
// Its width over its height: a full-width diagram is capped in height, so this says how much width it really takes
const DIAGRAM_AR = VIEWBOX[1] ? Math.round(VIEWBOX[0] / VIEWBOX[1] * 1000) / 1000 : 0;
$("#stage").innerHTML = STEPS.map((s, i) => {
  // A decision table beside the text wraps its notes a word per line, so its steps go full width too,
  // unless a quiz needs the text column (under a full-width table it would fall off the screen)
  const recap = i === LAST && N > 1, panel = panelFor(i);
  const wide = s.wide || recap || !!s.diff || (TYPE === "decision" && !!panel && !s.quiz) || (!s.visual && !!(s.diagram || wiOpts(s).some(o => o.diagram)) && WIDE_DIAGRAM);
  // A what-if step whose options relight the diagram gets one copy per option; the picked one is shown
  const wiViews = !s.visual && DIAGRAM && wiOpts(s).some(o => o.diagram);
  const vis = s.visual || (wiViews ? wiOpts(s).map(o => `<div class="wi-view" data-wi="${attr(o.id)}" hidden>${diagramFor(i, diagramOf(s, o))}</div>`).join("")
    : s.diagram && DIAGRAM ? diagramFor(i) : "");
  const look = (panel ? `<div class="panel">${panel}</div>` : "") + (s.diff ? diffHtml(s.diff) : "") +
    (vis ? `<div class="visual">${vis}</div>` : "") + (s.code ? `<pre><code>${codeHtml(s.code)}</code></pre>` : "") +
    (s.evidence ? evidenceHtml(s.evidence) : "");
  const split = look && !wide;
  // A quiz under a full-width diagram pushes the step past the screen. The diagram is capped in height, so it leaves
  // width spare beside it, and the quiz goes there (the row wraps back to one column on a narrow screen)
  const beside = wide && !!s.quiz && !s.visual && !!vis && WIDE_DIAGRAM && !!DIAGRAM_AR && !panel && !s.diff;
  const quiz = s.quiz ? `<div class="quiz" data-step="${i}" data-answer="${s.quiz.answer}"><p>${s.quiz.q}</p>
          <div class="opts">${shuffled(s.quiz.options.length, s.quiz.q).map(j => { const o = s.quiz.options[j];
            return `<button data-i="${j}">${typeof o === "string" ? o : o.t}</button>`; }).join("")}</div>
          <div class="retry">Not quite, one more try.</div>
          <div class="why"><span class="verdict"></span> ${s.quiz.why || ""}</div></div>` : "";
  return `
  <article class="step${split ? " split" : ""}${wide ? " wide" : ""}${FULL[i] ? " full-only" : ""}" id="step-${i + 1}" aria-labelledby="h-${i}">
    ${i === 0 ? `<div class="bigpic"><b>Big picture</b>${esc(META.bigPicture || "")}</div>${baHtml}` : ""}
    <div class="eyebrow">Step <span class="pos">${i + 1}</span> of <span class="tot">${N}</span>${FULL[i] ? ` · <span class="bg-tag">Background</span>` : ""}${s.phase && PHASE[s.phase] ? ` · <span class="phase ph-${s.phase}">${PHASE[s.phase]}</span>` : ""}</div>
    <h2 id="h-${i}" tabindex="-1">${s.title}</h2>
    <div class="cols">
      <div class="read">
        ${i === 0 ? depthNote : ""}
        ${s.context ? contextHtml(s.context) : ""}
        <div class="body">${s.body || ""}</div>
        ${s.analogy ? `<div class="analogy"><span>${s.analogy}</span></div>` : ""}
        ${wiOpts(s).length ? whatifHtml(i) : ""}
        ${wide && look ? beside ? `<div class="beside"><div class="look" style="--ar:${DIAGRAM_AR}">${look}</div>${quiz}</div>` : `<div class="look">${look}</div>` : ""}
        ${recap ? `<ol class="recap-list">${STEPS.slice(0, LAST).map((t, j) => `<li${FULL[j] ? ` class="full-only"` : ""}><button data-go="${j}">
          <span class="n">${j + 1}</span><span><b>${t.title}</b>${t.summary ? ` <span class="s">— ${t.summary}</span>` : ""}</span>
          <span class="mk" data-mk="${j}"></span></button></li>`).join("")}</ol>` : ""}
        ${s.deeper ? `<details><summary>Go deeper</summary>${s.deeper}</details>` : ""}
        ${beside ? "" : quiz}
        ${stuckHtml(i)}
        ${recap ? `<section class="finish" aria-label="Finished">
          <h3>You made it to the end</h3><p id="score"></p>
          <div class="acts"><button class="primary" data-finish="restart">↺ Start over</button>
          <button data-finish="all">Review all steps</button>
          ${terms.length || cast.length ? `<button data-finish="gloss">Open glossary</button>` : ""}</div></section>` : ""}
      </div>
      ${split ? `<div class="look">${look}</div>` : ""}
    </div>
  </article>`;
}).join("");

// Glossary: tooltips that stay on-screen, plus a drawer
const tip = $("#tip");
// Shown under (or above) the element, kept inside the window. A diagram part's tip names the part first.
let tipFor = null;
function showTip(el, text, name) {
  tipFor = el; el.setAttribute("aria-describedby", "tip");
  tip.replaceChildren(...(name ? [Object.assign(document.createElement("b"), { textContent: name }), " "] : []), text);
  tip.classList.add("on");
  // A diagram part is placed by its box or label: a sequence node's group also holds its lifeline, which runs to the bottom
  const r = (el.matches("[data-def]") && el.querySelector(".box, .label-bg") || el).getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  tip.style.top = (r.bottom + h + 12 > innerHeight ? r.top - h - 6 : r.bottom + 6) + "px";
}
function hideTip(el) {
  if (el && el !== tipFor) return;
  tip.classList.remove("on"); if (tipFor) tipFor.removeAttribute("aria-describedby"); tipFor = null;
}
$$("dfn").forEach(d => {
  const text = findTerm(d); if (!text) { console.warn("No glossary entry for <dfn>", d.textContent); return; }
  d.tabIndex = 0;
  const show = () => showTip(d, text), hide = () => hideTip(d);
  d.addEventListener("mouseenter", show); d.addEventListener("focus", show);
  d.addEventListener("mouseleave", hide); d.addEventListener("blur", hide);
});
// Diagram parts: a click (or focus, or Enter) shows the definition; it stays until focus moves on
$$(".visual [data-def]").forEach(g => {
  const show = () => showTip(g, lookup(g.dataset.def), g.dataset.def);
  g.addEventListener("click", e => { e.stopPropagation(); g.focus({ preventScroll: true }); show(); });
  g.addEventListener("focus", show); g.addEventListener("blur", () => hideTip(g));
  g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); } });
});
document.addEventListener("click", e => { if (tipFor && tipFor.matches("[data-def]") && !tipFor.contains(e.target)) hideTip(); });
const dl = (keys, src) => "<dl>" + keys.map(t => `<dt>${t}</dt><dd>${src[t]}</dd>`).join("") + "</dl>";
$("#gloss").innerHTML = `<div class="dhead"><h2>Glossary</h2><button class="x" data-close aria-label="Close glossary">×</button></div>` +
  (cast.length ? `<h3>Who's who</h3>${dl(cast, CAST)}` : "") +
  (terms.length ? `${cast.length ? "<h3>Terms</h3>" : ""}${dl(terms, GLOSSARY)}` : "") +
  (terms.length || cast.length ? "" : "<p>No terms.</p>");
if (!terms.length && !cast.length) $$('[data-act="gloss"]').forEach(b => b.hidden = true);

// Panels and modes: every [data-act] button has a twin (top bar on desktop, ☰ menu on phones)
let opener = null;   // what had focus before a drawer opened, so closing returns there
function setMode(cls, on) {
  const was = document.body.classList.contains(cls);
  on = document.body.classList.toggle(cls, on);
  $$(`[data-act="${cls}"]`).forEach(b => b.setAttribute("aria-pressed", on));
  if (cls === "menu") $("#menu").setAttribute("aria-expanded", on);
  if (cls === "gloss" || cls === "menu") {
    const panel = cls === "gloss" ? $("#gloss") : $("#side");
    if (on && !was) {
      opener = document.activeElement;
      if (cls === "menu") { panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); }
      panel.querySelector(".x").focus({ preventScroll: true });
    } else if (!on && was) {
      if (cls === "menu") { panel.removeAttribute("role"); panel.removeAttribute("aria-modal"); }
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      opener = null;
    }
  }
  if (cls === "all") $$('[data-act="all"]').forEach(b => b.textContent = on ? "Step mode" : "Show all");
  return on;
}
const closePanels = () => { setMode("gloss", false); setMode("menu", false); };
$$("[data-close]").forEach(b => b.onclick = closePanels);
$("#menu").onclick = () => { setMode("gloss", false); setMode("menu"); };

// Theme: follows the OS until the reader picks one; the choice is remembered
const root = document.documentElement, osDark = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (root.dataset.theme || (osDark.matches ? "dark" : "light")) === "dark";
function paintTheme() {
  const label = isDark() ? "Switch to light mode" : "Switch to dark mode";
  $$('[data-act="theme"]').forEach(b => {
    b.textContent = b.hasAttribute("data-long") ? (isDark() ? "☀ Light mode" : "☾ Dark mode") : (isDark() ? "☀" : "☾");
    b.title = label; b.setAttribute("aria-label", label);
  });
}
osDark.addEventListener("change", paintTheme);
paintTheme();

$$("[data-act]").forEach(b => b.onclick = () => {
  const act = b.dataset.act;
  if (act === "theme") {
    root.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("explain-theme", root.dataset.theme); } catch (e) {}
    return paintTheme();
  }
  if (act === "gloss") { setMode("menu", false); return setMode("gloss"); }
  if (act === "depth") return setDepth(!short);
  if (act === "all") { closePanels(); setMode("all"); go(cur, { push: false }); }
});

// Quiz: one retry before the answer is revealed; results feed the sidebar marks and the final score
const quizzes = $$(".quiz");
function paintQuiz(q) {
  const st = results[q.dataset.step] || { picked: [] }, ans = +q.dataset.answer;
  q.querySelectorAll(".opts button").forEach(b => {
    const j = +b.dataset.i, picked = st.picked.includes(j);
    b.classList.toggle("right", (picked || !!st.res) && j === ans);
    b.classList.toggle("wrong", picked && j !== ans);
    b.disabled = !!st.res || picked;
  });
  q.classList.toggle("answered", !!st.res);
  q.classList.toggle("ok", st.res === "ok"); q.classList.toggle("miss", st.res === "miss");
  q.classList.toggle("retrying", !st.res && st.picked.length > 0);
  q.querySelector(".verdict").textContent = st.res === "ok" ? "Right." : st.res === "miss" ? "Not this time." : "";
  // Retry hint: if the picked option carries its own `why`, say why THAT answer is wrong
  const last = st.picked[st.picked.length - 1], o = last == null ? null : STEPS[q.dataset.step].quiz.options[last];
  q.querySelector(".retry").innerHTML = o && o.why ? `Not quite. ${o.why} One more try.` : "Not quite, one more try.";
}
quizzes.forEach(q => q.addEventListener("click", e => {
  const b = e.target.closest(".opts button"); if (!b || b.disabled) return;
  const i = q.dataset.step, j = +b.dataset.i, ans = +q.dataset.answer, total = q.querySelectorAll(".opts button").length;
  const st = results[i] = results[i] || { picked: [] };
  st.picked.push(j);
  if (j === ans) st.res = "ok";
  else if (st.picked.length >= 2 || total - st.picked.length <= 1) st.res = "miss";
  paintQuiz(q); paintMarks(); save();
  // Screen readers hear the explanation too, not just right/wrong
  $("#live").textContent = (st.res ? q.querySelector(".why") : q.querySelector(".retry")).textContent.replace(/\s+/g, " ").trim();
}));
function paintMarks() {
  const mark = (el, i) => {
    const r = results[i] && results[i].res;
    el.textContent = r === "ok" ? "✓" : r === "miss" ? "?" : "";
    el.className = "mk" + (r ? " " + r : "");
    el.title = r === "ok" ? "Check answered correctly" : r === "miss" ? "Check missed: worth revisiting" : "";
  };
  $$("#outline .mk").forEach((el, i) => mark(el, i));
  $$("[data-mk]").forEach(el => mark(el, el.dataset.mk));
  const score = $("#score"); if (!score) return;
  const withQuiz = STEPS.map((s, i) => s.quiz && shown(i) ? i : -1).filter(i => i >= 0);
  const ok = withQuiz.filter(i => results[i] && results[i].res === "ok");
  const missed = withQuiz.filter(i => results[i] && results[i].res === "miss");
  const left = withQuiz.length - ok.length - missed.length;
  score.innerHTML = !withQuiz.length ? "That's the whole picture."
    : `You got <b>${ok.length} of ${withQuiz.length}</b> checks right.` +
      (missed.length ? ` Worth another look: ${missed.map(i => `<a href="#step-${i + 1}" data-go="${i}">${STEPS[i].title}</a>`).join(", ")}.` : "") +
      (left ? ` ${left} still unanswered.` : "");
}

// The prompt carries what the page said at this step, so Claude can answer without the page open.
// It names no file path: a page's location can hold a user name.
function stuckPrompt(i, unclear) {
  const s = STEPS[i], r = results[i];
  // Only terms the reader can see: not a hidden what-if outcome, nor a Context row the Short version hides
  const used = [...new Set($$(`#step-${i + 1} .read dfn`).filter(d => !d.closest("[hidden]") && !(short && d.closest(".full-only:not(.step)"))).map(d => (d.dataset.term || d.textContent).trim()))]
    .map(t => [t, findTerm({ dataset: {}, textContent: t })]).filter(([, d]) => d);
  const lines = [
    `I'm reading an explainer page, "${plain(META.title)}", and I'm stuck on step ${pos(i)} of ${total()}: "${plain(s.title)}".`, "",
    `The page's big picture: ${plain(META.bigPicture)}`, "",
    "What this step says:",
    ...(s.summary ? [`- In short: ${plain(s.summary)}`] : []),
    ...(s.context ? [["question", "The question"], ["setting", "Where this happens"], ["why", "Why it matters"], ["example", "The example"]]
      .filter(([k]) => s.context[k] && !(short && FULL_CTX.includes(k))).map(([k, name]) => `- ${name}: ${plain(s.context[k])}`) : []),
    `- ${plain(s.body) || "(no text)"}`,
    ...(s.analogy ? [`- Analogy: ${plain(s.analogy)}`] : []),
    ...wiOpts(s).filter(o => o.id === picked(i)).map(o => `- I set its "What if ${plain(s.whatif.label)}" control to "${plain(o.label)}", which shows: ${plain(o.outcome)}`),
    ...(used.length ? ["", "Terms it uses, as the page defines them:", ...used.map(([t, d]) => `- ${t}: ${plain(d)}`)] : []),
  ];
  if (r && r.res === "miss" && s.quiz) {
    const o = s.quiz.options[s.quiz.answer];
    lines.push("", `I got this step's check wrong. Question: "${plain(s.quiz.q)}" The answer is "${plain(typeof o === "string" ? o : o.t)}".`);
  }
  lines.push("", `What's unclear to me: ${unclear.trim() || "I can't say exactly; the step as a whole doesn't click."}`, "",
    "Explain this step another way. Start from what I said is unclear, use a concrete example, and don't repeat the page's wording. " +
    "If the page skips something I'd need, or gets something wrong, say so.");
  return lines.join("\n");
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
  // Some browsers give a file:// page no clipboard API; the old copy command still works from a click
  const ta = Object.assign(document.createElement("textarea"), { value: t, readOnly: true });
  ta.style.cssText = "position:fixed;top:0;opacity:0"; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
  ta.remove(); return ok;
}
$$(".stuck").forEach(box => box.querySelector("[data-copy]").addEventListener("click", async e => {
  const btn = e.currentTarget, msg = box.querySelector(".stuck-msg"), out = box.querySelector(".stuck-out");
  const text = stuckPrompt(+box.dataset.step, box.querySelector("textarea").value);
  const ok = await copyText(text);
  btn.focus({ preventScroll: true });
  out.value = text; out.hidden = ok;   // copy failed: show the prompt, selected, to copy by hand
  msg.textContent = ok ? "Copied. Paste it into your chat with Claude." : "Couldn't copy. Select the text below and copy it.";
  if (!ok) out.select();
  $("#live").textContent = msg.textContent;
}));

// What-if: picking an option shows its outcome and its diagram, remembers the choice and announces the outcome
const picked = i => (wiOpts(STEPS[i]).find(o => o.id === choices[i]) || wiOpts(STEPS[i])[0] || {}).id;
function paintChoice(i, announce) {
  const s = STEPS[i], f = $(`#step-${i + 1} .whatif`); if (!f) return;
  const id = picked(i), k = wiOpts(s).findIndex(o => o.id === id), o = wiOpts(s)[k];
  $$(`#step-${i + 1} [data-wi]`).forEach(el => el.hidden = el.dataset.wi !== id);
  const r = f.querySelector("input[type=range]");
  if (r) { r.value = k; r.setAttribute("aria-valuetext", plain(o.label)); f.querySelectorAll(".wi-ticks span").forEach(t => t.classList.toggle("on", +t.dataset.k === k)); }
  else f.querySelectorAll("input[type=radio]").forEach(x => x.checked = x.value === id);
  if (announce) $("#live").textContent = `${plain(o.label)}: ${plain(o.outcome)}`;
}
$$(".whatif").forEach(f => {
  const i = +f.dataset.step, opts = wiOpts(STEPS[i]);
  const pick = (id, announce = true) => { choices[i] = id; paintChoice(i, announce); save(); };
  f.addEventListener("change", e => { if (e.target.type === "radio") pick(e.target.value); });
  f.addEventListener("input", e => { if (e.target.type === "range") pick(opts[+e.target.value].id); });
  // The tick labels under a slider are clickable too; the slider itself stays the keyboard and screen-reader control
  f.querySelectorAll(".wi-ticks span").forEach(t => t.onclick = () => { pick(opts[+t.dataset.k].id); f.querySelector("input[type=range]").focus({ preventScroll: true }); });
  paintChoice(i, false);
});

// Stepper
$("#outline").innerHTML = STEPS.map((s, i) => `<li${FULL[i] ? ` class="full-only"` : ""}><button data-i="${i}"><span class="n">${i + 1}</span><span class="t">${s.title}${s.phase && PHASE[s.phase] ? `<span class="ph ph-${s.phase}">${PHASE[s.phase]}</span>` : ""}</span><span class="mk"></span></button></li>`).join("");
const items = $$("#outline button"), arts = $$(".step"), stage = $("#stage");
const isAll = () => document.body.classList.contains("all");

// Update every "where am I" indicator without moving the page
function mark(i) {
  cur = i; seen.add(cur);
  document.body.classList.toggle("first", cur === 0);
  items.forEach((d, j) => {
    d.classList.toggle("cur", j === cur); d.classList.toggle("done", seen.has(j) && j !== cur);
    if (j === cur) d.setAttribute("aria-current", "step"); else d.removeAttribute("aria-current");
  });
  items[cur].scrollIntoView({ block: "nearest" });
  $("#bar").style.width = (pos(cur) / total() * 100) + "%";
  $("#count").textContent = `${pos(cur)} / ${total()}`;
  paintNav();
  save();
}
// Build stage b of the current step: parts with data-b > b stay hidden until revealed (Show all / print show everything)
let b = 0;
function paintBuild() {
  // In Show all every step is on screen, so a step left halfway through its stages is shown whole too
  (isAll() ? stage : arts[cur]).querySelectorAll("[data-b]").forEach(el => el.classList.toggle("pend", !isAll() && +el.dataset.b > b));
}
function paintNav() {
  const K = isAll() ? 0 : buildStages[cur], building = b < K;
  $("#prev").classList.toggle("gone", cur === 0 && b === 0);
  $("#prev").disabled = cur === 0 && b === 0;
  const last = cur === LAST, next = STEPS[nextShown(cur, 1)];
  $("#next .lbl").textContent = building ? "Reveal ▸" : last ? "Finish ✓" : "Next →";
  $("#next .sub").textContent = building ? `part ${b + 1} of ${K}` : last ? "See your summary" : next.title;
  $("#upnext").innerHTML = building ? `Reveal part ${b + 1} of ${K} <span class="keys">· <kbd>→</kbd></span>`
    : last ? "Last step: your summary is below" : `Next: ${next.title} <span class="keys">· <kbd>←</kbd> <kbd>→</kbd></span>`;
}
// Forward/back first walk through a step's build stages, then move between steps
function fwd(viaKey) {
  if (!isAll() && b < buildStages[cur]) { b++; paintBuild(); paintNav(); $("#live").textContent = `Revealed part ${b} of ${buildStages[cur]}`; return; }
  if (cur < LAST) return go(nextShown(cur, 1));
  if (viaKey) return;
  const f = $(".finish"); if (f) { f.scrollIntoView({ behavior: "smooth" }); f.querySelector("button").focus({ preventScroll: true }); }
}
function back() {
  if (!isAll() && b > 0) { b--; paintBuild(); paintNav(); return; }
  if (cur > 0) go(nextShown(cur, -1), { build: "full" });
}
let spyPaused = 0;
function go(i, { push = true, build = 0 } = {}) {
  i = Math.max(0, Math.min(LAST, i));
  if (!shown(i)) i = nextShown(i, 1);   // a link to a skipped step lands on the next one the reader walks
  const moved = i !== cur;
  if (moved) stage.style.setProperty("--dx", i > cur ? "14px" : "-14px");   // slide in from the direction of travel
  b = build === "full" ? buildStages[i] : 0;
  mark(i);
  arts.forEach((a, j) => a.classList.toggle("active", j === cur));
  paintBuild();
  if (isAll()) { spyPaused = Date.now() + 800; arts[cur].scrollIntoView({ behavior: "smooth" }); }
  else stage.scrollTop = 0;
  try { history[push && moved ? "pushState" : "replaceState"](null, "", "#step-" + (cur + 1)); } catch (e) {}
  if (moved) hideTip();
  if (moved) $("#live").textContent = `Step ${pos(cur)} of ${total()}: ${STEPS[cur].title}`;
  setMode("menu", false);
}
items.forEach((d, i) => d.onclick = () => { go(i); $(`#h-${i}`).focus({ preventScroll: true }); });
$("#prev").onclick = () => back();
$("#next").onclick = () => fwd();
stage.addEventListener("click", e => {
  const g = e.target.closest("[data-go]");
  if (g) { e.preventDefault(); if (isAll()) setMode("all", false); go(+g.dataset.go); return; }
  const f = e.target.closest("[data-finish]"); if (!f) return;
  if (f.dataset.finish === "restart") { results = {}; choices = {}; seen = new Set(); STEPS.forEach((_, j) => paintChoice(j)); quizzes.forEach(paintQuiz); paintMarks(); setMode("all", false); go(0); }
  if (f.dataset.finish === "all") { setMode("all", true); go(0); }
  if (f.dataset.finish === "gloss") setMode("gloss", true);
});

// "Show all": the sidebar and counter follow the scroll position
stage.addEventListener("scroll", () => {
  if (!isAll() || Date.now() < spyPaused) return;
  const atEnd = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4;
  let i = 0; arts.forEach((a, j) => { if (shown(j) && a.offsetTop - stage.scrollTop <= 120) i = j; });
  if (atEnd) i = LAST;
  if (i !== cur) { mark(i); try { history.replaceState(null, "", "#step-" + (i + 1)); } catch (e) {} }
}, { passive: true });

stage.addEventListener("scroll", () => { if (tipFor && tipFor.matches("[data-def]")) showTip(tipFor, lookup(tipFor.dataset.def), tipFor.dataset.def); }, { passive: true });

// Browser Back/Forward move between steps
addEventListener("popstate", () => { const m = location.hash.match(/step-(\d+)/); go(m ? +m[1] - 1 : 0, { push: false }); });

// Swipe left/right on phones (ignored on diagrams and code, which scroll sideways, and on a what-if slider)
let touch = null;
stage.addEventListener("touchstart", e => {
  touch = e.target.closest(".visual, pre, .whatif") || isAll() ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
stage.addEventListener("touchend", e => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y; touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) { if (dx < 0) fwd(true); else back(); }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") { if (tipFor) { const t = tipFor; hideTip(); if (t.matches("[data-def]")) t.blur(); } return closePanels(); }
  if (e.target.matches("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.body.classList.contains("gloss") || document.body.classList.contains("menu")) return;   // a drawer is open: don't navigate behind it
  const sc = e.target.closest && e.target.closest(".visual, pre");
  if (sc && sc.scrollWidth > sc.clientWidth) return;   // let ←/→ scroll a wide diagram or code block
  if (e.key === "ArrowRight") fwd(true);
  if (e.key === "ArrowLeft") back();
});

// Depth switch: renumber what the reader walks, and leave a skipped step if we were on one
function paintDepth() {
  document.body.classList.toggle("short", short);
  $$('.tbtn[data-act="depth"]').forEach(b => { b.hidden = !HAS_DEPTH; b.setAttribute("aria-pressed", short);
    b.title = short ? "Showing the short version: background steps are skipped" : "Skip the background steps"; });
  arts.forEach((a, i) => { a.querySelector(".pos").textContent = pos(i) || i + 1; a.querySelector(".tot").textContent = total(); });
  const n = (el, i) => { if (shown(i)) el.textContent = pos(i); };
  $$("#outline .n").forEach(n); $$(".recap-list .n").forEach(n);
}
function setDepth(on) {
  short = HAS_DEPTH && on;
  try { localStorage.setItem("explain-depth", short ? "short" : "full"); } catch (e) {}
  paintDepth(); paintMarks();
  const at = shown(cur) ? cur : nextShown(cur, -1);
  go(at, { push: false, build: at === cur ? b : 0 });
  $("#live").textContent = short ? `Short version: ${total()} of ${N} steps` : `Full version: all ${N} steps`;
}
paintDepth();

quizzes.forEach(paintQuiz); paintMarks();
const m = location.hash.match(/step-(\d+)/);
cur = -1; go(m ? +m[1] - 1 : Math.min(saved.cur || 0, LAST), { push: false });
})(
  typeof META === "object" ? META : null,
  typeof CAST === "object" && CAST ? CAST : {},
  typeof GLOSSARY === "object" && GLOSSARY ? GLOSSARY : {},
  // A spec DIAGRAM ({ layout, nodes, edges }) was laid out by build.mjs into the #explain-diagram template
  typeof DIAGRAM === "string" ? DIAGRAM : (document.getElementById("explain-diagram") || {}).innerHTML || "",
  typeof STEPS !== "undefined" ? STEPS : null,
  typeof DECISION === "object" && DECISION ? DECISION : null,
  typeof HYPOTHESES !== "undefined" && Array.isArray(HYPOTHESES) ? HYPOTHESES : [],
  typeof LAYERS !== "undefined" && Array.isArray(LAYERS) ? LAYERS : [],
);
