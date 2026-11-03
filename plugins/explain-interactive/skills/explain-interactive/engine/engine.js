/* explain-interactive engine: renders a step-by-step explainer from the page's content.
   The content script (inlined before this one by build.mjs) declares META, CAST, GLOSSARY, DIAGRAM and STEPS.
   Don't edit pages by hand: change the content file and rebuild. Field reference: SKILL.md. */
((META, CAST, GLOSSARY, DIAGRAM, STEPS) => {
if (!META || !Array.isArray(STEPS) || !STEPS.length) {
  document.getElementById("stage").textContent = "This page has no content: META and STEPS are missing (rebuild it from its content file).";
  return;
}
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const N = STEPS.length, LAST = N - 1;
const terms = Object.keys(GLOSSARY), cast = Object.keys(CAST);
document.title = META.title;
$("#title").textContent = META.title;
$$(".bigpic-text").forEach(e => e.textContent = META.bigPicture);

// Saved progress (visited steps, quiz answers, last step) — per page, in this browser only
const KEY = "explain-progress:" + location.pathname + ":" + META.title;
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
let results = saved.results || {}, maxSeen = saved.maxSeen || 0, cur = 0;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ cur, maxSeen, results })); } catch (e) {} };

// Shared diagram: clone DIAGRAM for step i. New parts get .hl, parts not introduced yet are ghosted (.dim), the Recap shows all.
const buildStages = STEPS.map(s => Math.max(s.build || 0, ((s.diagram || {}).build || []).length));
function diagramFor(i) {
  const d = STEPS[i].diagram || {}, recap = i === LAST && N > 1;
  const seen = new Set(); STEPS.slice(0, i).forEach(t => ((t.diagram || {}).hl || []).forEach(x => seen.add(x)));
  const hl = new Set(d.hl || []), hide = new Set(d.hide || []), dim = new Set(d.dim || []);
  const box = document.createElement("div"); box.innerHTML = DIAGRAM;
  box.querySelectorAll("[data-id]").forEach(el => {
    const id = el.dataset.id;
    if (hide.has(id)) el.classList.add("hidden");
    else if (hl.has(id)) el.classList.add("hl");
    else if (dim.has(id) || (!recap && !seen.has(id))) el.classList.add("dim");
    (d.build || []).forEach((stage, n) => { if ([].concat(stage).includes(id)) el.setAttribute("data-b", n + 1); });
  });
  return box.innerHTML + (recap ? "" : `<div class="legend"><span><i class="new"></i>new in this step</span><span><i></i>already introduced</span><span><i class="soon"></i>coming later</span></div>`);
}
// Context card: the fixed questions a newcomer needs answered before the mechanism starts
const CTX = [["question", "The question"], ["setting", "Where this happens"], ["why", "Why it matters"],
  ["prereqs", "What you need to know first"], ["example", "The example we'll follow"]];
const contextHtml = c => `<dl class="ctx">${CTX.filter(([k]) => c[k] && c[k].length).map(([k, label]) =>
  `<dt>${label}</dt><dd>${Array.isArray(c[k]) ? `<ul>${c[k].map(x => `<li>${x}</li>`).join("")}</ul>` : c[k]}</dd>`).join("")}</dl>`;
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
// Code lines carrying a "←" marker get the diagram's highlight colour
const codeHtml = c => esc(c).split("\n").map(l => `<span class="ln${l.includes("←") ? " hl-line" : ""}">${l || " "}</span>`).join("");

