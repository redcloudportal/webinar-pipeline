import { list, read, write, mark, longDate, knownFolder, noteFolderGone } from "../shared/record.mjs";
import { getAccessToken as boxToken, deleteFolder } from "../shared/box.mjs";
import { CONNECTORS, runOne, statusOf } from "../shared/connectors.mjs";
import { ANALYSTS, findAnalyst, FIRM } from "../shared/analysts.mjs";
import { registrationPageHtml } from "../shared/regpage.mjs";
import { socialRows, socialCsv, socialText } from "../shared/social.mjs";
import { listCampaigns, sendTest, readCampaign, createDesignTestDraft } from "../shared/connectors/mailchimp.mjs";
import { eblastBody, eblastSubject, eblastPreview, artUrl, DESIGN_IMAGES } from "../shared/eblast.mjs";

/* The operations API behind /ops.

   Holds client contact details, so it is gated on a shared secret. If OPS_TOKEN
   is unset the endpoint refuses everything rather than defaulting to open. */

const json = (b, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/* constant-time-ish compare, so the token cannot be guessed a character at a time */
function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Hand a slow connector to the background function and return at once. */
async function dispatch(origin, id, key) {
  await fetch(`${origin}/.netlify/functions/run-connector-background`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, key }),
  });
}

export default async (req) => {
  const secret = process.env.OPS_TOKEN;
  if (!secret) {
    return json({ error: "locked", message: "OPS_TOKEN is not set on this site, so the operations view is closed." }, 503);
  }
  const given = req.headers.get("x-ops-token") || "";
  if (!sameToken(given, secret)) return json({ error: "unauthorised" }, 401);

  const url = new URL(req.url);

  if (req.method === "GET") {
    const records = await list();
    return json({
      connectors: CONNECTORS.map(statusOf),
      /* the research team, so /ops renders a dropdown instead of a text box */
      analysts: ANALYSTS.map((a) => ({ id: a.id, name: a.name, title: a.title })),
      webinars: records.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        company: r.facts.company,
        tickers: r.facts.tickers,
        title: r.facts.title,
        contact: r.facts.contact,
        speakers: r.facts.speakers,
        schedule: r.schedule,
        steps: r.steps,
        fileCount: (r.files || []).length,
        /* Its Box folder was deliberately deleted, so this is finished with —
           the test submissions from build week. /ops hides these by default
           rather than guessing from the company name. */
        retired: Boolean(r.foldersGone?.box),
        /* which Box folder it files into — two records can share one */
        boxFolder: r.folders?.box || null,
        /* the Clips view needs the bio (it primes the transcriber's vocabulary)
           and whatever the Mac mini has reported back so far */
        facts: { bio: r.facts.bio || "" },
        clipJob: r.clipJob || null,
        log: r.log.slice(-40),
      })),
    });
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

    /* Which Mailchimp campaign to use as the template. Needs no webinar, so it
       is answered before the record lookup. Read-only, and returns no secret. */
    /* One campaign's settings and body, read-only. */
    if (body.action === "mailchimp_campaign") {
      if (!process.env.MAILCHIMP_API_KEY) return json({ error: "MAILCHIMP_API_KEY is not set." }, 400);
      if (!/^[a-f0-9]{10}$/.test(String(body.campaign || ""))) return json({ error: "bad id" }, 400);
      try { return json({ ok: true, campaign: await readCampaign(body.campaign) }); }
      catch (err) { return json({ error: "mailchimp", message: err.message, status: err.status }, 502); }
    }

    if (body.action === "mailchimp_campaigns") {
      if (!process.env.MAILCHIMP_API_KEY) return json({ error: "MAILCHIMP_API_KEY is not set." }, 400);
      try { return json({ ok: true, campaigns: await listCampaigns() }); }
      catch (err) { return json({ error: "mailchimp", message: err.message }, 502); }
    }

    const rec = await read(body.id || "");
    if (!rec) return json({ error: "not found" }, 404);

    /* set the Red Cloud side of the record — time, moderator, links.
       startTimeISO is the only date: every client-facing date is derived from it. */
    if (body.action === "schedule") {
      const s = body.schedule || {};
      if (s.startTimeISO && isNaN(new Date(s.startTimeISO))) {
        return json({ error: "bad date", message: "startTimeISO is not a valid date." }, 400);
      }
      const hadTime = Boolean(rec.schedule?.startTimeISO);
      rec.schedule = { ...rec.schedule, ...s };
      rec.log.push({ at: new Date().toISOString(), step: "schedule", status: "done", detail: "Schedule updated" });
      await write(rec);

      /* The connectors that were parked for want of a broadcast time are now
         runnable. Without this the calendar invites had no route to ever run:
         they are on-create, there is no schedule at create time, and the
         scheduler only touches timed connectors. */
      let ran = [];
      if (!hadTime && rec.schedule.startTimeISO) {
        const parked = CONNECTORS.filter(
          (c) => c.when === "on-create" && c.needsSchedule && rec.steps?.[c.key]?.status !== "done",
        );
        /* anything whose output quotes the date was built with "TBC" and is now
           wrong — clear it so it is drawn again with the real date */
        const stale = CONNECTORS.filter((c) => c.rebuildOnSchedule && rec.steps?.[c.key]);
        if (stale.length) {
          const fresh = await read(rec.id);
          for (const c of stale) delete fresh.steps[c.key];
          await write(fresh);
        }
        const queue = [...parked, ...stale];
        const queued = new Set(queue.map((c) => c.key));
        for (const c of queue) {
          /* built from another connector's output, and that one is being redrawn
             in the background right now: running it here would race ahead and
             pick up the OLD artwork. The background runner chains it afterwards. */
          if (c.after && queued.has(c.after)) {
            ran.push({ key: c.key, status: "after " + c.after });
            continue;
          }
          if (c.slow) {
            await dispatch(url.origin, rec.id, c.key);
            ran.push({ key: c.key, status: "started" });
            continue;
          }
          const out = await runOne(c, await read(rec.id), mark);
          ran.push({ key: c.key, status: out.status });
        }
      }

      return json({
        ok: true,
        schedule: rec.schedule,
        broadcastDate: longDate(await read(rec.id)),
        ran,
      });
    }

    /* the Clips view: save timecodes, and optionally release the job to cut */
    if (body.action === "clips") {
      const TC = /^\d{1,2}:\d{2}:\d{2}(\.\d{1,3})?$/;
      const j = body.clipJob || {};
      const marks = {};
      for (const [name, m] of Object.entries(j.marks || {})) {
        if (!m || !TC.test(String(m.in)) || !TC.test(String(m.out))) {
          return json({ error: "bad timecode",
                        message: `${name} has a timecode that is not h:mm:ss(.mmm).` }, 400);
        }
        marks[name] = { in: String(m.in), out: String(m.out) };
      }
      const prev = rec.clipJob || {};
      /* transcript and suggestions belong to the worker -- never overwrite them
         from the browser, only the human's decisions */
      rec.clipJob = {
        ...prev,
        sourceRef: String(j.sourceRef ?? prev.sourceRef ?? "").trim(),
        cropX: String(j.cropX ?? prev.cropX ?? "0.65").trim(),
        marks,
        status: body.approve ? "approved" : (prev.status === "approved" ? "held" : prev.status || "draft"),
        approvedAt: body.approve ? new Date().toISOString() : prev.approvedAt || null,
      };
      rec.log.push({ at: new Date().toISOString(), step: "clips",
                     status: rec.clipJob.status,
                     detail: body.approve ? "Approved for cutting" : "Timecodes saved" });
      await write(rec);
      return json({ ok: true, status: rec.clipJob.status });
    }

    /* re-run a single connector by hand, after fixing whatever broke */
    if (body.action === "retry") {
      const c = CONNECTORS.find((x) => x.key === body.key);
      if (!c) return json({ error: "unknown connector" }, 400);
      if (rec.steps?.[c.key]) delete rec.steps[c.key];   // clear so runOne will act
      await write(rec);

      /* Slow work goes out of band. /ops polls the record anyway, so the step
         appearing as done a few seconds later is the same experience without
         the risk of the request dying mid-run. */
      if (c.slow) {
        await mark(rec.id, c.key, "running", "Started — refresh in a moment to see the result.");
        await dispatch(url.origin, rec.id, c.key);
        return json({ ok: true, result: { key: c.key, status: "started" } });
      }

      const out = await runOne(c, await read(rec.id), mark);
      return json({ ok: out.status !== "failed", result: out });
    }

    /* Remove a webinar's Box folder and stop anything from rebuilding it.
       Test submissions accumulate, and deleting the folder by hand was not
       enough on its own — the rebuild used to put it straight back. This
       deletes it AND writes the tombstone, so it stays gone. */
    if (body.action === "discard") {
      const folderId = await knownFolder(rec.id, "box");
      let outcome = "no Box folder was recorded";
      if (folderId) {
        const r = await deleteFolder(folderId, await boxToken());
        outcome = r.alreadyGone ? "folder was already gone" : "folder deleted (recoverable from Box trash)";
      }
      await noteFolderGone(rec.id, "box");        // tombstone regardless

      return json({ ok: true, result: { id: rec.id, outcome, record: "kept, marked so it will not rebuild" } });
    }

    /* Point a record at a logo we can actually draw.

       Some clients' sites serve WebP, which the renderer cannot decode, so the
       graphics come out with an empty logo slot. Convert the file once, drop
       it in public/logos/, then aim the record at it here. The next graphics
       run — and every one after — picks it up. */
    if (body.action === "logo") {
      const url = String(body.url || "").trim();
      if (!/^https:\/\/[^\s]+\.(png|jpg|jpeg)$/i.test(url)) {
        return json({ error: "bad url", message: "Needs an https URL ending in .png, .jpg or .jpeg." }, 400);
      }
      rec.facts = rec.facts || {};
      rec.facts.logoUrl = url;
      await write(rec);
      return json({ ok: true, result: { id: rec.id, logoUrl: url } });
    }

    /* Build the WordPress registration page as one block of plain HTML.

       The site's own pages are Elementor + JetEngine, and the host strips the
       Authorization header off /wp-json/, so nothing can be written to
       WordPress at all. This hands back the finished page instead: paste it
       into a new page as a single Custom HTML block. Every size and colour is
       taken from the real Red Cloud pages, so it comes out looking the same.

       Read-only — it touches nothing and can be pressed at any time. */
    if (body.action === "regpage") {
      const f = rec.facts || {};
      const analyst = findAnalyst(rec.schedule?.moderator);
      const html = registrationPageHtml({
        company: f.company,
        title: f.title,
        bio: f.bio,
        dateLong: longDate(rec),
        time: rec.schedule?.startTime || f.clientTime,
        website: f.website,
        logoUrl: f.logoUrl,
        presenters: f.speakers || [],
        analyst: analyst ? { ...analyst, firm: FIRM } : null,
        registerUrl: rec.schedule?.streamyardUrl,
        researchUrl: f.researchUrl,
      });

      /* the things a person still has to do by hand, said plainly */
      const todo = [];
      if (!rec.schedule?.streamyardUrl) todo.push("no StreamYard link yet — the Register Now buttons point nowhere");
      if (!analyst) todo.push("no Red Cloud analyst chosen — pick one above and press this again");
      if (!f.logoUrl) todo.push("no client logo on the record — the page shows the Red Cloud logo only");
      todo.push("paste the site's existing question form where the page says QUESTIONS FORM");

      return json({ ok: true, result: { id: rec.id, html, todo } });
    }

    /* The social copy, to read or to paste. Read-only: it is built from the
       record every time, so it is never out of step with the date on it. */
    if (body.action === "social") {
      const rows = socialRows(rec);
      return json({ ok: true, result: {
        id: rec.id,
        rows,
        text: socialText(rec),
        csv: socialCsv(rec),
        needs: [
          rec.schedule?.registrationUrl ? null : "registration link",
          rec.schedule?.replayUrl ? null : "replay link",
          (rec.assets && Object.keys(rec.assets).length) ? null : "asset links (run graphics)",
        ].filter(Boolean),
      } });
    }

    /* The invite eblast, ready to paste into Mailchimp.

       Mailchimp is off (no API key), so the draft cannot be created for them;
       this hands over the same HTML the connector would PUT, with the same
       subject and preview text. Read-only. */
    if (body.action === "eblast") {
      const img = artUrl(rec, "top", url.origin);
      return json({ ok: true, result: {
        id: rec.id,
        subject: eblastSubject(rec),
        preview: eblastPreview(rec),
        image: img,
        html: eblastBody(rec, { origin: url.origin }, body.design),
        todo: [
          img ? null : "no invite image yet — run the graphics step, then press this again",
          rec.schedule?.registrationUrl ? null : "registration link is a guess until you set it above",
          "send yourself a test, then get it approved, before scheduling",
        ].filter(Boolean),
      } });
    }

    /* A test copy of the Mailchimp draft, to named people only.

       Restricted to @redcloudfs.com addresses and at most three: tests go to
       the people building this, never to a distribution list. This is the only
       thing in the system that sends anything, it cannot reach an audience, and
       it will not touch a campaign that is anything other than a draft. */
    if (body.action === "mailchimp_test") {
      const emails = (Array.isArray(body.emails) ? body.emails : []).map((e) => String(e).trim().toLowerCase());
      if (!emails.length || emails.length > 3) return json({ error: "emails", message: "Give one to three addresses." }, 400);
      if (!emails.every((e) => /^[^\s@]+@redcloudfs\.com$/.test(e))) {
        return json({ error: "emails", message: "Test sends only go to @redcloudfs.com addresses." }, 400);
      }
      /* by default the webinar's own draft; `campaign` re-sends a test of a
         design-test draft instead, without building another one. sendTest still
         refuses anything that is not a plain draft. */
      const pick = String(body.campaign || "");
      if (pick && !/^[a-f0-9]{10}$/.test(pick)) return json({ error: "bad id" }, 400);
      const cid = pick || rec.campaigns?.mailchimp?.id;
      if (!cid) return json({ error: "no draft", message: "This webinar has no Mailchimp draft yet. Run the Mailchimp step first." }, 400);
      try {
        const out = await sendTest(cid, emails);
        rec.log.push({ at: new Date().toISOString(), step: "mailchimp", status: "test", detail: `Test sent to ${emails.join(", ")}` });
        await write(rec);
        return json({ ok: true, result: out });
      } catch (err) { return json({ error: "mailchimp", message: err.message }, 502); }
    }

    /* Try a design without switching anything: build it into its own labelled
       draft and send ONE test of it. Same address rule as mailchimp_test. */
    if (body.action === "mailchimp_design_test") {
      const design = DESIGN_IMAGES[body.design] ? body.design : "team";
      const emails = (Array.isArray(body.emails) ? body.emails : []).map((e) => String(e).trim().toLowerCase());
      if (!emails.length || emails.length > 3) return json({ error: "emails", message: "Give one to three addresses." }, 400);
      if (!emails.every((e) => /^[^\s@]+@redcloudfs\.com$/.test(e))) {
        return json({ error: "emails", message: "Test sends only go to @redcloudfs.com addresses." }, 400);
      }
      const slots = DESIGN_IMAGES[design];
      const tokens = slots.map((s) => rec.art?.[s]?.token).filter(Boolean);
      if (tokens.length !== slots.length) return json({ error: "images", message: "This webinar's email images are not drawn yet — run graphics first." }, 400);
      try {
        const draft = await createDesignTestDraft(rec, design, eblastBody(rec, {}, design), tokens);
        const out = await sendTest(draft.id, emails);
        rec.log.push({ at: new Date().toISOString(), step: "mailchimp", status: "test",
                       detail: `Design test (${design}) sent to ${emails.join(", ")} from draft ${draft.web_id}` });
        await write(rec);
        return json({ ok: true, result: { ...out, draft } });
      } catch (err) { return json({ error: "mailchimp", message: err.message }, 502); }
    }

    /* Retire a record WITHOUT touching Box — for a record that shares its
       folder with a real one (two same-day submissions from one company file into
       the same folder). `discard` would trash that folder and the real webinar's
       files with it. This unlinks the record from the folder, tombstones it so
       nothing ever rebuilds into it, and forgets its Mailchimp draft so a redraw
       can never refresh it. The record is kept, retired, as every record is. */
    if (body.action === "retire") {
      const shared = rec.folders?.box || null;
      if (rec.folders) delete rec.folders.box;
      rec.foldersGone = { ...(rec.foldersGone || {}), box: true };
      if (rec.campaigns) delete rec.campaigns.mailchimp;
      rec.retiredReason = String(body.reason || "").slice(0, 200) || null;
      rec.log.push({ at: new Date().toISOString(), step: "retire", status: "done",
                     detail: `Retired${rec.retiredReason ? ` — ${rec.retiredReason}` : ""}; Box folder ${shared || "(none)"} left untouched` });
      await write(rec);
      return json({ ok: true, result: { id: rec.id, unlinkedFrom: shared, boxTouched: false } });
    }

    return json({ error: "unknown action" }, 400);
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/webinars" };
