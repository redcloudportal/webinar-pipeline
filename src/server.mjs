import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import * as riverside from "./riverside.mjs";

/* ── Red Cloud webinar pipeline ────────────────────────────────
   The automation layer for webinars, separate from the portal and from the
   Netlify intake site. Pieces are added one at a time and every one starts
   MANUAL: nothing here runs on a timer or reacts to anything until it is
   deliberately wired in. See PROJECT.md.

   No framework, no dependencies — node:http only, so the container is small and
   there is nothing to keep patched beyond Node itself.
   ───────────────────────────────────────────────────────────── */

const PORT = Number(process.env.PORT || 8300);

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
};

/* Everything but /health needs the pipeline's token. If no token is set the
   pipeline refuses rather than defaulting to open. */
function authorised(req) {
  const want = process.env.PIPELINE_TOKEN || "";
  const got = String(req.headers["x-pipeline-token"] || "");
  if (!want || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/* Which pieces are switched on. A piece is "on" only when its key is set — and
   even then nothing runs by itself: "on" means it CAN be called. */
const pieces = () => ({
  riverside: process.env.RIVERSIDE_API_KEY ? "on (manual)" : "off — needs RIVERSIDE_API_KEY",
});

const routes = {
  /* public, and says nothing secret: is it up, and what is switched on */
  "GET /health": async (req, res) =>
    json(res, 200, { ok: true, service: "webinar-pipeline", pieces: pieces(), automatic: "nothing" }),

  /* Riverside piece 1 — the connection. Read-only: the workspace, and webinars
     upcoming and ended in the last 30 days. */
  "GET /riverside/overview": async (req, res) => {
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

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname.replace(/\/+$/, "") || "/";
  const route = routes[`${req.method} ${path}`];
  if (!route) return json(res, 404, { error: "not found" });
  if (path !== "/health" && !authorised(req)) return json(res, 401, { error: "unauthorised" });
  try {
    await route(req, res);
  } catch (err) {
    console.error(`${req.method} ${path} failed:`, err.message);
    json(res, 502, { error: err.message, status: err.status || null });
  }
});

server.listen(PORT, () => console.log(`webinar-pipeline listening on ${PORT}; pieces: ${JSON.stringify(pieces())}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
