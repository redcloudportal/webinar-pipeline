import { createHash } from "node:crypto";
import { api } from "./_http.mjs";
import { rememberCampaign } from "../record.mjs";
import { eblastBody, eblastSubject, eblastPreview, artUrl, EBLAST_DESIGN, DESIGN_IMAGES } from "../eblast.mjs";

/* Step 10 — the invite eblast, as a DRAFT in Mailchimp.

   Built the moment the form is submitted, from the record and the invite
   artwork the graphics step has just drawn. It is only ever a draft: nothing in
   this file sends or schedules a campaign, and nothing can — the approval
   (a test to yourself, then Marty) stays a person pressing a button.

   Runs AFTER the graphics, because the email is built around their artwork.
   The dispatcher runs connectors in order; `after` makes the same hold when
   graphics are redrawn later by hand or when a broadcast time is confirmed. */

export const key   = "mailchimp";
export const label = "Mailchimp invite eblast";
export const steps = [10];
export const needs = ["MAILCHIMP_API_KEY", "MAILCHIMP_TEMPLATE_CAMPAIGN_ID"];
export const when  = "on-create";
/* the body quotes the date and shows an image that quotes it too, so a
   confirmed broadcast time means it is out of date */
export const rebuildOnSchedule = true;
export const after = "graphics";
/* After graphics are redrawn, refresh the draft — but only a webinar that
   already HAS one. Redrawing the graphics of an old record must not conjure a
   campaign nobody asked for. */
export const shouldChain = (rec) => Boolean(rec?.campaigns?.mailchimp?.id);

const dc = () => String(process.env.MAILCHIMP_API_KEY).split("-").pop();
const base = () => `https://${dc()}.api.mailchimp.com/3.0`;
const authHeader = () => ({
  authorization: "Basic " + Buffer.from(`anystring:${process.env.MAILCHIMP_API_KEY}`).toString("base64"),
});
const editLink = (c) => `https://${dc()}.admin.mailchimp.com/campaigns/edit?id=${c.web_id}`;
const sha = (t) => createHash("sha256").update(String(t || "")).digest("hex").slice(0, 16);

/* Mailchimp does not hand the content straight back: it wraps what we PUT in
   its own template and reformats it, and for a moment after the write a read
   returns something that never matches what it settles to. Two reads in a row
   have to agree before the content counts as settled. */
async function settledHtml(id) {
  const read1 = async () => (await api(`${base()}/campaigns/${id}/content`, { headers: authHeader() }, "Mailchimp")).html || "";
  let prev = await read1();
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const next = await read1();
    if (next === prev) return next;
    prev = next;
  }
  return null;
}

/* ── is the body in the draft actually OURS? ─────────────────
   This check exists because of a failure that looked like success. A campaign
   built from a Mailchimp TEMPLATE silently ignores a pasted `html` body: the PUT
   returns 200, the draft keeps the template's old content, and a test email went
   out with one company's name and another company's graphic. Nothing in the
   response says so. The only proof is to read the body back and look for the
   things that are specific to this webinar. */
function assertOurs(html, rec) {
  const missing = [];
  if (!html) missing.push("any content that settled");
  else {
    if (!html.includes(rec.facts.company)) missing.push(`the company name "${rec.facts.company}"`);
    for (const slot of DESIGN_IMAGES[EBLAST_DESIGN] || ["top"]) {
      const tk = rec.art?.[slot]?.token;
      if (tk && !html.includes(tk)) missing.push(`this webinar's ${slot} image`);
    }
  }
  if (missing.length) {
    throw new Error(
      `Mailchimp accepted the content but the draft does not contain ${missing.join(" or ")}. ` +
      `It was NOT filled in, and must not be used as it stands. (A campaign built from a Mailchimp template ignores pasted HTML.)`,
    );
  }
}

async function writeBody(id, rec) {
  await api(
    `${base()}/campaigns/${id}/content`,
    { method: "PUT", headers: { ...authHeader(), "content-type": "application/json" }, body: JSON.stringify({ html: eblastBody(rec) }) },
    "Mailchimp",
  );
  const html = await settledHtml(id);
  assertOurs(html, rec);
  return sha(html);
}

