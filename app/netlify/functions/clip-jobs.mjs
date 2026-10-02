import { list, read, write } from "../shared/record.mjs";

/* /api/clip-jobs -- the hand-off between this site and the Mac mini.

   The mini POLLS this endpoint outbound. Nothing is opened on the office
   network, it needs no static IP, and it is never reachable from the internet.

   Video never passes through here. A job carries a Box reference and the worker
   fetches from Box itself, so the 20 MB response ceiling is irrelevant.

   Flow:
     GET  ?stage=transcribe  -> jobs with a source and no transcript yet
     GET  ?stage=cut         -> jobs a person has approved
     POST {id, transcript, suggestions}  -> the mini reports what it found
     POST {id, status, files}            -> the mini reports what it cut

   Deliberately: the transcript and the suggested timecodes land on the RECORD,
   not in the client's Box folder. Nothing is written into Box until a person has
   approved, so a client browsing their own folder never sees a draft. */

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
  const secret = process.env.WORKER_TOKEN;
  if (!secret) return json({ error: "locked", message: "WORKER_TOKEN is not set." }, 503);
  if (!sameToken(req.headers.get("x-worker-token") || "", secret)) {
    return json({ error: "unauthorised" }, 401);
  }

  if (req.method === "GET") {
    const stage = new URL(req.url).searchParams.get("stage") || "transcribe";
    const records = await list();
    const jobs = records
      .filter((r) => {
        const j = r.clipJob;
        if (!j || !j.sourceRef) return false;
        if (stage === "cut")    return j.status === "approved";
        if (stage === "export")  return j.status === "exporting";
        return !j.transcript && j.status !== "transcribing";
      })
      .map((r) => ({
        id: r.id,
        company: r.facts?.company || "",
        sourceRef: r.clipJob.sourceRef,
        cropX: r.clipJob.cropX || "0.65",
        marks: r.clipJob.marks || {},
        /* company + tickers + bio: the vocabulary the transcriber needs */
        vocab: [r.facts?.company, r.facts?.tickers, r.facts?.bio]
          .filter(Boolean).join(". ").slice(0, 900),
      }));
    return json({ stage, jobs });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const rec = await read(body.id || "");
    if (!rec) return json({ error: "not found" }, 404);
    const at = new Date().toISOString();

    /* Folder bookkeeping is the one thing that must work on a webinar that has
       never had a clip job -- a submission with no Box folder needs hiding just
       as much as one that has been cut. Handled before the clipJob guard. */
    if (body.boxFolderId !== undefined || body.archived !== undefined) {
      rec.clipJob = { ...(rec.clipJob || {}) };
      if (body.boxFolderId !== undefined) {
        rec.clipJob.boxFolderId = String(body.boxFolderId || "").slice(0, 32) || null;
      }
      if (body.archived !== undefined) {
        const was = !!rec.clipJob.archived;
        rec.clipJob.archived = !!body.archived;
        if (was !== rec.clipJob.archived) {
          rec.log.push({ at, step: "clips", status: body.archived ? "archived" : "restored",
                         detail: body.archived ? "No Box folder - hidden from the clips view"
                                               : "Box folder back - visible again" });
        }
      }
      await write(rec);
      return json({ ok: true, archived: !!rec.clipJob.archived });
    }

    if (!rec.clipJob) return json({ error: "no clip job" }, 404);
    const prev = rec.clipJob;

    /* the mini claiming a job, so a double-poll cannot transcribe twice */
    if (body.claim) {
      if (prev.status === "transcribing") return json({ error: "already claimed" }, 409);
      rec.clipJob = { ...prev, status: "transcribing", claimedAt: at };
      await write(rec);
      return json({ ok: true, status: "transcribing" });
    }

    /* the transcript and the suggested cutdowns */
    if (Array.isArray(body.transcript)) {
      rec.clipJob = {
        ...prev,
        status: "review",
        transcribedAt: at,
        transcript: body.transcript.slice(0, 4000).map((s) => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          text: String(s.text || "").slice(0, 400),
        })),
        suggestions: Array.isArray(body.suggestions)
          ? body.suggestions.slice(0, 12).map((s) => ({
              name: String(s.name || "").slice(0, 40),
              in: String(s.in || ""),
              out: String(s.out || ""),
              why: String(s.why || "").slice(0, 200),
            }))
          : [],
      };
      rec.log.push({ at, step: "clips", status: "review",
                     detail: `Transcript ready, ${(body.suggestions || []).length} cutdown(s) suggested` });
      if (rec.log.length > 300) rec.log = rec.log.slice(-300);
      await write(rec);
      return json({ ok: true, status: "review" });
    }

    /* the result of a cut */
    if (["cutting", "done", "failed", "preview"].includes(body.status)) {
      rec.clipJob = { ...prev, status: body.status, [`${body.status}At`]: at,
                      detail: body.detail || "", files: body.files || prev.files || [] };
      /* a new cut invalidates the previous previews -- otherwise a deliverable
         that was re-cut in a different format leaves its old proxy listed and
         the reviewer watches a clip that no longer exists */
      if (body.status === "cutting") rec.clipJob.previews = [];
      if (body.status === "done") {
        rec.steps.clips = { status: "done", at,
                            detail: `${(body.files || []).length} file(s) cut`, ref: body.ref || null };
      } else if (body.status === "failed") {
        rec.steps.clips = { status: "failed", at, detail: body.detail || "worker reported failure", ref: null };
      }
      rec.log.push({ at, step: "clips", status: body.status, detail: body.detail || "" });
      if (rec.log.length > 300) rec.log = rec.log.slice(-300);
      await write(rec);
      return json({ ok: true, status: body.status });
    }

    return json({ error: "nothing to do" }, 400);
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/clip-jobs" };
