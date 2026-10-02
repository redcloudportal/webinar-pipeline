import crypto from "node:crypto";
import { getStore } from "./blobs.mjs";   // was @netlify/blobs — see shared/blobs.mjs

/* ─────────────────────────────────────────────────────────────
   Canva Connect.

   Unlike Box, Canva has no server-to-server grant: a person must
   authorise once in a browser (OAuth 2.0 authorization code with
   PKCE), and the site then holds a refresh token.

   TWO THINGS THAT WILL BITE IF FORGOTTEN:

   · PKCE means the code_verifier created when the flow STARTS
     must still be available when Canva redirects back. Those are
     two separate function invocations with nothing in common, so
     the verifier is parked in a blob keyed by `state`.

   · Canva ROTATES refresh tokens. Every refresh returns a new one
     and invalidates the old. Failing to store the new token
     breaks the next refresh — and it breaks it silently, an hour
     later, not at deploy time.
   ───────────────────────────────────────────────────────────── */

const AUTH_URL  = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const API       = "https://api.canva.com/rest/v1";

export const SCOPES = [
  "asset:write",
  "brandtemplate:content:read",
  "brandtemplate:meta:read",
  "design:content:read",
  "design:content:write",
  "design:meta:read",
];

/* pending PKCE verifiers live briefly; the long-lived token lives separately */
const pending = () => getStore({ name: "canva-oauth", consistency: "strong" });
const tokens  = () => getStore({ name: "canva-tokens", consistency: "strong" });

const PENDING_TTL_MS = 10 * 60 * 1000;

export function canvaConfig() {
  const clientId     = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  const redirectUri  = process.env.CANVA_REDIRECT_URI
    || "https://redcloud-webinar-form.netlify.app/api/canva-callback";

  const missing = [
    !clientId     && "CANVA_CLIENT_ID",
    !clientSecret && "CANVA_CLIENT_SECRET",
  ].filter(Boolean);

  return { clientId, clientSecret, redirectUri, missing, ready: missing.length === 0 };
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Build the authorize URL and park the PKCE verifier against its state. */
export async function beginAuth() {
  const cfg = canvaConfig();
  const verifier  = b64url(crypto.randomBytes(64));           // 43-128 chars per the spec
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state     = b64url(crypto.randomBytes(24));

  await pending().setJSON(state, { verifier, at: Date.now() });

  const url = `${AUTH_URL}?` + new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: "s256",
    scope: SCOPES.join(" "),
    response_type: "code",
    client_id: cfg.clientId,
    state,
    redirect_uri: cfg.redirectUri,
  });

  return { url, state };
}

/** Exchange the returned code for tokens. Verifies state, so a stray hit does nothing. */
export async function completeAuth(code, state) {
  const cfg = canvaConfig();

  const parked = await pending().get(state, { type: "json" });
  if (!parked) throw new Error("Unknown or already-used state — start the connection again.");
  await pending().delete(state);
  if (Date.now() - parked.at > PENDING_TTL_MS) {
    throw new Error("That authorisation link expired. Start the connection again.");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: parked.verifier,
      redirect_uri: cfg.redirectUri,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Canva rejected the code (${res.status}). ${body.error_description || body.error || ""}`.trim());
  }

  await tokens().setJSON("connection", {
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    expiresAt: Date.now() + ((body.expires_in || 3600) - 60) * 1000,
    scope: body.scope || SCOPES.join(" "),
    connectedAt: new Date().toISOString(),
  });

  return { scope: body.scope };
}

/** A usable access token, refreshing when needed. Stores the rotated refresh token. */
export async function accessToken() {
  const cfg = canvaConfig();
  const saved = await tokens().get("connection", { type: "json" });
  if (!saved?.refreshToken) {
    throw new Error("Canva is not connected yet — open /api/canva-connect to authorise it.");
  }
  if (saved.accessToken && Date.now() < saved.expiresAt) return saved.accessToken;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved.refreshToken }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Canva would not refresh the connection (${res.status}). ${body.error_description || body.error || ""} ` +
      `Someone needs to re-authorise it at /api/canva-connect.`.trim(),
    );
  }

  await tokens().setJSON("connection", {
    ...saved,
    /* the rotated token replaces the old one, which Canva has now invalidated */
    refreshToken: body.refresh_token || saved.refreshToken,
    accessToken: body.access_token,
    expiresAt: Date.now() + ((body.expires_in || 3600) - 60) * 1000,
    refreshedAt: new Date().toISOString(),
  });

  return body.access_token;
}

export async function connectionStatus() {
  const saved = await tokens().get("connection", { type: "json" }).catch(() => null);
  if (!saved?.refreshToken) return { connected: false };
  return {
    connected: true,
    connectedAt: saved.connectedAt,
    refreshedAt: saved.refreshedAt || null,
    scope: saved.scope,
  };
}

/** Authenticated Canva API call with a readable error. */
export async function canvaFetch(path, opts = {}) {
  const token = await accessToken();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.message || body?.error || `HTTP ${res.status}`;
    const err = new Error(`Canva API ${res.status} on ${path}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

/* ── assets ────────────────────────────────────────────────────
   The Connect API takes raw bytes, unlike the interactive tools
   which only accept a public URL. That matters: a client's logo
   can go from Box straight into Canva without ever being made
   publicly reachable.
   ───────────────────────────────────────────────────────────── */

const UPLOAD_URL = "https://api.canva.com/rest/v1/asset-uploads";

/** Upload a Buffer as a Canva asset and return its id. */
export async function uploadAsset(data, name) {
  const token = await accessToken();

  /* the name travels base64 in a header, so it survives odd characters */
  const meta = JSON.stringify({
    name_base64: Buffer.from(String(name || "asset"), "utf8").toString("base64"),
  });

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "asset-upload-metadata": meta,
    },
    body: data,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Canva refused the asset (${res.status}). ${body.message || body.error || ""}`.trim());
  }

  let job = body.job;
  for (let i = 0; i < 30 && job?.status !== "success"; i++) {
    if (job?.status === "failed") throw new Error(job.error?.message || "asset upload failed");
    await new Promise((r) => setTimeout(r, 1500));
    job = (await canvaFetch(`/asset-uploads/${job.id}`)).job;
  }
  const id = job?.asset?.id;
  if (!id) throw new Error("asset upload did not return an id");
  return id;
}
