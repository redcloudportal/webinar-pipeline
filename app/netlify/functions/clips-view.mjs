import { list, read, write, webinarDateKey } from "../shared/record.mjs";

/* /api/clips -- the clips workbench, deliberately NOT gated.

   /api/webinars carries client contact details and speaker emails, which is why
   it needs a token. This endpoint exists so the clips view can be opened without
   one, and it therefore returns a deliberately narrow slice: company, title,
   ticker, and the clip job. No contact, no speaker emails, no connector log.

   The trade: anyone with the URL can set timecodes and approve a cut on a
   webinar that is already in the system. That is a low-harm action -- it makes
   clips from a recording the client already has -- but it IS unauthenticated
   write access, and the page is noindex rather than secret. */

const json = (b, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const TC = /^\d{1,2}:\d{2}:\d{2}(\.\d{1,3})?$/;

/** Only what the workbench draws. Anything personal stays behind /api/webinars. */
function slim(r) {
  const j = r.clipJob || null;
  return {
    id: r.id,
    company: r.facts?.company || "",
    tickers: r.facts?.tickers || "",
    title: r.facts?.title || "",
    createdAt: r.createdAt,
    /* for the Mac Mini worker, to match a Box folder to its webinar: the folder's
       own id first, then the WEBINAR date (folders are named by it since Oct 2026,
       not by the submission date in the id), and whether the record is retired */
    boxFolder: r.folders?.box || null,
    webinarDate: webinarDateKey(r),
    retired: Boolean(r.foldersGone?.box),
    clipJob: j && {
      status: j.status || "",
      sourceRef: j.sourceRef || "",
      cropX: j.cropX || "0.65",
      marks: j.marks || {},
      suggestions: j.suggestions || [],
      transcript: j.transcript || null,
      files: j.files || [],
      previews: j.previews || [],
      /* the worker reads its own bookkeeping back through this endpoint, so
         these have to be here -- without them it cannot tell that a folder it
         used to know about has been deleted */
      boxFolderId: j.boxFolderId || null,
      archived: !!j.archived,
      detail: j.detail || "",
    },
  };
}

export default async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      const rec = await read(id);
      return rec ? json({ webinar: slim(rec) }) : json({ error: "not found" }, 404);
    }
    /* the list mirrors Box: a webinar with no folder is not shown. The record
       is untouched, so putting the folder back brings it straight back.

       ?all=1 includes the hidden ones -- the worker needs that, because it is
       the thing that decides what to hide, and it cannot restore a webinar it
       can no longer see. */
    const showAll = url.searchParams.get("all") === "1";
    const records = (await list()).filter((r) => showAll || !r.clipJob?.archived);
    return json({
      webinars: records.map((r) => {
        const s = slim(r);
        if (s.clipJob) s.clipJob = { ...s.clipJob, transcript: null };
        return s;
      }),
    });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const rec = await read(body.id || "");
    if (!rec) return json({ error: "not found" }, 404);

    /* Shapes an extra request may ask for. The standing four keep their fixed
       formats; only clips social adds on top get to choose. */
    const FORMATS = new Set(["16x9", "9x16split", "9x16", "1x1", "4x5"]);

    const j = body.clipJob || {};
    const marks = {};
    const entries = Object.entries(j.marks || {});
    if (entries.length > 24) {
      return json({ error: "too many clips",
                    message: "24 clips is the ceiling for one webinar." }, 400);
    }
    for (const [name, m] of entries) {
      if (!m || !TC.test(String(m.in)) || !TC.test(String(m.out))) {
        return json({ error: "bad timecode",
                      message: `${name} has a timecode that is not h:mm:ss(.mmm).` }, 400);
      }
      /* the name becomes a filename on the mini and an entry in the client's
         Box folder, so keep it to something that survives both */
      const clean = String(name).replace(/[^\w .,'&()-]/g, "").trim().slice(0, 60);
      if (!clean) {
        return json({ error: "bad name", message: "Every clip needs a name." }, 400);
      }
      marks[clean] = { in: String(m.in), out: String(m.out) };
      if (m.format && FORMATS.has(String(m.format))) marks[clean].format = String(m.format);
    }

    const prev = rec.clipJob || {};

    /* the reviewer watched the proxies and wants them in Box */
    if (body.export) {
      if (!(prev.previews || []).length) {
        return json({ error: "nothing to export", message: "No cut clips are waiting." }, 400);
      }
      rec.clipJob = { ...prev, status: "exporting", exportRequestedAt: new Date().toISOString() };
      rec.log.push({ at: new Date().toISOString(), step: "clips", status: "exporting",
                     detail: "Approved for export to Box" });
      await write(rec);
      return json({ ok: true, status: "exporting" });
    }

    /* transcript and suggestions belong to the worker; the browser only ever
       supplies the human's decisions */
    rec.clipJob = {
      ...prev,
      sourceRef: String(j.sourceRef ?? prev.sourceRef ?? "").trim().slice(0, 500),
      cropX: String(j.cropX ?? prev.cropX ?? "0.65").trim().slice(0, 8),
      marks,
      status: body.approve ? "approved" : (prev.status === "approved" ? "held" : prev.status || "draft"),
      approvedAt: body.approve ? new Date().toISOString() : prev.approvedAt || null,
    };
    rec.log.push({ at: new Date().toISOString(), step: "clips",
                   status: rec.clipJob.status,
                   detail: body.approve ? "Approved for cutting" : "Timecodes saved" });
    if (rec.log.length > 300) rec.log = rec.log.slice(-300);
    await write(rec);
    return json({ ok: true, status: rec.clipJob.status });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/clips" };
