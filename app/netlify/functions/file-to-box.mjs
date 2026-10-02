import { boxConfig, getAccessToken, ensureFolder, uploadFile, safeName, fileLink } from "../shared/box.mjs";

/* Takes a generated graphic straight from Canva into Box, so nothing has to be
   downloaded to somebody's laptop and dragged across.

   Gated on OPS_TOKEN, and — because this fetches a URL server-side — it will
   only read from Canva's own export host. That allowlist is the whole SSRF
   defence: there is no way to point this at an internal address, because there
   is no way to point it anywhere except Canva. */

const ALLOWED_HOSTS = new Set([
  "export-download.canva.com",
  "media.canva.com",
]);

const MAX_BYTES = 40 * 1024 * 1024;   // generous for a print-resolution poster

const json = (b, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/* constant-time-ish compare, so the token cannot be guessed a character at a time */
function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (req) => {
  const secret = process.env.OPS_TOKEN;
  if (!secret) {
    return json({ error: "locked", message: "OPS_TOKEN is not set on this site, so this endpoint is closed." }, 503);
  }
  if (!sameToken(req.headers.get("x-ops-token") || "", secret)) {
    return json({ error: "unauthorised" }, 401);
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const cfg = boxConfig();
  if (!cfg.ready) {
    return json({ error: "not_configured", message: `Box is not configured — missing ${cfg.missing.join(", ")}` }, 503);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const { url, folderId, name, subfolder } = body || {};
  if (!url || !folderId || !name) {
    return json({ error: "bad request", message: "url, folderId and name are all required." }, 400);
  }

  let target;
  try { target = new URL(String(url)); } catch { return json({ error: "bad url" }, 400); }
  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    return json({
      error: "host not allowed",
      message: `This endpoint only reads from Canva exports (${[...ALLOWED_HOSTS].join(", ")}).`,
    }, 400);
  }

  /* fetch the export */
  let buf, contentType;
  try {
    const res = await fetch(target, { redirect: "follow" });
    if (!res.ok) throw new Error(`Canva returned ${res.status}`);
    contentType = res.headers.get("content-type") || "application/octet-stream";
    const raw = await res.arrayBuffer();
    if (raw.byteLength > MAX_BYTES) throw new Error(`file is ${Math.round(raw.byteLength / 1e6)} MB, over the limit`);
    buf = Buffer.from(raw);
  } catch (err) {
    return json({ error: "fetch_failed", message: `Could not read the export: ${err.message}` }, 502);
  }

  try {
    const token = await getAccessToken();
    /* an optional subfolder keeps generated artwork separate from the client's own uploads */
    const parent = subfolder
      ? await ensureFolder(safeName(subfolder, "Graphics"), String(folderId), token)
      : String(folderId);

    const file = await uploadFile({
      name: safeName(name, "graphic.png"),
      mimeType: contentType,
      data: buf,
      parentId: parent,
      token,
    });

    return json({
      ok: true,
      message: `Filed "${file.name}" into Box.`,
      id: file.id,
      link: fileLink(file.id),
      bytes: buf.length,
    });
  } catch (err) {
    return json({ error: "upload_failed", message: err.message }, 502);
  }
};

export const config = { path: "/api/file-to-box" };