export async function run(rec) {
  const f = rec.facts;
  const art = (DESIGN_IMAGES[EBLAST_DESIGN] || ["top"]).every((s) => artUrl(rec, s)) ? "with the invite image"
    : "WITHOUT the invite image — the graphics step has not published it; run it and this updates the same draft";
  const noTime = rec.schedule?.startTimeISO ? "" :
    " The time shown is the one the client gave; it is refreshed when you confirm a broadcast time.";
  const tail = "Still yours: the test send, Marty's approval, and scheduling — nothing here sends.";

  const known = rec.campaigns?.mailchimp;

  /* ── a draft already exists: update it, never make another ── */
  if (known?.id) {
    let c;
    try {
      c = await api(`${base()}/campaigns/${known.id}`, { headers: authHeader() }, "Mailchimp");
    } catch (err) {
      if (err.status === 404) {
        /* Deleted in Mailchimp. That was deliberate — the same lesson as the Box
           folders: putting it back is the bug. Resubmit to start a fresh one. */
        return { status: "skipped", detail: "The Mailchimp draft was deleted, so it was not recreated. Submit again for a new one." };
      }
      throw err;
    }

    /* Only a plain draft is ever touched. Scheduled, sending, sent or paused
       belongs to a person now and a rebuild would change an email that is
       already committed to go out. */
    if (c.status !== "save") {
      return { status: "skipped", detail: `The campaign is "${c.status}", not a draft, so it was left exactly as it is.`, ref: editLink(c) };
    }

    const now = await api(`${base()}/campaigns/${known.id}/content`, { headers: authHeader() }, "Mailchimp");
    if (!known.hash || sha(now.html) !== known.hash) {
      return { status: "skipped", detail: known.hash
          ? "Someone has edited this draft in Mailchimp, so it was left alone rather than overwritten. Rebuild it by hand if the date or artwork changed."
          : "This draft has no record of how it was first written, so it cannot be shown to be untouched and was left alone.", ref: editLink(c) };
    }

    /* subject and preview follow the data; the TITLE is left alone, since
       renaming a draft is the first thing a person does to it */
    await api(
      `${base()}/campaigns/${known.id}`,
      { method: "PATCH", headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ settings: { subject_line: eblastSubject(rec), preview_text: eblastPreview(rec) } }) },
      "Mailchimp",
    );
    const hash = await writeBody(known.id, rec);
    await rememberCampaign(rec.id, { hash });
    return { detail: `Draft updated in place and checked (${art}).${noTime} ${tail}`, ref: editLink(c) };
  }

  /* ── first time: a NEW campaign, with the template's audience and sender ──
     Not a replicate. A replicated campaign keeps the template's layout, and a
     campaign with a layout will not take a pasted body (see assertOurs). So the
     list, segment, from-name and reply-to are read from the template campaign
     and a plain campaign is created with those. */
  const tpl = await api(
    `${base()}/campaigns/${process.env.MAILCHIMP_TEMPLATE_CAMPAIGN_ID}` +
    `?fields=recipients.list_id,recipients.segment_opts,settings.from_name,settings.reply_to,settings.to_name`,
    { headers: authHeader() },
    "Mailchimp",
  );
  const rcp = { list_id: tpl.recipients?.list_id };
  if (tpl.recipients?.segment_opts && Object.keys(tpl.recipients.segment_opts).length) {
    rcp.segment_opts = tpl.recipients.segment_opts;
  }
  const copy = await api(
    `${base()}/campaigns`,
    { method: "POST", headers: { ...authHeader(), "content-type": "application/json" },
      body: JSON.stringify({
        type: "regular",
        recipients: rcp,
        settings: {
          title: `${f.company} - Webinar Invite - Push 1`,
          subject_line: eblastSubject(rec),
          preview_text: eblastPreview(rec),
          from_name: tpl.settings?.from_name,
          reply_to: tpl.settings?.reply_to,
          ...(tpl.settings?.to_name ? { to_name: tpl.settings.to_name } : {}),
          auto_footer: false,       // the footer, with the unsubscribe tag, is in the body
          inline_css: true,
        },
      }) },
    "Mailchimp",
  );
  /* remembered at once, before anything else can fail, so a retry updates this
     draft instead of creating a second */
  await rememberCampaign(rec.id, { id: copy.id, webId: copy.web_id });
  const hash = await writeBody(copy.id, rec);
  await rememberCampaign(rec.id, { hash });

  return { detail: `Draft created and checked: the body holds this webinar's own name and image (${art}).${noTime} ${tail}`, ref: editLink(copy) };
}

export async function check() {
  const me = await api(`${base()}/`, { headers: authHeader() }, "Mailchimp");
  const tpl = await api(
    `${base()}/campaigns/${process.env.MAILCHIMP_TEMPLATE_CAMPAIGN_ID}`,
    { headers: authHeader() },
    "Mailchimp",
  );
  return `Connected to ${me.account_name}. Template campaign: "${tpl.settings?.title || tpl.id}".`;
}

