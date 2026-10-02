import { getStore } from "../shared/blobs.mjs";   // was @netlify/blobs — see shared/blobs.mjs
import { read, write } from "../shared/record.mjs";

/* /api/clip-preview -- low-resolution proxies of the cut clips, so they can be
   watched in the browser BEFORE anything is written into the client's Box folder.

   The Mac mini keeps the full-quality files. Only a ~360px proxy comes here, a
   megabyte or so per clip, which is enough to judge framing and content and
   small enough to sit comfortably inside a function's payload limits.

     POST {id, name, dataB64}   worker stores a proxy   (needs WORKER_TOKEN)
     GET  ?id=&name=            browser plays it        (open, like /api/clips)

   Nothing here is authoritative: the deliverable is the file on the mini, and it
   only reaches Box once a person presses Export. */

const STORE = "clip-previews";
const MAX_BYTES = 6 * 1024 * 1024;

const json = (b, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* keys are built from caller-supplied text, so keep them boring */
const safe = (s) => String(s || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore({ name: STORE, consistency: "strong" });

  if (req.method === "GET") {
    const id = safe(url.searchParams.get("id"));
    const name = safe(url.searchParams.get("name"));
    if (!id || !name) return json({ error: "id and name required" }, 400);
    const blob = await store.get(`${id}/${name}`, { type: "arrayBuffer" });
    if (!blob) return json({ error: "not found" }, 404);
    return new Response(blob, {
      headers: {
        "content-type": "video/mp4",
        "content-length": String(blob.byteLength),
        "cache-control": "private, max-age=300",
        /* a proxy is a working file, never something to hand onward */
        "content-disposition": "inline",
      },
    });
  }

  if (req.method === "POST") {
    const secret = process.env.WORKER_TOKEN;
    if (!secret) return json({ error: "locked" }, 503);
    if (!sameToken(req.headers.get("x-worker-token") || "", secret)) {
      return json({ error: "unauthorised" }, 401);
    }
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

    const id = safe(body.id), name = safe(body.name);
    if (!id || !name || typeof body.dataB64 !== "string") {
      return json({ error: "id, name and dataB64 required" }, 400);
    }
    const buf = Buffer.from(body.dataB64, "base64");
    if (!buf.length) return json({ error: "empty" }, 400);
    if (buf.length > MAX_BYTES) return json({ error: "too large", bytes: buf.length }, 413);

    await store.set(`${id}/${name}`, buf);

    /* record which previews exist, so the page knows what to draw */
    const rec = await read(body.id || "");
    if (rec && rec.clipJob) {
      const previews = new Set(rec.clipJob.previews || []);
      previews.add(name);
      rec.clipJob = {
        ...rec.clipJob,
        previews: [...previews],
        status: body.last ? "preview" : rec.clipJob.status,
      };
      await write(rec);
    }
    return json({ ok: true, name, bytes: buf.length });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/clip-preview" };
