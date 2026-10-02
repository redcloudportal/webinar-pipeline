/* ─────────────────────────────────────────────────────────────
   Connectors.

   Every integration declares the env vars it needs. If they are
   missing it reports "off" and is skipped — it never throws, and
   an unconfigured connector can never block the ones that are
   configured. That is the whole point: this can be switched on
   one service at a time.

   Each connector exposes:
     key      stable id, also the step key on the record
     label    what a person calls it
     steps    which of the 29 documented steps it covers
     needs    env vars required
     when     'on-create' | { offsetMinutes } relative to the broadcast
     slow           true if it takes long enough that a synchronous
                    caller should dispatch it to a background function
                    rather than wait for it
     rebuildOnSchedule  true if its output embeds the broadcast date and
                    should be produced again once one is known
     needsSchedule  true if run() cannot work without a confirmed
                    broadcast time. Such a connector waits (reported
                    as 'waiting') instead of failing, and is fired the
                    moment /ops saves a start time.
     run(rec) does the work, returns { detail, ref }
     check()  optional connection test for /api/health
   ───────────────────────────────────────────────────────────── */

import * as trello from "./connectors/trello.mjs";
import * as wordpress from "./connectors/wordpress.mjs";
import * as mailchimp from "./connectors/mailchimp.mjs";
import * as invites from "./connectors/invites.mjs";
import * as sends from "./connectors/sends.mjs";
/* Google Drive filing was removed on 31 Aug 2026. It did the same step 25 job
   as Box — same folder naming, same files — and Red Cloud works in Box, so
   having both would have filed every submission twice. */
import * as box from "./connectors/box-file.mjs";
import * as graphics from "./connectors/graphics.mjs";
import * as social from "./connectors/social.mjs";

export const CONNECTORS = [
  box,        // step 25 — file the sheet and assets (Box)
  graphics,   // step 5 — build the webinar artwork from the Canva templates
  social,     // step 11 — the posts that go with them (after graphics: it links their files)
  trello,     // step 2
  wordpress,  // steps 4, 20, 21
  invites,    // step 8
  mailchimp,  // step 10
  ...sends.ALL, // steps 9, 12, 13, 15, 23
];

export function configured(c) {
  const missing = (c.needs || []).filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

export function statusOf(c) {
  const { ok, missing } = configured(c);
  return {
    key: c.key,
    label: c.label,
    steps: c.steps,
    when: typeof c.when === "string" ? c.when : `T${c.when.offsetMinutes >= 0 ? "+" : ""}${c.when.offsetMinutes}m`,
    state: ok ? "on" : "off",
    missing,
  };
}

/** How many times a connector may fail before the scheduler stops retrying it. */
export const MAX_ATTEMPTS = 3;

/** Run one connector against one record. Records the outcome either way. */
export async function runOne(c, rec, mark) {
  /* PAUSED: the DigitalOcean server's side-by-side test, while the Netlify site is
     still the live one. Nothing runs and NOTHING IS WRITTEN to the record — a
     "skipped" mark here would be copied over at cut-over and block the real run. */
  if (process.env.PAUSED !== "0" && process.env.WEBINAR_HOST === "droplet") {
    return { key: c.key, status: "paused" };
  }
  const { ok, missing } = configured(c);
  if (!ok) {
    await mark(rec.id, c.key, "skipped", `Not configured — missing ${missing.join(", ")}`);
    return { key: c.key, status: "skipped" };
  }
  if (rec.steps?.[c.key]?.status === "done") {
    return { key: c.key, status: "already-done" };   // idempotence: never fire twice
  }

  /* A connector that needs a broadcast time and has not been given one is not
     broken — it is early. Saying 'failed' here trained everyone to ignore a red
     dot that meant nothing. It waits, and /ops fires it when the time is set. */
  if (c.needsSchedule && !rec.schedule?.startTimeISO) {
    await mark(rec.id, c.key, "waiting", "Waiting for a broadcast start time — set one in /ops and this runs automatically.");
    return { key: c.key, status: "waiting" };
  }
  try {
    const out = await c.run(rec);
    /* A connector may decline the work rather than do it — a Box folder that
       was deleted on purpose, say. Marking that "done" would claim files were
       written that never were, so the returned status wins. */
    const status = out?.status === "skipped" ? "skipped" : "done";
    await mark(rec.id, c.key, status, out?.detail || "", out?.ref || null);
    return { key: c.key, status };
  } catch (err) {
    /* loud, and recorded where a person will see it */
    console.error(`connector ${c.key} failed for ${rec.id}:`, err.message);
    await mark(rec.id, c.key, "failed", err.message);
    return { key: c.key, status: "failed", error: err.message };
  }
}
