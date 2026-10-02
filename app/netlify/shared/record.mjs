import { getStore } from "./blobs.mjs";   // was @netlify/blobs — see shared/blobs.mjs
import crypto from "node:crypto";

/* ─────────────────────────────────────────────────────────────
   The webinar record.

   One submission becomes one record. Every connector reads its
   fields from here and writes its result back here, so there is
   a single place that answers "what happened to this webinar".

   Kept in Netlify Blobs — no new vendor, no database to run.
   ───────────────────────────────────────────────────────────── */

const STORE = "webinars";

/* Red Cloud runs on Eastern time and every client-facing date is written in it.
   startTimeISO is stored as UTC, so a 8pm ET broadcast is 00:00 UTC the NEXT
   day — formatting without a fixed zone would print tomorrow's date on the
   invite. Override with DISPLAY_TZ if the business ever moves. */
export const DISPLAY_TZ = process.env.DISPLAY_TZ || "America/Toronto";

export const store = () => getStore({ name: STORE, consistency: "strong" });

/* ── artwork an email can actually load ───────────────────────
   Mailchimp cannot read a Box file: the graphics are in a private folder and
   an email client fetches images anonymously. One graphic per webinar is
   therefore copied here and served from the site.

   The key is a random token, not the record id. Record ids are predictable
   (`2026-10-07-company-xxxx`) and a webinar's artwork is confidential until it
   is announced, so a guessable URL would publish it early. */
export const artStore = () => getStore({ name: "webinar-art", consistency: "strong" });

export async function publishArt(id, slot, png, meta) {
  try {
    const rec = await read(id);
    if (!rec) return null;
    /* A NEW token every time the artwork is drawn. The file is served with an
       immutable one-year cache, so reusing a token would let an email client keep
       showing the old date after the graphic was redrawn. Old tokens are left
       alone on purpose: a campaign already sent keeps showing what it was sent
       with. */
    const token = crypto.randomUUID().replace(/-/g, "");
    await artStore().set(token, png, { metadata: { contentType: "image/png", ...meta } });
    /* one per slot — the team's invite carries two images, top and bottom. The
       old single-image shape (rec.art.token) is simply replaced. */
    const art = rec.art && !rec.art.token ? rec.art : {};
    art[slot] = { token, ...meta, at: new Date().toISOString() };
    rec.art = art;
    await write(rec);
    return art[slot];
  } catch (err) {
    console.error(`record.publishArt(${id}, ${slot}) failed:`, err.message);
    return null;
  }
}

/* ── the broadcast moment ──────────────────────────────────────
   startTimeISO is the ONE source of truth for when a webinar is.
   Everything dated is derived from it, so there is no second
   field that can drift out of agreement with it.
   ───────────────────────────────────────────────────────────── */

/** The confirmed broadcast start, or null if Red Cloud has not set one yet. */
export function startOf(rec) {
  const iso = rec?.schedule?.startTimeISO;
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

/** 2026-09-24, in Red Cloud's own timezone. Used for ids and folder names. */
export function dateKey(rec) {
  const d = startOf(rec);
  if (!d) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** The WEBINAR's date as 2026-10-07, or null.

   The confirmed broadcast date when Red Cloud has set one, otherwise the date
   the client gave us. Distinct from the submission date, which is simply when
   the form was filled in — a webinar booked in September for a November
   broadcast belongs under November everywhere a person looks for it. */
export function webinarDateKey(rec) {
  const confirmed = dateKey(rec);
  if (confirmed) return confirmed;
  const c = rec?.facts?.clientDate;
  return c && /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : null;
}

/** "Thursday, September 24, 2026" — what a client reads in an email. */
export function longDate(rec, opts) {
  const d = startOf(rec);
  if (!d) {
    /* nothing confirmed yet — fall back to the date the client gave us, so a
       graphic made at submission time carries a real date rather than "TBC" */
    const c = rec?.facts?.clientDate;
    if (c && /^\d{4}-\d{2}-\d{2}$/.test(c)) {
      const [y, m, day] = c.split("-").map(Number);
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric", ...(opts || {}),
      }).format(new Date(Date.UTC(y, m - 1, day)));
    }
    return "TBC";
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TZ,
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    ...(opts || {}),
  }).format(d);
}

