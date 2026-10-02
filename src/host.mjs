import { readdir, readFile, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { getStore } from "../app/netlify/shared/blobs.mjs";

/* ── running the webinar system's Netlify functions on this server ────────
   The intake system (form, /ops, connectors, graphics, clips) was written as
   Netlify Functions: each file exports `default async (req) => Response` and a
   `config.path`. Node 22 speaks the same web Request/Response, so the files are
   loaded as they are and this module stands in for Netlify around them:

     · routes      config.path ("/api/webinars", "/art/:token") → the function
     · background  "*-background" functions answer 202 at once and keep working
     · internal    a function that calls /.netlify/functions/<name> on its own
                   origin is run in-process — that path is never open from outside
     · the form    POST / is the client form (it used to be Netlify Forms): files
                   are stored on the data volume, and the same submission handler runs
     · the timer   the 15-minute scheduler, when it is switched on
     · PAUSED      while both sites run, nothing here may reach the outside world
   ───────────────────────────────────────────────────────────────────────── */

const APP = new URL("../app/", import.meta.url).pathname;
const FUNCS = join(APP, "netlify/functions");
const PUBLIC = join(APP, "public");

export const paused = () => process.env.PAUSED !== "0";      // ON unless explicitly switched off

/* Read-only actions the /ops API may still answer while paused. Everything else
   that would change a record, a Box folder or a Mailchimp campaign is refused. */
const READ_ACTIONS = new Set(["eblast", "regpage", "social", "mailchimp_campaigns", "mailchimp_campaign"]);
/* POSTs that always change something outside — refused while paused */
const PAUSED_POSTS = new Set(["/api/file-to-box", "/api/clip-jobs", "/api/clips", "/api/clip-preview",
                              "/api/canva-connect", "/api/canva-callback"]);

const fns = new Map();          // name -> { handler, config, background }
const routes = [];              // { re, keys, name }

export async function loadFunctions() {
  for (const f of (await readdir(FUNCS)).filter((n) => n.endsWith(".mjs"))) {
    const name = basename(f, ".mjs");
    const mod = await import(pathToFileURL(join(FUNCS, f)).href);
    const entry = { handler: mod.default, config: mod.config || {}, background: name.endsWith("-background") };
    fns.set(name, entry);
    const p = entry.config.path;
    if (typeof p === "string") {
      const keys = [];
      const re = new RegExp("^" + p.replace(/\/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; }) + "/?$");
      routes.push({ re, keys, name });
    }
  }
  installInternalFetch();
  return [...fns.keys()];
}

/* A function that "calls itself" — webinars.mjs dispatching a slow connector to
   run-connector-background, company-profile kicking off its background half —
   does fetch(`${origin}/.netlify/functions/<name>`). Run those in-process. */
function installInternalFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    const m = url && url.match(/^https?:\/\/[^/]+\/\.netlify\/functions\/([a-z0-9-]+)/i);
    if (m && fns.has(m[1])) {
      const req = new Request(url, init);
      return invoke(m[1], req, {});
    }
    return real(input, init);
  };
}

async function invoke(name, req, context) {
  const fn = fns.get(name);
  if (fn.background) {
    /* answer at once, keep working — exactly how Netlify treated these */
    Promise.resolve().then(() => fn.handler(req, context))
      .catch((err) => console.error(`background ${name} failed:`, err.message));
    return new Response(null, { status: 202 });
  }
  return fn.handler(req, context);
}

