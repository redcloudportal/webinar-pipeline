import { getStore } from "@netlify/blobs";

/* The ONLY function left on Netlify (since the move to webinars.redcloudfs.com,
   Oct 2026). Email campaigns already sent load their images from
   redcloud-webinar-form.netlify.app/art/<token>.png, so those addresses must keep
   answering. New artwork is served by the new site. Read-only. */
export default async (req) => {
  const token = new URL(req.url).pathname.split("/").pop().replace(/\.png$/i, "");
  if (!/^[a-f0-9]{32}$/i.test(token)) return new Response("Not found", { status: 404 });
  const png = await getStore({ name: "webinar-art", consistency: "strong" }).get(token, { type: "arrayBuffer" });
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable", "x-robots-tag": "noindex" } });
};
export const config = { path: "/art/:token" };