/** Stable, sortable, human-readable id: 2026-09-24-northern-gold-corp-4f2a */
export function makeId(company, dateISO, uniq) {
  const slug = String(company || "unknown")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "unknown";

  /* Two submissions from one company on one day used to collide on this key and
     the second silently overwrote the first — taking its steps and log with it,
     which then let already-fired connectors fire again. The suffix is derived
     from the submission itself, so re-processing the SAME submission still lands
     on the same id and stays idempotent. */
  const seed = String(uniq || dateISO || "");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const tag = h.toString(36).slice(-4).padStart(4, "0");

  return `${(dateISO || new Date().toISOString()).slice(0, 10)}-${slug}-${tag}`;
}

/** The twelve facts every downstream system needs, pulled out of the raw form data. */
export function factsFrom(data) {
  const speakers = [1, 2, 3, 4]
    .map((i) => ({
      name:  (data[`speaker${i}_name`]  || "").trim(),
      title: (data[`speaker${i}_title`] || "").trim(),
      email: (data[`speaker${i}_email`] || "").trim(),
    }))
    .filter((s) => s.name);

  return {
    company:   (data.company || "").trim(),
    tickers:   (data.tickers || "").trim(),
    metals:    (data.metals || "").trim(),
    website:   (data.website || "").trim(),
    title:     (data.webinar_title || "").trim(),
    bio:       (data.company_bio || "").trim(),
    speakers,
    cc:        (data.cc_emails || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
    contact:   { name: (data.your_name || "").trim(), email: (data.your_email || "").trim() },
    timezone:  (data.timezone || "").trim(),
    /* what the CLIENT told us, before Red Cloud confirms anything. Only ever a
       fallback for the graphics — schedule.startTimeISO always wins. */
    clientDate: (data.webinar_date || "").trim(),
    clientTime: (data.webinar_time_pref || "").trim(),
    logoUrl:   (data.logo_url || "").trim(),
    techTest:  (data.tech_test || "").trim(),
    deckWhen:  (data.deck_when || "").trim(),
    assetLinks:(data.asset_links || "").trim(),
    notes:     (data.notes || "").trim(),
    summary:   data.summary || "",
  };
}

export function newRecord({ id, facts, raw, files, headshots, logoFiles }) {
  return {
    id,
    createdAt: new Date().toISOString(),
    /* Red Cloud fills these in from /ops — the client never sees them.
       startTimeISO is the only date field: everything else is derived. */
    schedule: { startTimeISO: null, startTime: null, moderator: null, streamyardUrl: null, accountManager: null },
    facts,
    files: files || [],
    /* just the files the client put in the LOGO field — never inferred from
       the order of `files`, which also holds brand assets and headshots */
    logoFiles: logoFiles || [],
    /* [{ speaker: 1, url }] — which photo belongs to which presenter, so a
       graphic never puts the wrong face against a name */
    headshots: headshots || [],
    steps: {},          // stepKey -> { status, at, detail, ref, attempts }
    sends: {},          // tag -> provider id, so one send can never go out twice
    log: [],            // append-only, newest last
    raw,
  };
}

export async function read(id) {
  const got = await store().get(id, { type: "json" });
  return got || null;
}

export async function write(rec) {
  await store().setJSON(rec.id, rec);
  return rec;
}

/** Create only if nothing is there. Returns the existing record instead of clobbering it. */
export async function writeNew(rec) {
  const existing = await read(rec.id);
  if (existing) return { record: existing, created: false };
  await write(rec);
  return { record: rec, created: true };
}

export async function list() {
  const { blobs } = await store().list();
  const out = [];
  for (const b of blobs) {
    const rec = await store().get(b.key, { type: "json" });
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1));
}

/* ── send-level idempotence ────────────────────────────────────
   A connector that makes several outbound calls cannot rely on
   its own done/failed status alone: if call two fails, a retry
   re-runs call one and the client gets a second email. Each call
   records itself here the moment it succeeds.
   ───────────────────────────────────────────────────────────── */

export async function alreadySent(id, tag) {
  const rec = await read(id);
  return Boolean(rec?.sends?.[tag]);
}

export async function noteSend(id, tag, ref) {
  try {
    const rec = await read(id);
    if (!rec) return null;
    rec.sends = rec.sends || {};
    rec.sends[tag] = { at: new Date().toISOString(), ref: ref || null };
    await write(rec);
    return rec;
  } catch (err) {
    console.error(`record.noteSend(${id}, ${tag}) failed:`, err.message);
    return null;
  }
}

