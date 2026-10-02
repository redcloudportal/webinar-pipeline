import { CONNECTORS, statusOf, configured } from "../shared/connectors.mjs";

/* What is switched on, and does it actually work. Every connector reports its
   own state; ?deep=1 additionally runs each connector's live connection test. */

export default async (req) => {
  const deep = new URL(req.url).searchParams.get("deep") === "1";

  const rows = [];
  for (const c of CONNECTORS) {
    const row = statusOf(c);
    if (deep && configured(c).ok && typeof c.check === "function") {
      try {
        row.check = { ok: true, message: await c.check() };
      } catch (err) {
        row.check = { ok: false, message: err.message };
      }
    }
    rows.push(row);
  }

  const on = rows.filter((r) => r.state === "on").length;
  return new Response(
    JSON.stringify({
      connectors: rows,
      summary: `${on} of ${rows.length} connectors configured`,
      aiTitles: process.env.ANTHROPIC_API_KEY ? "on" : "off",
      checkedDeeply: deep,
    }, null, 2),
    { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
};

export const config = { path: "/api/health" };
