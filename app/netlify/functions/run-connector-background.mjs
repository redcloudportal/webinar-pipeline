import { read, write, mark } from "../shared/record.mjs";
import { CONNECTORS, runOne } from "../shared/connectors.mjs";

/* Runs one connector against one record, out of band.

   Drawing the full set of graphics takes ~25 seconds. That fits inside a synchronous
   function today, but only just, and a slow Box day would push it past the
   limit — the caller would see a timeout while the work carried on invisibly.
   Anything marked `slow` is dispatched here instead, where the ceiling is
   fifteen minutes rather than tens of seconds. */

export default async (req) => {
  let payload;
  try { payload = await req.json(); } catch { return new Response("bad json", { status: 200 }); }

  const { id, key } = payload || {};
  if (!id || !key) return new Response("bad request", { status: 200 });

  const connector = CONNECTORS.find((c) => c.key === key);
  if (!connector) {
    console.error(`run-connector: no connector called ${key}`);
    return new Response("unknown connector", { status: 200 });
  }

  const rec = await read(id);
  if (!rec) {
    console.error(`run-connector: no record ${id}`);
    return new Response("unknown record", { status: 200 });
  }

  const out = await runOne(connector, rec, mark);
  console.log(`run-connector ${id}:${key} -> ${out.status}${out.error ? ` (${out.error})` : ""}`);

  /* Whatever is built from this connector's output runs now that it has
     finished — the Mailchimp draft is made from the graphics, so it must not
     refresh until they are redrawn. Only those that opt in via `shouldChain`
     (a webinar that already has a draft), so redrawing an old record's
     graphics never creates a campaign. Each failure is its own. */
  if (out.status === "done") {
    for (const dep of CONNECTORS.filter((c) => c.after === key)) {
      const fresh = await read(id);
      if (!fresh || (typeof dep.shouldChain === "function" && !dep.shouldChain(fresh))) continue;
      if (fresh.steps?.[dep.key]) delete fresh.steps[dep.key];      // clear so runOne will act
      await write(fresh);
      const d = await runOne(dep, await read(id), mark);
      console.log(`run-connector ${id}:${dep.key} (after ${key}) -> ${d.status}${d.error ? ` (${d.error})` : ""}`);
    }
  }
  return new Response("done", { status: 200 });
};