/* ── the client's folder ───────────────────────────────────────
   Decided once, then reused. The name embeds a date, and the
   date we would choose CHANGES when Red Cloud sets a broadcast
   time — so recomputing it later silently created a second
   folder and split the client's material across both.
   ───────────────────────────────────────────────────────────── */

export async function rememberFolder(id, provider, folderId) {
  try {
    const rec = await read(id);
    if (!rec) return null;
    rec.folders = rec.folders || {};
    rec.folders[provider] = folderId;
    await write(rec);
    return folderId;
  } catch (err) {
    console.error(`record.rememberFolder(${id}, ${provider}) failed:`, err.message);
    return null;
  }
}

/* Which WordPress page belongs to this webinar, so a re-run edits it rather
   than leaving a second near-identical draft behind. */
export async function rememberPage(id, pageId) {
  try {
    const rec = await read(id);
    if (!rec) return null;
    rec.pages = rec.pages || {};
    rec.pages.wordpress = pageId;
    await write(rec);
    return pageId;
  } catch (err) {
    console.error(`record.rememberPage(${id}) failed:`, err.message);
    return null;
  }
}

/* Which Box file is which graphic, so the social copy can link the exact asset
   a post needs instead of sending someone hunting through the folder. Keyed by
   template name — overwritten wholesale on every graphics run, because a
   re-run replaces every file. */
export async function rememberAssets(id, assets) {
  try {
    const rec = await read(id);
    if (!rec) return null;
    rec.assets = assets || {};
    await write(rec);
    return rec.assets;
  } catch (err) {
    console.error(`record.rememberAssets(${id}) failed:`, err.message);
    return null;
  }
}

/* Which Mailchimp draft belongs to this webinar, so a rebuild updates it rather
   than leaving a second one beside it — and so a draft someone deleted on
   purpose is not quietly put back. `hash` is of the content Mailchimp held
   straight after we wrote it; if it differs later, a person has edited it. */
export async function rememberCampaign(id, info) {
  try {
    const rec = await read(id);
    if (!rec) return null;
    rec.campaigns = { ...(rec.campaigns || {}), mailchimp: { ...(rec.campaigns?.mailchimp || {}), ...info } };
    await write(rec);
    return rec.campaigns.mailchimp;
  } catch (err) {
    console.error(`record.rememberCampaign(${id}) failed:`, err.message);
    return null;
  }
}

export async function knownFolder(id, provider) {
  const rec = await read(id);
  return rec?.folders?.[provider] || null;
}

/* ── deliberate deletions stay deleted ───────────────────────
   A record that once had a folder and no longer does was tidied
   away on purpose. Recreating it turns every rebuild into litter
   in someone's Box, which is exactly what happened when twelve
   records were regenerated at once.

   The tombstone is per record + provider, so a genuinely new
   submission is unaffected: it has no remembered folder and no
   tombstone, and files normally.
   ───────────────────────────────────────────────────────────── */
export async function noteFolderGone(id, provider) {
  try {
    const rec = await read(id);
    if (!rec) return null;
    rec.foldersGone = rec.foldersGone || {};
    rec.foldersGone[provider] = new Date().toISOString();
    if (rec.folders) delete rec.folders[provider];   // the id is meaningless now
    await write(rec);
    return true;
  } catch (err) {
    console.error(`record.noteFolderGone(${id}, ${provider}) failed:`, err.message);
    return null;
  }
}

export async function folderWasDeleted(id, provider) {
  const rec = await read(id);
  return Boolean(rec?.foldersGone?.[provider]);
}

/** Record the outcome of one connector against one webinar. Never throws. */
export async function mark(id, stepKey, status, detail, ref) {
  try {
    const rec = await read(id);
    if (!rec) return null;
    const prior = rec.steps[stepKey];
    rec.steps[stepKey] = {
      status,
      at: new Date().toISOString(),
      detail: detail || "",
      ref: ref || null,
      /* counted so the scheduler can stop hammering a connector that keeps failing */
      attempts: status === "failed" ? ((prior?.attempts || 0) + 1) : (prior?.attempts || 0),
    };
    rec.log.push({ at: new Date().toISOString(), step: stepKey, status, detail: detail || "" });
    if (rec.log.length > 300) rec.log = rec.log.slice(-300);
    await write(rec);
    return rec;
  } catch (err) {
    console.error(`record.mark(${id}, ${stepKey}) failed:`, err.message);
    return null;
  }
}
