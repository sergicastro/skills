// Minimal headless Chrome driver over the DevTools protocol (Node 22+, no dependencies).
// Used by shots.mjs and the browser tests. Set CHROME=/path/to/chrome to pick a browser.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

// The driver talks to Chrome through the global WebSocket, which Node has without a flag from 22 on
export const MIN_NODE = 22;
export function nodeProblem(version = process.versions.node, hasWebSocket = typeof WebSocket === "function") {
  if (parseInt(version, 10) < MIN_NODE)
    return `Node ${version} is too old: shots.mjs needs Node ${MIN_NODE} or newer (for its built-in WebSocket). Install a current Node from https://nodejs.org or your package manager.`;
  if (!hasWebSocket) return `this Node (${version}) has no global WebSocket, which shots.mjs needs (was it started with --no-experimental-websocket?)`;
  return null;
}

// Where browsers usually live, per platform. findChrome also looks them up by name on PATH.
export function chromeCandidates({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap(r => ["Google\\Chrome\\Application\\chrome.exe", "Chromium\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe"].map(p => `${r}\\${p}`));
  }
  if (platform === "darwin") {
    const apps = ["Google Chrome.app/Contents/MacOS/Google Chrome", "Chromium.app/Contents/MacOS/Chromium",
      "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
    return ["/Applications", `${home}/Applications`].flatMap(d => apps.map(a => `${d}/${a}`));
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/snap/bin/chromium", "/opt/google/chrome/chrome", "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"];
}
export const PATH_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome",
  "microsoft-edge", "microsoft-edge-stable", "msedge"];
export function onPath(names = PATH_NAMES, { platform = process.platform, env = process.env } = {}) {
  const win = platform === "win32";
  const dirs = (env.PATH ?? env.Path ?? "").split(win ? ";" : ":").filter(Boolean);
  for (const n of names) for (const d of dirs) {
    const p = join(d, win ? `${n}.exe` : n);
    try { if (statSync(p).isFile()) return p; } catch {}
  }
  return undefined;
}
// CHROME wins when it names a file that exists; then the usual install places, then PATH
export const findChrome = () => [process.env.CHROME, ...chromeCandidates()].find(p => p && existsSync(p)) ?? onPath();

// Chrome won't start its sandbox as root (e.g. in a container), so run without it there
export const chromeArgs = ({ profile, width, height, root = process.getuid?.() === 0 }) => [
  "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", `--window-size=${width},${height}`, ...(root ? ["--no-sandbox"] : []), "about:blank"];

const withTimeout = (promise, ms, what) => {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
};

// Starts a headless browser on a blank page. Returns helpers bound to that page:
//   send(method, params, { timeout })  raw DevTools call      js(expr)  evaluate and return the value
//   open(file, { timeout })            load a local file (or an http(s) URL)      close()
//   problems / requests / dialogs      console errors+warnings, URLs requested, alert/confirm/prompt texts
// Every call fails after its timeout (default 30 s), and at once when the browser connection closes, so a stuck page
// can't hang the caller. A dialog the page opens is answered straight away (it would block every later call).
export async function launch({ chrome = findChrome(), width = 1280, height = 800, timeout = 30000 } = {}) {
  if (!chrome) throw new Error("no Chrome/Chromium found (set CHROME=/path/to/chrome)");
  const problem = nodeProblem();
  if (problem) throw new Error(problem);
  const profile = mkdtempSync(join(tmpdir(), "explain-chrome-"));
  const proc = spawn(chrome, chromeArgs({ profile, width, height }), { stdio: "ignore" });
  let exited = null;
  proc.on("error", e => { exited = e.message; });
  proc.on("exit", code => { exited ??= `exited with code ${code}`; });
  const cleanup = () => { proc.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  let ws;
  try {
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 150 && !existsSync(portFile) && !exited; i++) await sleep(100);
    if (!existsSync(portFile)) throw new Error(`${chrome} did not start${exited ? ` (${exited})` : ""}`);
    const port = readFileSync(portFile, "utf8").split("\n")[0];
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(10000) })).json();
    ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
    await withTimeout(new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("could not connect to the browser")), { once: true });
    }), 10000, "connecting to the browser");
  } catch (e) { try { ws?.close(); } catch {} cleanup(); throw e; }

  let seq = 0, closed = null;
  const pending = new Map(), listeners = new Set(), problems = [], requests = [], dialogs = [];
  ws.addEventListener("close", () => {
    closed = new Error(`the browser connection closed${exited ? ` (browser ${exited})` : ""}`);
    for (const p of pending.values()) p.rej(closed);
    pending.clear();
    [...listeners].forEach(h => h({ closed }));
  });
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) problems.push(m.params.args.map(a => a.value ?? a.description).join(" "));
    if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
    if (m.method === "Page.javascriptDialogOpening") {
      dialogs.push(`${m.params.type}(${JSON.stringify(m.params.message)})`);
      send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
    [...listeners].forEach(h => h(m));
  });
  const send = (method, params = {}, { timeout: ms = timeout } = {}) => {
    if (closed) return Promise.reject(closed);
    return new Promise((res, rej) => {
      const id = ++seq;
      const t = setTimeout(() => { pending.delete(id); rej(new Error(`DevTools call ${method} timed out after ${ms / 1000}s`)); }, ms);
      pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const open = async (file, { timeout: ms = timeout } = {}) => {
    let h;
    const loaded = new Promise((res, rej) => {
      h = m => { if (m.closed) rej(m.closed); else if (m.method === "Page.loadEventFired") res(); };
      listeners.add(h);
    });
    loaded.catch(() => {});   // awaited below; this only keeps an early failure from going unhandled
    try {
      await send("Page.navigate", { url: /^https?:\/\//.test(file) ? file : pathToFileURL(file).href }, { timeout: ms });
      await withTimeout(loaded, ms, `loading ${file}`);
    } finally { listeners.delete(h); }
    await sleep(100);
  };
  const close = () => { try { ws.close(); } catch {} cleanup(); };
  try { await Promise.all(["Page.enable", "Runtime.enable", "Network.enable"].map(m => send(m))); } catch (e) { close(); throw e; }
  return { send, js, open, close, problems, requests, dialogs };
}
