import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import * as riverside from "./riverside.mjs";
import * as auth from "./auth.mjs";
import * as pages from "./pages.mjs";
import * as host from "./host.mjs";
import * as keys from "./keys.mjs";

/* ── Red Cloud webinar pipeline ────────────────────────────────
   The automation layer for webinars, separate from the portal and from the
   Netlify intake site. INTERNAL: everything is behind a sign-in except a bare
   "is it up" check. Pieces are added one at a time and every one starts
   MANUAL — nothing runs on a timer or reacts to anything until it is
   deliberately wired in. See PROJECT.md.

   No framework, no dependencies — node:http only.
   ───────────────────────────────────────────────────────────── */

const PORT = Number(process.env.PORT || 8300);
const COOKIE = "wp_session";
const SECURE = process.env.COOKIE_INSECURE === "1" ? "" : "; Secure";   // local testing over http only

/* Headers on every response: never cached, never framed, never indexed, and
   no Referer — a one-time setup link carries its token in the URL. */
const BASE_HEADERS = {
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
};
const send = (res, status, body, type, extra = {}) => {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": type, ...extra });
  res.end(body);
};
const json = (res, status, body) => send(res, status, JSON.stringify(body, null, 2), "application/json");
const html = (res, status, body, extra) => send(res, status, body, "text/html; charset=utf-8", extra);
const redirect = (res, to, extra = {}) => { res.writeHead(303, { ...BASE_HEADERS, location: to, ...extra }); res.end(); };

