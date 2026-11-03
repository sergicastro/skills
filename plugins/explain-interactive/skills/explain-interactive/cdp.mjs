// Minimal headless Chrome driver over the DevTools protocol (Node 22+, no dependencies).
// Used by shots.mjs and the browser tests. Set CHROME=/path/to/chrome to pick a browser.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
];
export const findChrome = () => [process.env.CHROME, ...CANDIDATES].find(p => p && existsSync(p));

// Starts a headless browser on a blank page. Returns helpers bound to that page:
//   send(method, params)  raw DevTools call      js(expr)  evaluate and return the value
//   open(file)            load a local file      problems / requests  console errors+warnings, URLs requested
//   close()
export async function launch({ chrome = findChrome(), width = 1280, height = 800 } = {}) {
  if (!chrome) throw new Error("no Chrome/Chromium found (set CHROME=/path/to/chrome)");
  const profile = mkdtempSync(join(tmpdir(), "explain-chrome-"));
  const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) { proc.kill(); throw new Error(`${chrome} did not start`); }
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });

  let seq = 0;
  const pending = new Map(), listeners = new Set(), problems = [], requests = [];
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) problems.push(m.params.args.map(a => a.value ?? a.description).join(" "));
    if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
    [...listeners].forEach(h => h(m));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
  });
  const js = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const open = async file => {
    const loaded = new Promise(res => { const h = m => { if (m.method === "Page.loadEventFired") { listeners.delete(h); res(); } }; listeners.add(h); });
    await send("Page.navigate", { url: pathToFileURL(file).href });
    await loaded; await sleep(100);
  };
  const close = () => { try { ws.close(); } catch {} proc.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} };
  await Promise.all(["Page.enable", "Runtime.enable", "Network.enable"].map(m => send(m)));
  return { send, js, open, close, problems, requests };
}
