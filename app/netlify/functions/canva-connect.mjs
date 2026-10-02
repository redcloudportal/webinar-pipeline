import { canvaConfig, beginAuth, connectionStatus, SCOPES } from "../shared/canva.mjs";

/* Starts the one-time Canva authorisation, and reports whether it is already
   done. Gated on OPS_TOKEN: anyone who could hit this could otherwise start a
   flow that binds OUR site to THEIR Canva account. */

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

export default async (req) => {
  const secret = process.env.OPS_TOKEN;
  if (!secret) return json({ error: "locked", message: "OPS_TOKEN is not set on this site." }, 503);

  const url = new URL(req.url);
  /* accept the token in the query too, so this can be opened straight in a browser */
  const given = req.headers.get("x-ops-token") || url.searchParams.get("token") || "";
  if (!sameToken(given, secret)) return json({ error: "unauthorised" }, 401);

  const cfg = canvaConfig();
  if (!cfg.ready) {
    return json({
      error: "not_configured",
      message: `Canva is not configured yet — missing ${cfg.missing.join(", ")}`,
      hint: "Set CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in Netlify, then redeploy.",
    }, 503);
  }

  const status = await connectionStatus();

  /* ?start=1 sends the browser to Canva; without it, just report where we are */
  if (url.searchParams.get("start") === "1") {
    const { url: authUrl } = await beginAuth();
    return new Response(null, { status: 302, headers: { location: authUrl, "cache-control": "no-store" } });
  }

  return json({
    ...status,
    redirectUri: cfg.redirectUri,
    scopes: SCOPES,
    authoriseUrl: `${url.origin}/api/canva-connect?start=1&token=<your OPS_TOKEN>`,
    message: status.connected
      ? "Canva is connected. Open the authorise link again only if you need to reconnect."
      : "Not connected yet. Open the authorise link in a browser and approve it once.",
  });
};

export const config = { path: "/api/canva-connect" };
