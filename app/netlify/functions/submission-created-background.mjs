import { makeId, factsFrom, newRecord, writeNew, mark, read } from "../shared/record.mjs";
import { CONNECTORS, runOne } from "../shared/connectors.mjs";

/* Fires on every verified form submission. Creates the webinar record, then
   runs every on-create connector. Background function (15 min, not 10 s) because
   uploading a client's asset pack is not a ten-second job.

   Nothing here can affect the client: by the time this runs, Netlify has already
   accepted the submission and told them it went through. */

function fileUrls(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .map((v) => (typeof v === "string" ? v : v?.url))
    .filter((u) => typeof u === "string" && /^https?:\/\//.test(u));
}

export default async (req) => {
  let payload;
  try {
    const body = await req.json();
    payload = body.payload || body;
  } catch (err) {
    console.error("dispatch: unreadable submission payload:", err.message);
    return new Response("bad payload", { status: 200 });
  }

  const data = payload?.data || {};
  const facts = factsFrom(data);
  /* the submission's own id seeds the suffix, so re-delivery of the SAME
     submission lands on the same record while a genuine second submission from
     the same company on the same day gets its own */
  const id = makeId(facts.company, payload?.created_at, payload?.id || data.submitted_at);

  /* The logo is recorded as its OWN list, not inferred from position.

     It used to be "files[0] is the logo", which held only while a client
     uploaded a logo file. Tick "use the logo from our website" and upload a
     headshot, and files[0] became the HEADSHOT — which was then drawn into the
     logo slot on every graphic. */
  const logo = fileUrls(data.logo);
  const assets = fileUrls(data.assets);
  const headshots = [1, 2, 3, 4]
    .map((n) => ({ speaker: n, url: fileUrls(data[`speaker${n}_headshot`])[0] }))
    .filter((h) => h.url);

  const rec = newRecord({
    id,
    facts,
    logoFiles: logo,
    files: [...logo, ...assets, ...headshots.map((h) => h.url)],
    headshots,
    raw: data,
  });

  let created;
  try {
    ({ created } = await writeNew(rec));
  } catch (err) {
    console.error("dispatch: could not save the record:", err.message);
    return new Response("store unavailable", { status: 200 });
  }
  if (!created) {
    /* Netlify re-delivered a submission we have already processed. Re-running
       the connectors is handled by their own idempotence, but overwriting the
       record would have thrown away the steps and log that make it idempotent. */
    console.log(`dispatch ${id}: record already exists — not overwritten`);
    return new Response("already dispatched", { status: 200 });
  }

  const onCreate = CONNECTORS.filter((c) => c.when === "on-create");
  const results = [];
  for (const c of onCreate) {
    /* Sequential, and each one is handed the record AS IT NOW STANDS. The
       graphics step saves the artwork address and the Box file ids; passing every
       connector the copy made at submission meant the social copy never saw those
       ids and the Mailchimp draft never saw the image. */
    results.push(await runOne(c, (await read(id)) || rec, mark));
  }

  const done = results.filter((r) => r.status === "done").length;
  const failed = results.filter((r) => r.status === "failed");
  console.log(
    `dispatch ${id}: ${done}/${onCreate.length} on-create connectors ran` +
    (failed.length ? ` — FAILED: ${failed.map((f) => `${f.key} (${f.error})`).join("; ")}` : ""),
  );
  return new Response("dispatched", { status: 200 });
};
