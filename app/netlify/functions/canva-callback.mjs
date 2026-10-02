import { completeAuth } from "../shared/canva.mjs";

/* Where Canva sends the browser after someone approves the integration.

   Deliberately ungated: Canva calls this, not us, so there is no header to
   check. Its safety comes from `state` — the code is only exchanged when it
   arrives with a state this site generated and has not already used. */

const page = (title, body, ok) => new Response(
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<style>body{font-family:system-ui,-apple-system,sans-serif;background:#F7F3F0;color:#241E1F;
   display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
   .c{background:#fff;border:1px solid #E4DAD3;border-radius:16px;padding:32px;max-width:520px;
   box-shadow:0 8px 26px rgba(36,30,31,.07)}
   h1{font-size:20px;margin:0 0 10px;color:${ok ? "#1F7A52" : "#B3322F"}}
   p{color:#655B5D;line-height:1.6;margin:0 0 8px;font-size:15px}
   code{background:#F1EBE6;padding:2px 6px;border-radius:4px;font-size:13px}</style>` +
  `<div class="c"><h1>${title}</h1>${body}</div>`,
  { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
);

export default async (req) => {
  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) {
    return page("Canva declined the connection", `<p>${error}: ${url.searchParams.get("error_description") || ""}</p>`, false);
  }

  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return page("Something is missing", "<p>Canva did not send a code and state.</p>", false);

  try {
    const { scope } = await completeAuth(code, state);
    return page(
      "Canva is connected",
      `<p>The webinar site can now build graphics from your templates.</p>
       <p>Granted: <code>${(scope || "").split(" ").join("</code> <code>")}</code></p>
       <p>Nothing was shown to you or written to a file — the token went straight into the site's own storage.</p>`,
      true,
    );
  } catch (err) {
    return page("That did not work", `<p>${err.message}</p>`, false);
  }
};

export const config = { path: "/api/canva-callback" };
