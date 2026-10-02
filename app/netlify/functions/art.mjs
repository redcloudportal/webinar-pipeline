import { artStore } from "../shared/record.mjs";

/* The one graphic an email is allowed to load.

   Public on purpose — Mailchimp, Outlook and Gmail all fetch images with no
   credentials, so anything an email shows has to be reachable without a login.
   The token in the path is random, so only someone holding the link (the
   client, the campaign, the people it is sent to) can reach it, and nothing
   here lists what exists.

   Immutable: the token changes when the artwork is redrawn, so a cached copy
   can never be the stale one. */

export default async (req) => {
  const token = new URL(req.url).pathname.split("/").pop().replace(/\.png$/i, "");
  if (!/^[a-f0-9]{32}$/i.test(token)) return new Response("Not found", { status: 404 });

  const png = await artStore().get(token, { type: "arrayBuffer" });
  if (!png) return new Response("Not found", { status: 404 });

  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=31536000, immutable",
      "x-robots-tag": "noindex",
    },
  });
};

export const config = { path: "/art/:token" };