const cookies = (req) => Object.fromEntries(String(req.headers.cookie || "").split(/;\s*/).filter(Boolean)
  .map((c) => { const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

async function form(req) {
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw new Error("form too large"); }
  return Object.fromEntries(new URLSearchParams(raw));
}

/* A person with a session, or a machine with the pipeline token. */
const signedIn = (req) => auth.sessionValid(cookies(req)[COOKIE]);
function tokenOk(req) {
  const want = process.env.PIPELINE_TOKEN || "";
  const got = String(req.headers["x-pipeline-token"] || "");
  return Boolean(want) && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

const pieces = () => [
  { name: "Riverside — connection", on: Boolean(process.env.RIVERSIDE_API_KEY),
    status: process.env.RIVERSIDE_API_KEY ? "on · manual" : "waiting on API access",
    what: "Reads the Riverside workspace and its webinars. Read-only." },
  { name: "Riverside — recording to clips", on: false, status: "not built", what: "Recording and transcript into the clips job." },
  { name: "Riverside — attendee lists", on: false, status: "not built", what: "Registrants and attendance into the Box event folder." },
  { name: "Riverside — registration & schedule", on: false, status: "not built", what: "Sign-ups into Riverside; webinar time into /ops." },
];

const routes = {
  /* the only public route, and it says nothing but "up" */
  "GET /health": (req, res) => json(res, 200, { ok: true }),

  "GET /login": (req, res) => {
    if (!auth.hasPassword()) return html(res, 200, pages.noPasswordPage());
    if (signedIn(req)) return redirect(res, "/ops");
    html(res, 200, pages.loginPage());
  },
  "POST /login": async (req, res) => {
    const ip = clientIp(req);
    if (auth.lockedOut(ip)) return html(res, 429, pages.loginPage("Too many attempts. Try again in 15 minutes."));
    const { password = "" } = await form(req);
    if (!auth.checkPassword(password)) {
      auth.noteFailure(ip);
      return html(res, 401, pages.loginPage("That password isn't right."));
    }
    auth.clearFailures(ip);
    redirect(res, "/ops", { "set-cookie": `${COOKIE}=${auth.newSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${auth.SESSION_DAYS * 86400}${SECURE}` });
  },
  "POST /logout": (req, res) =>
    redirect(res, "/login", { "set-cookie": `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE}` }),

  "GET /setup": (req, res, url) => {
    const t = url.searchParams.get("t") || "";
    if (!auth.setupTokenValid(t)) return html(res, 410, pages.linkDeadPage());
    html(res, 200, pages.setupPage(t));
  },
  "POST /setup": async (req, res) => {
    const ip = clientIp(req);
    if (auth.lockedOut(ip)) return html(res, 429, pages.linkDeadPage());
    const { t = "", password = "", again = "" } = await form(req);
    if (!auth.setupTokenValid(t)) { auth.noteFailure(ip); return html(res, 410, pages.linkDeadPage()); }
    if (password !== again) return html(res, 400, pages.setupPage(t, { error: "The two passwords don't match." }));
    const r = auth.setPasswordWithToken(t, password);
    if (!r.ok) return html(res, 400, pages.setupPage(t, { error: r.error }));
    html(res, 200, pages.setupPage("", { done: true }));
  },

  /* Keys: paste a key on the server, never in chat */
  "GET /settings/keys": (req, res, url) => {
    if (!signedIn(req)) return redirect(res, "/login");
    const n = url.searchParams.get("saved"), c = url.searchParams.get("cleared");
    html(res, 200, pages.keysPage(keys.status(), { notice: n ? `${n} saved — live now.` : c ? `${c} cleared.` : null }));
  },
  "POST /settings/keys": async (req, res) => {
    if (!signedIn(req)) return redirect(res, "/login");
    /* a form posted from another site must not be able to change keys */
    const origin = req.headers.origin || "";
    if (origin && new URL(origin).host !== (req.headers["x-forwarded-host"] || req.headers.host)) return json(res, 403, { error: "bad origin" });
    const { name = "", value = "", do: what = "save" } = await form(req);
    const r = what === "clear" ? keys.clearKey(name) : keys.setKey(name, value);
    if (!r.ok) return html(res, 400, pages.keysPage(keys.status(), { error: r.error }));
    const label = keys.KNOWN.find((k) => k.name === name)?.label || name;
    redirect(res, `/settings/keys?${what === "clear" ? "cleared" : "saved"}=${encodeURIComponent(label)}`);
  },

  /* the pipeline's own status page ("/" is the public client form) */
  "GET /pipeline": (req, res) => {
    if (!signedIn(req)) return redirect(res, "/login");
    html(res, 200, pages.homePage(pieces()));
  },

  /* Riverside piece 1 — read-only. A signed-in person or the pipeline token. */
  "GET /riverside/overview": async (req, res) => {
    if (!signedIn(req) && !tokenOk(req)) return json(res, 401, { error: "unauthorised" });
    if (!process.env.RIVERSIDE_API_KEY) return json(res, 400, { error: "RIVERSIDE_API_KEY is not set." });
    const ws = await riverside.workspace();
    const upcoming = await riverside.events({ type: "webinar", status: "upcoming", limit: 50 });
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const ended = await riverside.events({ type: "webinar", status: "ended", from: since, limit: 50 });
    const slim = (e) => ({ id: e.id, name: e.name, start: e.start_time, studio: e.studio_name,
                           registrants: e.registrants_count, registration_url: e.registration_url,
                           streams: (e.livestream_destinations || []).map((d) => d.platform) });
    json(res, 200, {
      productions: ws.map((p) => ({ id: p.id, name: p.name,
        studios: (p.studios || []).map((s) => ({ id: s.id, name: s.name, recordings: s.num_recordings })) })),
      upcoming: upcoming.map(slim),
      endedLast30Days: ended.map(slim),
    });
  },
};

/* ── what is public, and what needs signing in ─────────────────
   The site is internal, but a few things have to be reachable by people and
   systems that cannot sign in:

     public      the client form ("/" and POST "/"), its title and company
                 helpers, email images (/art), the files a client uploaded
                 (/uploads, unguessable addresses), the logos, /health
     own token   the Mac Mini clips worker's calls (WORKER_TOKEN, checked by
                 the functions themselves)
     signed in   everything else — /ops, the clips view, the API behind /ops,
                 the health and Box checks, Canva

   /api/webinars also still accepts the ops token, for scripts. */
const PUBLIC_FUNCTIONS = new Set(["/api/suggest-titles", "/api/company-profile", "/api/clips", "/api/clip-jobs", "/api/clip-preview"]);
const PUBLIC_STATIC = (p) => p === "/" || p === "/index.html" || p.startsWith("/logos/");
const needsSession = (p) => !(PUBLIC_FUNCTIONS.has(p) || p.startsWith("/art/") || p === "/api/webinars");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const me = signedIn(req);
  try {
    const route = routes[`${req.method} ${path}`];
    if (route) return await route(req, res, url);

    if (req.method === "POST" && path === "/") return await host.handleFormPost(req, res);
    if (req.method === "GET" && path.startsWith("/uploads/")) return await host.handleUpload(req, res);

    if (path.startsWith("/api/") || path.startsWith("/art/") || path.startsWith("/.netlify/")) {
      if (needsSession(path) && !path.startsWith("/.netlify/") && !me) return json(res, 401, { error: "Sign in at /login" });
      /* the clips list is open to READ (the worker needs it, and it holds no contact
         details) — but setting timecodes or approving a cut needs a person signed in.
         On Netlify this was open to anyone with the address. */
      if (path === "/api/clips" && req.method !== "GET" && !me) return json(res, 401, { error: "Sign in at /login" });
      if (await host.handleFunction(req, res, { signedIn: me })) return;
      return me ? json(res, 404, { error: "not found" }) : redirect(res, "/login");
    }

    if (req.method === "GET") {
      if (!PUBLIC_STATIC(path) && !me) return redirect(res, "/login");
      if (await host.handleStatic(req, res, path)) return;
    }
    /* an unknown address gives nothing away to someone who is not signed in */
    return me ? json(res, 404, { error: "not found" }) : redirect(res, "/login");
  } catch (err) {
    console.error(`${req.method} ${path} failed:`, err.message);
    if (!res.headersSent) json(res, 502, { error: "Something went wrong — see the server log." });
  }
});

process.env.WEBINAR_HOST = "droplet";            // tells the shared code it is not on Netlify
const fromKeysPage = keys.applySaved();          // keys pasted on /settings/keys win over .env
const loaded = await host.loadFunctions();
host.startScheduler();
server.listen(PORT, () => console.log(`webinar-pipeline listening on ${PORT}; password set: ${auth.hasPassword()}; ` +
  `${host.paused() ? "PAUSED (side-by-side test)" : "LIVE"}; functions: ${loaded.join(", ")}; keys from Keys page: ${fromKeysPage.join(", ") || "none"}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
