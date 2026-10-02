import { api } from "./http.mjs";

/* ── Riverside Business API ───────────────────────────────────
   Read-only client for the pieces the webinar process will use: the workspace
   (productions → studios → projects), scheduled events (studio sessions and
   webinars), and recordings with their tracks and transcripts.

   https://docs.riverside.fm — v3, platform.riverside.com, `Authorization: Bearer`.

   Two account facts that shape this:
     · the API is Business-plan only, and the key is issued by Riverside's
       customer success manager rather than generated in the app;
     · ONE key can be active at a time. If it is ever regenerated, every user of
       the old one stops working at once — so it lives in exactly one place,
       RIVERSIDE_API_KEY in Netlify, and nowhere else.

   Riverside allows one request per second. Calls from this module are spaced
   to respect that, so a loop over pages cannot trip a 429 by itself.
   ───────────────────────────────────────────────────────────── */

const BASE = "https://platform.riverside.com/api/v3";
const auth = () => ({ authorization: `Bearer ${process.env.RIVERSIDE_API_KEY}` });

let last = 0;
async function rv(path, params = {}) {
  const wait = last + 1050 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return api(`${BASE}${path}${q ? `?${q}` : ""}`, { headers: auth() }, "Riverside");
}

/** Productions → studios → projects. */
export const workspace = () => rv("/productions");

/** Scheduled events. type: "webinar" | "session"; status: "upcoming" | "live" | "ended". */
export async function events({ type, status, from, to, studioId, limit = 100 } = {}) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {                       // ≤1,000 events; plenty for this account
    const page = await rv("/events", { event_type: type, status, from, to, studio_id: studioId, limit, cursor });
    out.push(...(page.data || []));
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return out;
}

/** Recordings, newest first. Dates are YYYY-MM-DD. One page of 20 unless `pages` says more. */
export async function recordings({ studioId, projectId, startDate, endDate, pages = 1 } = {}) {
  const out = [];
  for (let page = 0; page < pages; page++) {
    const r = await rv("/recordings", { studioId, projectId, start_date: startDate, end_date: endDate, page });
    out.push(...(r.data || []));
    if (!r.next_page_url) break;
  }
  return out;
}

export const recording = (id) => rv(`/recordings/${encodeURIComponent(id)}`);
