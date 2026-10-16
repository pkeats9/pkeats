#!/usr/bin/env node
// PK Eats dev server — zero dependencies (Node 20+).
//
//   node dev/server.mjs                 static site + proxy the API to https://pkeats.com (real restaurants and menus)
//   node dev/server.mjs --mock          …and simulate the account side (sign-in, wallet, checkout, tracking, cart codes)
//   node dev/server.mjs --offline       everything from dev/fixtures (no network; implies --mock)
//   options: --port 5173 · --upstream https://pkeats.com · --latency 1 (multiplier for simulated delays)
//            --fulfillment both|pickup|delivery (mock config; default both)
//
// The page is served with production's Content-Security-Policy so anything that would break on pkeats.com breaks here first.
// Mock/offline never place orders or move money: account actions are simulated in memory and reset on restart.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { createMock } from "./mock.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); if (i < 0) return fallback; const v = args[i + 1]; return !v || v.startsWith("--") ? true : v; };
const PORT = Number(flag("port", process.env.PORT || 5173));
const UPSTREAM = new URL(flag("upstream", "https://pkeats.com"));
const OFFLINE = !!flag("offline", false);
const MOCK = OFFLINE || !!flag("mock", false);
const LATENCY = Number(flag("latency", 1));
const FULFILLMENT = String(flag("fulfillment", "both"));

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC = path.join(root, "public");
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://wonder-image.wonder.com https://cdn.discordapp.com data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };

const mock = MOCK ? createMock({ root, offline: OFFLINE, latency: LATENCY, fulfillment: FULFILLMENT }) : null;

function serveFile(res, file, status = 200) {
  const ext = path.extname(file).toLowerCase();
  const headers = { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (ext === ".html") Object.assign(headers, { "Content-Security-Policy": CSP, "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN" });
  res.writeHead(status, headers);
  fs.createReadStream(file).pipe(res);
}

function localFile(pathname) {
  let p = decodeURIComponent(pathname);
  if (p === "/") p = "/index.html";
  const candidates = [p, p.endsWith("/") ? p + "index.html" : p + ".html"];
  for (const c of candidates) {
    const file = path.normalize(path.join(PUBLIC, c));
    if (!file.startsWith(PUBLIC)) return null;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

// Forward to the real site as if the browser were on pkeats.com (Origin/Referer/Host rewritten, cookies made localhost-safe).
function proxy(req, res) {
  const target = new URL(req.url, UPSTREAM);
  const headers = { ...req.headers, host: UPSTREAM.host };
  if (headers.origin) headers.origin = UPSTREAM.origin;
  if (headers.referer) { try { const r = new URL(headers.referer); headers.referer = UPSTREAM.origin + r.pathname + r.search; } catch { delete headers.referer; } }
  delete headers["accept-encoding"];
  const up = https.request(target, { method: req.method, headers }, (u) => {
    const out = { ...u.headers };
    if (out["set-cookie"]) out["set-cookie"] = [].concat(out["set-cookie"]).map((c) => c.replace(/;\s*Domain=[^;]+/gi, "").replace(/;\s*Secure/gi, ""));
    if (out.location?.startsWith(UPSTREAM.origin)) out.location = out.location.slice(UPSTREAM.origin.length) || "/";
    delete out["content-security-policy"]; delete out["strict-transport-security"];
    res.writeHead(u.statusCode, out);
    u.pipe(res);
  });
  up.on("error", (e) => { res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: `Upstream unavailable: ${e.message}` })); });
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (mock && (await mock.handle(req, res, url))) return;
    const file = localFile(url.pathname);
    if (file) return serveFile(res, file);
    if (/^\/(api|auth)\//.test(url.pathname) || /^\/(admin|privacy|terms)\b/.test(url.pathname) || /\.(js|css|svg|png|jpg)$/.test(url.pathname)) {
      if (OFFLINE) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "Not available offline." })); }
      return proxy(req, res);
    }
    // client-side screens all live in index.html
    return serveFile(res, path.join(PUBLIC, "index.html"));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Dev server error." }));
  }
});
server.listen(PORT, () => {
  const mode = OFFLINE ? "offline fixtures + mock account" : MOCK ? `proxy ${UPSTREAM.host} + mock account` : `proxy ${UPSTREAM.host}`;
  console.log(`PK Eats dev → http://localhost:${PORT}  (${mode})`);
});