/* node request → web Request, with the public origin the functions expect */
async function toRequest(nreq, body) {
  const proto = nreq.headers["x-forwarded-proto"] || "https";
  const host = nreq.headers["x-forwarded-host"] || nreq.headers.host || "webinars.redcloudfs.com";
  const headers = new Headers();
  for (const [k, v] of Object.entries(nreq.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  const hasBody = !["GET", "HEAD"].includes(nreq.method);
  return new Request(`${proto}://${host}${nreq.url}`, { method: nreq.method, headers, body: hasBody ? body : undefined });
}

async function send(nres, response) {
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  nres.writeHead(response.status, headers);
  nres.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}

async function readBody(nreq, limit) {
  const chunks = []; let size = 0;
  for await (const c of nreq) { size += c.length; if (size > limit) throw Object.assign(new Error("too large"), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks);
}

const clientIp = (nreq) => String(nreq.headers["x-forwarded-for"] || nreq.socket.remoteAddress || "").split(",")[0].trim();
const refuse = (nres, status, message) => {
  nres.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  nres.end(JSON.stringify({ error: "paused", message }, null, 2));
};
const PAUSED_MSG = "This server is in its side-by-side test: nothing that changes a webinar, a Box folder or a Mailchimp campaign runs here until cut-over. Use the live site for that.";

/** Try to answer as one of the webinar system's functions. Returns false if no route matched. */
export async function handleFunction(nreq, nres, { signedIn } = {}) {
  const url = new URL(nreq.url, "http://x");
  const path = url.pathname;

  /* internal-only: never open from outside */
  if (path.startsWith("/.netlify/")) { nres.writeHead(404); nres.end(); return true; }

  let hit = null;
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) { hit = { name: r.name, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; }
  }
  if (!hit) return false;

  const body = ["GET", "HEAD"].includes(nreq.method) ? undefined : await readBody(nreq, 50 * 1024 * 1024);

  if (paused() && nreq.method === "POST") {
    if (PAUSED_POSTS.has(path)) { refuse(nres, 423, PAUSED_MSG); return true; }
    if (path === "/api/webinars") {
      let action = null;
      try { action = JSON.parse(body.toString("utf8")).action; } catch {}
      if (!READ_ACTIONS.has(action)) { refuse(nres, 423, PAUSED_MSG); return true; }
    }
  }

  const req = await toRequest(nreq, body);
  /* a signed-in person may use /ops without pasting the ops token */
  if (signedIn && hit.name === "webinars" && process.env.OPS_TOKEN) req.headers.set("x-ops-token", process.env.OPS_TOKEN);
  const response = await invoke(hit.name, req, { ip: clientIp(nreq), params: hit.params, geo: {} });
  await send(nres, response);
  return true;
}

/* ── the client form ─────────────────────────────────────────
   It posts multipart to "/" — on Netlify that was Netlify Forms. Here the files
   go to the data volume under a random token per submission and are served from
   /uploads/<token>/<name>, so the submission handler sees file URLs exactly as
   it did from Netlify, and every connector downstream works unchanged. */
const uploads = () => getStore({ name: "uploads" });
const formTries = new Map();     // ip -> [timestamps]

export async function handleFormPost(nreq, nres) {
  const ip = clientIp(nreq);
  const now = Date.now();
  const recent = (formTries.get(ip) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= 10) { nres.writeHead(429); nres.end("Too many submissions from here — try again later."); return; }
  formTries.set(ip, [...recent, now]);

  let body;
  try { body = await readBody(nreq, 50 * 1024 * 1024); }
  catch (err) { nres.writeHead(err.status || 400); nres.end(err.status === 413 ? "Files too large" : "Bad request"); return; }
  const fd = await (await toRequest(nreq, body)).formData();

  /* the honeypot: people never fill it, bots do. Pretend it worked. */
  if (String(fd.get("bot-field") || "").trim()) { nres.writeHead(200); nres.end("ok"); return; }

  const token = randomBytes(16).toString("hex");
  const origin = `${nreq.headers["x-forwarded-proto"] || "https"}://${nreq.headers["x-forwarded-host"] || nreq.headers.host}`;
  const data = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string") { data[k] = data[k] === undefined ? v : [].concat(data[k], v); continue; }
    if (!v.size) continue;                                     // an untouched file input
    const safe = String(v.name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
    await uploads().set(`${token}/${safe}`, Buffer.from(await v.arrayBuffer()), { metadata: { contentType: v.type || "application/octet-stream" } });
    const file = { url: `${origin}/uploads/${token}/${encodeURIComponent(safe)}`, filename: safe, size: v.size, type: v.type };
    data[k] = data[k] === undefined ? [file] : [].concat(data[k], file);
  }

  /* the same shape Netlify sent its submission-created event in */
  const payload = { id: randomUUID(), created_at: new Date().toISOString(), form_name: data["form-name"] || "webinar-content", data };
  const req = new Request(`${origin}/.netlify/functions/submission-created-background`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }),
  });
  await invoke("submission-created-background", req, {});
  nres.writeHead(200, { "content-type": "text/plain" });
  nres.end("ok");
}

export async function handleUpload(nreq, nres) {
  const m = new URL(nreq.url, "http://x").pathname.match(/^\/uploads\/([a-f0-9]{32})\/([^/]+)$/);
  if (!m) { nres.writeHead(404); nres.end(); return; }
  const key = `${m[1]}/${decodeURIComponent(m[2])}`;
  const buf = await uploads().get(key, { type: "arrayBuffer" });
  if (!buf) { nres.writeHead(404); nres.end(); return; }
  const meta = (await uploads().getMetadata(key))?.metadata || {};
  nres.writeHead(200, { "content-type": meta.contentType || "application/octet-stream", "cache-control": "private, max-age=3600", "x-robots-tag": "noindex" });
  nres.end(Buffer.from(buf));
}

/* ── static files: the form, /ops, the clips view, logos ── */
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".ico": "image/x-icon" };
export async function handleStatic(nreq, nres, path) {
  const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  if (rel.includes("..")) return false;
  const file = join(PUBLIC, rel.endsWith(".html") || extname(rel) ? rel : `${rel}.html`);
  try { if (!(await stat(file)).isFile()) return false; } catch { return false; }
  nres.writeHead(200, {
    "content-type": TYPES[extname(file)] || "application/octet-stream",
    "cache-control": "public, max-age=0, must-revalidate",
    "x-frame-options": "DENY", "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin", "x-robots-tag": "noindex, nofollow",
  });
  nres.end(await readFile(file));
  return true;
}

/* ── the 15-minute timer ── only when switched on, and never while paused */
export function startScheduler() {
  const fn = fns.get("scheduler");
  if (!fn || paused() || process.env.SCHEDULER_ENABLED !== "1") {
    console.log(`scheduler: off (${paused() ? "paused" : "SCHEDULER_ENABLED is not 1"})`);
    return;
  }
  const tick = () => fn.handler(new Request("https://internal/scheduler")).catch((e) => console.error("scheduler:", e.message));
  setInterval(tick, 15 * 60e3);
  console.log("scheduler: on, every 15 minutes");
}