/** Recent campaigns with the ID the API needs.

   The number in a Mailchimp page address is the web_id, which the API does not
   accept for a campaign; the template has to be given by its API id. Read-only —
   a single GET — so it can be run any time to pick the right one. */
export async function listCampaigns() {
  const out = await api(
    `${base()}/campaigns?count=30&sort_field=create_time&sort_dir=DESC` +
    `&fields=campaigns.id,campaigns.web_id,campaigns.status,campaigns.create_time,campaigns.settings.title,campaigns.settings.subject_line`,
    { headers: authHeader() },
    "Mailchimp",
  );
  return (out.campaigns || []).map((c) => ({
    id: c.id,
    web_id: c.web_id,
    status: c.status,
    title: c.settings?.title || "",
    subject: c.settings?.subject_line || "",
    created: (c.create_time || "").slice(0, 10),
  }));
}

/** Send a TEST of one draft to a few named people. Never to a list.

   Mailchimp's test endpoint mails only the addresses it is given, which is why
   it is safe to expose: it cannot reach an audience. It is deliberately a
   separate function from the connector's run(), so that nothing in the
   automatic path can ever send — the connector still only makes drafts. */
export async function sendTest(campaignId, emails) {
  const c = await api(`${base()}/campaigns/${campaignId}`, { headers: authHeader() }, "Mailchimp");
  if (c.status !== "save") throw new Error(`The campaign is "${c.status}", not a draft, so no test was sent.`);
  await api(
    `${base()}/campaigns/${campaignId}/actions/test`,
    { method: "POST", headers: { ...authHeader(), "content-type": "application/json" },
      body: JSON.stringify({ test_emails: emails, send_type: "html" }) },
    "Mailchimp",
  );
  return { subject: c.settings?.subject_line || "", to: emails };
}

/** One campaign's status, settings and body. Read-only — for checking a draft
   against the team's example, or refreshing the invite template from it. */
export async function readCampaign(campaignId) {
  const c = await api(
    `${base()}/campaigns/${campaignId}?fields=id,web_id,status,create_time,settings.title,settings.subject_line,settings.preview_text,settings.template_id,recipients.list_name`,
    { headers: authHeader() }, "Mailchimp");
  const body = await api(`${base()}/campaigns/${campaignId}/content`, { headers: authHeader() }, "Mailchimp");
  return { ...c, html: body.html || "" };
}

/** A one-off DESIGN TEST draft: a design built from this webinar, in its own
   clearly-labelled campaign that is NOT remembered on the record — so it never
   becomes, replaces or blocks the webinar's real draft. Verified like any other
   draft before anything is sent from it. Returns the new campaign. */
export async function createDesignTestDraft(rec, design, html, imageTokens) {
  const tpl = await api(
    `${base()}/campaigns/${process.env.MAILCHIMP_TEMPLATE_CAMPAIGN_ID}` +
    `?fields=recipients.list_id,recipients.segment_opts,settings.from_name,settings.reply_to,settings.to_name`,
    { headers: authHeader() }, "Mailchimp");
  const rcp = { list_id: tpl.recipients?.list_id };
  if (tpl.recipients?.segment_opts && Object.keys(tpl.recipients.segment_opts).length) rcp.segment_opts = tpl.recipients.segment_opts;
  const c = await api(`${base()}/campaigns`, {
    method: "POST", headers: { ...authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ type: "regular", recipients: rcp, settings: {
      title: `${rec.facts.company} - Webinar Invite - DESIGN TEST (${design})`,
      subject_line: eblastSubject(rec), preview_text: eblastPreview(rec),
      from_name: tpl.settings?.from_name, reply_to: tpl.settings?.reply_to,
      ...(tpl.settings?.to_name ? { to_name: tpl.settings.to_name } : {}),
      auto_footer: false, inline_css: true } }) }, "Mailchimp");
  await api(`${base()}/campaigns/${c.id}/content`, {
    method: "PUT", headers: { ...authHeader(), "content-type": "application/json" },
    body: JSON.stringify({ html }) }, "Mailchimp");
  const back = await settledHtml(c.id);
  const missing = [];
  if (!back || !back.includes(rec.facts.company)) missing.push("the company name");
  for (const t of imageTokens) if (!back || !back.includes(t)) missing.push("one of its images");
  if (missing.length) throw new Error(`The design-test draft was created but does not contain ${missing.join(" and ")}, so no test was sent. Delete draft ${c.web_id}.`);
  return { id: c.id, web_id: c.web_id, edit: editLink(c) };
}
