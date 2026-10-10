#!/usr/bin/env node
// Runs a real, hidden Chrome and streams it into a web page.
// usage: node server.js   then open http://127.0.0.1:8770
// On a server: set HOST=0.0.0.0 and PASSWORD (see README.md).
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const env = process.env;
const PORT = Number(env.PORT) || 8770, DEBUG_PORT = Number(env.DEBUG_PORT) || 9334;
const HOST = env.HOST || "127.0.0.1";
const PASSWORD = env.PASSWORD || "";
const LOCAL = HOST === "127.0.0.1" || HOST === "localhost";
const CHROME = env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = env.PROFILE_DIR || path.join(__dirname, "profile");
const MAX_SCALE = Number(env.MAX_SCALE) || 2;
const HOME = "https://duckduckgo.com/";

// anyone who can open the page controls the browser, so it never goes on a network without a password
if (!LOCAL && !PASSWORD) {
  console.error("Refusing to start: set the PASSWORD environment variable before putting this on a network.");
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const viewers = new Set();
let ws, session, mainTarget, nextId = 0, lastFrame = null, lastUrl = "";
const pending = new Map();

const chrome = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=" + DEBUG_PORT, "--window-size=1280,720",
  "--user-data-dir=" + PROFILE, "--no-first-run", "--no-default-browser-check",
  ...(env.CHROME_FLAGS ? env.CHROME_FLAGS.split(" ") : []), "about:blank",
], { stdio: "ignore" });
const quit = () => { chrome.kill(); process.exit(0); };
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
chrome.on("exit", () => process.exit(0));

function send(method, params = {}, sessionId = session) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}

function tell(event, data) {
  for (const res of viewers) res.write(`event: ${event}\ndata: ${data}\n\n`);
}

function onEvent({ method, params }) {
  if (method === "Page.screencastFrame") {
    lastFrame = params.data;
    tell("frame", lastFrame);
    send("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
  } else if (method === "Page.frameNavigated" && !params.frame.parentId) {
    tell("url", lastUrl = params.frame.url);
  } else if (method === "Page.navigatedWithinDocument") {
    tell("url", lastUrl = params.url);
  } else if (method === "Target.targetInfoChanged" || method === "Target.targetCreated") {
    // links that want a new window would open somewhere invisible, so load them in the one page instead
    const t = params.targetInfo;
    if (t.type === "page" && t.targetId !== mainTarget && t.url && t.url !== "about:blank") {
      send("Page.navigate", { url: t.url }).catch(() => {});
      send("Target.closeTarget", { targetId: t.targetId }, null).catch(() => {});
    }
  }
}

async function connect() {
  let version;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(); } catch { await sleep(250); }
  }
  if (!version) throw new Error("Chrome did not start");
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      if (p) d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result);
    } else onEvent(d);
  };
  const { targetInfos } = await send("Target.getTargets", {}, null);
  mainTarget = targetInfos.find(t => t.type === "page").targetId;
  session = (await send("Target.attachToTarget", { targetId: mainTarget, flatten: true }, null)).sessionId;
  await send("Target.setDiscoverTargets", { discover: true }, null);
  await send("Page.enable");
  await send("Emulation.setUserAgentOverride", { userAgent: version["User-Agent"].replace("HeadlessChrome", "Chrome") });
  await resize({ width: 1280, height: 720, scale: 1 });
  await send("Page.navigate", { url: HOME });
}

async function resize({ width, height, scale }) {
  width = Math.max(320, Math.min(2560, Math.round(width)));
  height = Math.max(240, Math.min(1600, Math.round(height)));
  scale = Math.max(1, Math.min(MAX_SCALE, scale || 1));
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  await send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: width * scale, maxHeight: height * scale });
}

async function history(step) {
  const { currentIndex, entries } = await send("Page.getNavigationHistory");
  const entry = entries[currentIndex + step];
  if (entry) await send("Page.navigateToHistoryEntry", { entryId: entry.id });
}

async function handle(msg) {
  switch (msg.t) {
    case "mouse": return send("Input.dispatchMouseEvent", msg.e);
    case "key": return send("Input.dispatchKeyEvent", msg.e);
    case "go": return send("Page.navigate", { url: msg.url });
    case "back": return history(-1);
    case "forward": return history(1);
    case "reload": return send("Page.reload");
    case "size": return resize(msg);
  }
}

function allowed(req) {
  if (!PASSWORD) return true;
  const given = Buffer.from((req.headers.authorization || "").replace(/^Basic /, ""), "base64").toString();
  const a = crypto.createHash("sha256").update(given.slice(given.indexOf(":") + 1)).digest();
  const b = crypto.createHash("sha256").update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200).end("ok");
  } else if (!allowed(req)) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="Chromium Stream"' }).end("Password required");
  } else if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(fs.readFileSync(path.join(__dirname, "index.html")));
  } else if (req.method === "GET" && req.url === "/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    viewers.add(res);
    req.on("close", () => viewers.delete(res));
    if (lastUrl) res.write(`event: url\ndata: ${lastUrl}\n\n`);
    if (lastFrame) res.write(`event: frame\ndata: ${lastFrame}\n\n`);
  } else if (req.method === "POST" && req.url === "/input") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try { for (const msg of JSON.parse(body)) await handle(msg).catch(() => {}); } catch {}
      res.writeHead(204).end();
    });
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, HOST, () => console.log(`Chromium stream: http://${HOST}:${PORT}`));

// hosting proxies drop a stream that stays silent
setInterval(() => { for (const res of viewers) res.write(": keepalive\n\n"); }, 20000);

connect().catch(e => { console.error(e.message); quit(); });
