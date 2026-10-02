import crypto from "node:crypto";
import { getStore } from "../shared/blobs.mjs";   // was @netlify/blobs — see shared/blobs.mjs

/* The fast half of the company look-up.

   POST starts the job and returns immediately; GET ?job= reports whether it has
   finished. All the slow work — reading the site, asking the model — happens in
   company-profile-background, because it takes about thirty seconds and a
   synchronous Netlify function is killed at ten. The README warned about
   exactly this and it was right. */

const jobs = () => getStore({ name: "profile-jobs", consistency: "strong" });

const RATE_MAX = 10;
const RATE_WINDOW = 10 * 60 * 1000;
const hits = new Map();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req, context) => {
  const url = new URL(req.url);

  /* ── polling ── */
  if (req.method === "GET") {
    const job = url.searchParams.get("job");
    if (!job) return json({ error: "need a job id" }, 400);
    const state = await jobs().get(job, { type: "json" }).catch(() => null);
    if (!state) return json({ status: "working" });
    if (state.error) return json({ status: "failed", ...state.body });
    return json({ status: "done", ...state.profile });
  }

  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "not_configured", message: "Look-up is not switched on for this site yet." }, 501);
  }

  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown";
  const now = Date.now();
  const seen = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  if (seen.length >= RATE_MAX) {
    return json({ error: "rate_limited", message: "That is a lot of look-ups — give it a few minutes." }, 429);
  }
  seen.push(now);
  hits.set(ip, seen);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_WINDOW)) hits.delete(k);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON." }, 400); }
  const website = String(body.website || "").trim();
  if (!website) {
    return json({ error: "need_input", message: "Add your company website so we can look you up." }, 400);
  }

  const job = crypto.randomBytes(12).toString("hex");

  /* hand off and return — the background function answers 202 straight away */
  try {
    await fetch(`${url.origin}/.netlify/functions/company-profile-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ job, website }),
    });
  } catch (err) {
    console.error("company-profile: could not start the job:", err.message);
    return json({ error: "failed", message: "Could not start the look-up. Try again." }, 502);
  }

  return json({ status: "working", job });
};

export const config = { path: "/api/company-profile" };