$("#stage").innerHTML = STEPS.map((s, i) => {
  const recap = i === LAST && N > 1, wide = s.wide || recap;
  const vis = s.visual || (s.diagram && DIAGRAM ? diagramFor(i) : "");
  const look = (vis ? `<div class="visual">${vis}</div>` : "") + (s.code ? `<pre><code>${codeHtml(s.code)}</code></pre>` : "");
  const split = look && !wide;
  return `
  <article class="step${split ? " split" : ""}${wide ? " wide" : ""}" id="step-${i + 1}" aria-labelledby="h-${i}">
    ${i === 0 ? `<div class="bigpic"><b>Big picture</b>${esc(META.bigPicture)}</div>` : ""}
    <div class="eyebrow">Step ${i + 1} of ${N}</div>
    <h2 id="h-${i}" tabindex="-1">${s.title}</h2>
    <div class="cols">
      <div class="read">
        ${s.context ? contextHtml(s.context) : ""}
        <div class="body">${s.body || ""}</div>
        ${s.analogy ? `<div class="analogy"><span>${s.analogy}</span></div>` : ""}
        ${wide && look ? `<div class="look">${look}</div>` : ""}
        ${recap ? `<ol class="recap-list">${STEPS.slice(0, LAST).map((t, j) => `<li><button data-go="${j}">
          <span class="n">${j + 1}</span><span><b>${t.title}</b>${t.summary ? ` <span class="s">— ${t.summary}</span>` : ""}</span>
          <span class="mk" data-mk="${j}"></span></button></li>`).join("")}</ol>` : ""}
        ${s.deeper ? `<details><summary>Go deeper</summary>${s.deeper}</details>` : ""}
        ${s.quiz ? `<div class="quiz" data-step="${i}" data-answer="${s.quiz.answer}"><p>${s.quiz.q}</p>
          <div class="opts">${shuffled(s.quiz.options.length, s.quiz.q).map(j => { const o = s.quiz.options[j];
            return `<button data-i="${j}">${typeof o === "string" ? o : o.t}</button>`; }).join("")}</div>
          <div class="retry">Not quite, one more try.</div>
          <div class="why"><span class="verdict"></span> ${s.quiz.why}</div></div>` : ""}
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
const GL = Object.fromEntries([...cast.map(t => [t.toLowerCase(), CAST[t]]), ...terms.map(t => [t.toLowerCase(), GLOSSARY[t]])]);
// <dfn data-term="token">tokens</dfn> names the entry explicitly; otherwise the text, then its singular, is looked up
const findTerm = d => { const k = (d.dataset.term || d.textContent).trim().toLowerCase(); return GL[k] ?? GL[k.replace(/(es|s)$/, "")] ?? GL[k.replace(/s$/, "")]; };
$$("dfn").forEach(d => {
  const text = findTerm(d); if (!text) { console.warn("No glossary entry for <dfn>", d.textContent); return; }
  d.tabIndex = 0;
  const show = () => {
    d.setAttribute("aria-describedby", "tip");
    tip.textContent = text; tip.classList.add("on");
    const r = d.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
    tip.style.top = (r.bottom + h + 12 > innerHeight ? r.top - h - 6 : r.bottom + 6) + "px";
  };
  const hide = () => { tip.classList.remove("on"); d.removeAttribute("aria-describedby"); };
  d.addEventListener("mouseenter", show); d.addEventListener("focus", show);
  d.addEventListener("mouseleave", hide); d.addEventListener("blur", hide);
});
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
  const withQuiz = STEPS.map((s, i) => s.quiz ? i : -1).filter(i => i >= 0);
  const ok = withQuiz.filter(i => results[i] && results[i].res === "ok");
  const missed = withQuiz.filter(i => results[i] && results[i].res === "miss");
  const left = withQuiz.length - ok.length - missed.length;
  score.innerHTML = !withQuiz.length ? "That's the whole picture."
    : `You got <b>${ok.length} of ${withQuiz.length}</b> checks right.` +
      (missed.length ? ` Worth another look: ${missed.map(i => `<a href="#step-${i + 1}" data-go="${i}">${STEPS[i].title}</a>`).join(", ")}.` : "") +
      (left ? ` ${left} still unanswered.` : "");
}

// Stepper
$("#outline").innerHTML = STEPS.map((s, i) => `<li><button data-i="${i}"><span class="n">${i + 1}</span><span class="t">${s.title}</span><span class="mk"></span></button></li>`).join("");
const items = $$("#outline button"), arts = $$(".step"), stage = $("#stage");
const isAll = () => document.body.classList.contains("all");

// Update every "where am I" indicator without moving the page
function mark(i) {
  cur = i; maxSeen = Math.max(maxSeen, cur);
  document.body.classList.toggle("first", cur === 0);
  items.forEach((d, j) => {
    d.classList.toggle("cur", j === cur); d.classList.toggle("done", j <= maxSeen && j !== cur);
    if (j === cur) d.setAttribute("aria-current", "step"); else d.removeAttribute("aria-current");
  });
  items[cur].scrollIntoView({ block: "nearest" });
  $("#bar").style.width = ((cur + 1) / N * 100) + "%";
  $("#count").textContent = `${cur + 1} / ${N}`;
  paintNav();
  save();
}
// Build stage b of the current step: parts with data-b > b stay hidden until revealed (Show all / print show everything)
let b = 0;
function paintBuild() {
  arts[cur].querySelectorAll("[data-b]").forEach(el => el.classList.toggle("pend", !isAll() && +el.dataset.b > b));
}
function paintNav() {
  const K = isAll() ? 0 : buildStages[cur], building = b < K;
  $("#prev").classList.toggle("gone", cur === 0 && b === 0);
  $("#prev").disabled = cur === 0 && b === 0;
  const last = cur === LAST, next = STEPS[cur + 1];
  $("#next .lbl").textContent = building ? "Reveal ▸" : last ? "Finish ✓" : "Next →";
  $("#next .sub").textContent = building ? `part ${b + 1} of ${K}` : last ? "See your summary" : next.title;
  $("#upnext").innerHTML = building ? `Reveal part ${b + 1} of ${K} <span class="keys">· <kbd>→</kbd></span>`
    : last ? "Last step: your summary is below" : `Next: ${next.title} <span class="keys">· <kbd>←</kbd> <kbd>→</kbd></span>`;
}
// Forward/back first walk through a step's build stages, then move between steps
function fwd(viaKey) {
  if (!isAll() && b < buildStages[cur]) { b++; paintBuild(); paintNav(); $("#live").textContent = `Revealed part ${b} of ${buildStages[cur]}`; return; }
  if (cur < LAST) return go(cur + 1);
  if (viaKey) return;
  const f = $(".finish"); if (f) { f.scrollIntoView({ behavior: "smooth" }); f.querySelector("button").focus({ preventScroll: true }); }
}
function back() {
  if (!isAll() && b > 0) { b--; paintBuild(); paintNav(); return; }
  if (cur > 0) go(cur - 1, { build: "full" });
}
let spyPaused = 0;
function go(i, { push = true, build = 0 } = {}) {
  i = Math.max(0, Math.min(LAST, i));
  const moved = i !== cur;
  if (moved) stage.style.setProperty("--dx", i > cur ? "14px" : "-14px");   // slide in from the direction of travel
  b = build === "full" ? buildStages[i] : 0;
  mark(i);
  arts.forEach((a, j) => a.classList.toggle("active", j === cur));
  paintBuild();
  if (isAll()) { spyPaused = Date.now() + 800; arts[cur].scrollIntoView({ behavior: "smooth" }); }
  else stage.scrollTop = 0;
  try { history[push && moved ? "pushState" : "replaceState"](null, "", "#step-" + (cur + 1)); } catch (e) {}
  if (moved) $("#live").textContent = `Step ${cur + 1} of ${N}: ${STEPS[cur].title}`;
  setMode("menu", false);
}
items.forEach((d, i) => d.onclick = () => { go(i); $(`#h-${i}`).focus({ preventScroll: true }); });
$("#prev").onclick = () => back();
$("#next").onclick = () => fwd();
stage.addEventListener("click", e => {
  const g = e.target.closest("[data-go]");
  if (g) { e.preventDefault(); if (isAll()) setMode("all", false); go(+g.dataset.go); return; }
  const f = e.target.closest("[data-finish]"); if (!f) return;
  if (f.dataset.finish === "restart") { results = {}; maxSeen = 0; quizzes.forEach(paintQuiz); paintMarks(); setMode("all", false); go(0); }
  if (f.dataset.finish === "all") { setMode("all", true); go(0); }
  if (f.dataset.finish === "gloss") setMode("gloss", true);
});

// "Show all": the sidebar and counter follow the scroll position
stage.addEventListener("scroll", () => {
  if (!isAll() || Date.now() < spyPaused) return;
  const atEnd = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4;
  let i = 0; arts.forEach((a, j) => { if (a.offsetTop - stage.scrollTop <= 120) i = j; });
  if (atEnd) i = LAST;
  if (i !== cur) { mark(i); try { history.replaceState(null, "", "#step-" + (i + 1)); } catch (e) {} }
}, { passive: true });

// Browser Back/Forward move between steps
addEventListener("popstate", () => { const m = location.hash.match(/step-(\d+)/); go(m ? +m[1] - 1 : 0, { push: false }); });

// Swipe left/right on phones (ignored on diagrams and code, which scroll sideways)
let touch = null;
stage.addEventListener("touchstart", e => {
  touch = e.target.closest(".visual, pre") || isAll() ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
stage.addEventListener("touchend", e => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y; touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) { if (dx < 0) fwd(true); else back(); }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") return closePanels();
  if (e.target.matches("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.body.classList.contains("gloss") || document.body.classList.contains("menu")) return;   // a drawer is open: don't navigate behind it
  const sc = e.target.closest && e.target.closest(".visual, pre");
  if (sc && sc.scrollWidth > sc.clientWidth) return;   // let ←/→ scroll a wide diagram or code block
  if (e.key === "ArrowRight") fwd(true);
  if (e.key === "ArrowLeft") back();
});

quizzes.forEach(paintQuiz); paintMarks();
const m = location.hash.match(/step-(\d+)/);
cur = -1; go(m ? +m[1] - 1 : Math.min(saved.cur || 0, LAST), { push: false });
})(
  typeof META === "object" ? META : null,
  typeof CAST === "object" && CAST ? CAST : {},
  typeof GLOSSARY === "object" && GLOSSARY ? GLOSSARY : {},
  typeof DIAGRAM === "string" ? DIAGRAM : "",
  typeof STEPS !== "undefined" ? STEPS : null,
);
