import { longDate } from "./record.mjs";
import { shortCompany, registrationUrl } from "./social.mjs";
import { EBLAST_TEMPLATE } from "./eblast-template.mjs";

/* ── the invite eblast ────────────────────────────────────────
   This is the TEAM'S email, not a design of ours. eblast-template.mjs is their
   own hand-built Skyharbour invite, byte for byte, with the ten things that
   change between any two of their invites replaced by placeholders. The header,
   the "Red Cloud Webinar Series Presents" block, the disclosure and the footer
   with every merge tag are theirs and are never touched here.

   (An earlier version drew its own layout. It was wrong — the team's invites
   have a fixed format, and the top and bottom of the email are part of it.)

   One image: the LARGE invite, which is what the team's example carries (they
   took the 1600x900 X card out of it). Published by the graphics run at email
   size, because Box cannot serve an image to a mail client.
   ───────────────────────────────────────────────────────────── */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* "1:00 PM ET / 10:00 AM PT" or "1:00pm ET | 10:00am PT" -> "1:00 pm ET | 10:00 am PT",
   which is how the team writes it in the body */
function teamTime(rec) {
  const raw = (rec?.schedule?.startTime || rec?.facts?.clientTime || "").trim();
  if (!raw) return "";
  return raw.replace(/\s*\/\s*/g, " | ")
            .replace(/(\d)\s*([ap])\.?m\.?/gi, (_, d, ap) => `${d} ${ap.toLowerCase()}m`);
}

/* "President, CEO, Director" -> "President, CEO & Director" — the team joins the
   last role with an ampersand. A title that already has one is left alone. */
const teamRole = (t) => {
  t = String(t || "").trim();
  if (/&|\band\b/i.test(t)) return t;
  const parts = t.split(/\s*,\s*/).filter(Boolean);
  return parts.length < 2 ? t : `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}`;
};

/* The team's invites carry the bio as two short paragraphs. Split the client's at
   the sentence boundary nearest the middle. They trim it by hand as well — the
   client's version is usually longer — which is a judgement call left to them. */
function twoParagraphs(bio) {
  const s = String(bio || "").trim().split(/(?<=[.!?])\s+(?=[A-Z])/);
  if (s.length < 2) return [s.join(" "), ""];
  const total = s.join(" ").length;
  let best = 1, bestGap = Infinity, run = 0;
  for (let i = 0; i < s.length - 1; i++) {
    run += s[i].length + 1;
    const gap = Math.abs(run - total / 2);
    if (gap < bestGap) { bestGap = gap; best = i + 1; }
  }
  return [s.slice(0, best).join(" "), s.slice(best).join(" ")];
}

const ORIGIN = "https://redcloud-webinar-form.netlify.app";
/** Public URL of the email's invite image, or null. */
export const artUrl = (rec, slot = "top", origin = ORIGIN) =>
  rec?.art?.[slot]?.token ? `${origin}/art/${rec.art[slot].token}.png` : null;

/** "Red Cloud Webinar Series Presents: Skyharbour Resources Ltd. | October 7, 2026 @ 1:00 pm ET | 10:00 am PT" */
export function eblastSubject(rec) {
  const when = longDate(rec, { weekday: undefined });
  const time = teamTime(rec);
  return `Red Cloud Webinar Series Presents: ${rec.facts.company} | ${when}${time ? ` @ ${time}` : ""}`;
}
export const eblastPreview = (rec) => rec.facts.title || "";

/* "SKYHARBOUR RESOURCES: CORPORATE UPDATE & OUTLOOK" — the client's own title if
   it already names them, otherwise their name in front, in capitals */
function title(rec) {
  const co = shortCompany(rec.facts.company);
  const t = String(rec.facts.title || "").trim();
  const full = !t ? co : t.toLowerCase().startsWith(co.toLowerCase()) ? t : `${co}: ${t}`;
  return full.toUpperCase();
}

export function eblastHtml(rec, { origin } = {}) {
  const f = rec.facts;
  const time = teamTime(rec);
  const people = (f.speakers || []).filter((s) => s && s.name)
    .map((s) => `${esc(s.name)}${s.title ? ` | ${esc(teamRole(s.title))}` : ""}`).join("<br>\n");
  const [bio1, bio2] = twoParagraphs(f.bio);
  const top = artUrl(rec, "top", origin) || "";

  let h = EBLAST_TEMPLATE;
  /* a missing second paragraph removes its whole <p>, not just the words */
  if (!bio2) h = h.replace(/<p\b[^>]*>\{\{BIO_2\}\}<\/p>/, "");

  const fill = {
    TITLE: esc(title(rec)),
    REG_URL: esc(registrationUrl(rec)),
    TOP_IMG: esc(top),
    COMPANY: esc(f.company),
    WHEN: esc(longDate(rec)) + (time ? ` @ ${esc(time)}` : ""),
    PRESENTERS: people,
    BIO_1: esc(bio1),
    BIO_2: esc(bio2),
  };
  h = h.replace(/\{\{([A-Z_0-9]+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
  if (/\{\{[A-Z_0-9]+\}\}/.test(h)) throw new Error("The invite template has a placeholder this build does not fill.");
  return h;
}

/* ════════════════════════════════════════════════════════════════
   The NEWSLETTER-STYLE design, light (1 Oct 2026).

   Modelled on the Bi-Weekly newsletter, but not copied: the dark version read as
   too heavy for an invite. Kept from the newsletter — Montserrat, letter-spaced
   eyebrows behind a short red bar, the webinar thumbnail in red corner brackets,
   the role-over-name list, the crimson REGISTER NOW, the social row and the
   compact footer. Changed — a white body on a soft grey frame, the newsletter's
   LIGHT contour texture behind the hero, a thin red strip across the top, and a
   Date / Time / Format panel in place of a line of grey type.

   It carries everything the team's invite carries: the title, "Red Cloud
   Webinar Series Presents", the date and time, "Featuring" the presenters, the
   bio, Register Now, the replay note, and the whole footer — copyright, why you
   are receiving it, the mailing address, address book, preferences,
   unsubscribe, the disclosure and Mailchimp's list line. Every fact in the two
   images is also in the text, so it still reads with images off.
   ════════════════════════════════════════════════════════════════ */

const F = "Montserrat,Arial,Helvetica,sans-serif";
const INK = "#1d1d1f", BODY = "#3a3a3e", MUTED = "#7d7d82", LINE = "#e6e6e9", RED = "#d7192a", BTN = "#8d1e2b", FRAME = "#f1f1f2";
const SOCIAL = [
  ["https://www.youtube.com/@RedCloudTV", "youtube", "YouTube"],
  ["https://www.linkedin.com/company/red-cloud-financial-services-inc", "linkedin", "LinkedIn"],
  ["https://www.instagram.com/redcloudfs/", "instagram", "Instagram"],
  ["https://twitter.com/RedCloudFS", "twitter", "X"],
  ["https://www.tiktok.com/@redcloudfs", "tiktok", "TikTok"],
];
const VCARD = "https://redcloudfs.us5.list-manage.com/vcard?u=c6c635fa4e7b43f4dfa7251c1&id=257347ab77";

export function eblastHtmlLight(rec, { origin, variant = "light" } = {}) {
  const mixed = variant === "mixed";
  const f = rec.facts;
  const reg = esc(registrationUrl(rec));
  const hero = artUrl(rec, mixed ? "heroDark" : "hero", origin);
  const card = artUrl(rec, "card", origin);
  const [bio1, bio2] = twoParagraphs(f.bio);
  const people = (f.speakers || []).filter((s) => s && s.name);
  const time = teamTime(rec);
  /* Each value on two deliberate lines — "Wednesday / October 7, 2026",
     "1:00 pm ET / 10:00 am PT" — so the three columns line up instead of
     wrapping wherever the width runs out. */
  const ld = longDate(rec), cut = ld.indexOf(", ");
  const dateTwo = cut > 0 ? `${esc(ld.slice(0, cut))}<br>${esc(ld.slice(cut + 2))}` : esc(ld);
  const timeTwo = time ? time.split(/\s*\|\s*/).map(esc).join("<br>") : "TBC";
  /* footer colours: the newsletter's dark footer, or a light one */
  const FB = mixed ? INK : FRAME, FT = mixed ? "#8c8c90" : MUTED, FL = mixed ? "#c9c9cc" : BODY, FH = mixed ? "#b5b5b8" : BODY;
  const altWhen = `${longDate(rec)}${time ? ` @ ${time}` : ""}`;

  const wrapOpen = (bg) => `<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->` +
    `<table role="presentation" class="wrap" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="width:100%;max-width:600px;margin:0 auto;background-color:${bg}">`;
  const wrapClose = `</table><!--[if mso]></td></tr></table><![endif]-->`;
  const bar = `<div style="width:40px;height:3px;background:${RED};margin:10px 0 0;font-size:0;line-height:0">&nbsp;</div>`;
  const head = (t) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td class="shd" style="font-family:${F};font-size:18px;font-weight:800;letter-spacing:1px;color:${INK}">${t}</td></tr></table>${bar}`;
  const img = (src, alt) => src
    ? `<a href="${reg}" target="_blank" style="color:${INK};text-decoration:none"><img src="${esc(src)}" width="600" alt="${esc(alt)}" class="fluid" style="display:block;width:600px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;color:${INK};font-family:${F};font-size:14px;font-weight:700;line-height:20px"></a>`
    : "";
  const label = (t) => `<span style="font-family:${F};font-size:10px;font-weight:700;letter-spacing:2px;color:${RED}">${t}</span>`;
  const cell = (k, v, last) => mixed
    ? `<td class="col colD" width="33%" valign="top" style="width:33%;padding:18px 16px;${last ? "" : `border-right:1px solid #2e2e31;`}">` +
      `${label(k)}<br><span style="font-family:${F};font-size:14px;line-height:21px;font-weight:700;color:#ffffff">${v}</span></td>`
    : `<td class="col" width="33%" valign="top" style="width:33%;padding:14px 16px;${last ? "" : `border-right:1px solid ${LINE};`}">` +
      `${label(k)}<br><span style="font-family:${F};font-size:14px;line-height:21px;font-weight:700;color:${INK}">${v}</span></td>`;

  const presenterRows = people.map((s, i) =>
    `<tr><td class="lst" style="padding:12px 0;${i < people.length - 1 ? `border-bottom:1px solid ${LINE}` : ""}">` +
    (s.title ? `<span class="lst-l" style="font-family:${F};font-size:10px;font-weight:700;letter-spacing:2px;color:${RED}">${esc(teamRole(s.title).toUpperCase())}</span><br>` : "") +
    `<span class="lst-t" style="font-family:${F};font-size:16px;line-height:23px;font-weight:700;color:${INK}">${esc(s.name)}</span></td></tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>*|MC:SUBJECT|*</title>
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&display=swap" rel="stylesheet"><!--<![endif]-->
<style>
  body{margin:0;padding:0;background:${FRAME}}
  a{color:${INK}}
  a[x-apple-data-detectors],u+#body a,#MessageViewBody a{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}
  @media only screen and (max-width:480px){
    .wrap{width:100%!important}
    .fluid{width:100%!important;height:auto!important}
    .pad{padding-left:20px!important;padding-right:20px!important}
    .ttl{font-size:19px!important;line-height:25px!important}
    .col{display:block!important;width:auto!important;border-right:0!important;border-bottom:1px solid ${LINE}!important}
    .colD{border-bottom:1px solid #2e2e31!important}
    .lst-l{font-size:8.5px!important;letter-spacing:1.4px!important}
    .lst-t{font-size:14px!important;line-height:20px!important}
    .shd{font-size:15px!important}
  }
</style>
</head>
<body id="body" style="margin:0;padding:0;background:${FRAME}">
*|IF:MC_PREVIEW_TEXT|*<div style="display:none;font-size:1px;color:${FRAME};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">*|MC_PREVIEW_TEXT|*</div>*|END:IF|*
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FRAME}" style="background-color:${FRAME}">

<tr><td align="center" style="padding:0">${wrapOpen(FRAME)}
  <tr><td class="pad" style="padding:12px 36px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:${MUTED};text-align:center"><a href="*|ARCHIVE|*" target="_blank" style="color:${MUTED};text-decoration:underline">View this email in your browser</a></td></tr>
${wrapClose}</td></tr>

<tr><td align="center" style="padding:0">${wrapOpen("#ffffff")}
  <tr><td style="height:5px;line-height:5px;font-size:0;background:${RED}">&nbsp;</td></tr>
  <tr><td style="font-size:0;line-height:0">${img(hero, `Red Cloud Webinar Series Presents: ${f.company} - Live Webinar - ${altWhen}`)}</td></tr>

  <tr><td class="pad" style="padding:32px 36px 16px">${head("JOIN THE LIVE VIRTUAL WEBINAR")}</td></tr>
  <tr><td style="font-size:0;line-height:0">${img(card, `LIVE WEBINAR: ${f.title || f.company} (${altWhen}) - REGISTER NOW`)}</td></tr>

  <tr><td class="pad" style="padding:20px 36px 0">
    <p style="margin:0 0 8px;font-family:${F};font-size:10px;font-weight:700;letter-spacing:2px;color:${RED}">RED CLOUD WEBINAR SERIES PRESENTS: ${esc(String(f.company).toUpperCase())}</p>
    <p class="ttl" style="margin:0;font-family:${F};font-size:22px;line-height:29px;font-weight:800;letter-spacing:.3px;color:${INK}">${esc(title(rec))}</p>
  </td></tr>

  ${mixed ? `<tr><td style="padding:24px 0 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${INK}" style="background-color:${INK}"><tr><td class="pad" style="padding:0 20px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        ${cell("DATE", dateTwo, false)}${cell("TIME", timeTwo, false)}${cell("FORMAT", "Live<br>Virtual", true)}
      </tr></table>
    </td></tr></table>
  </td></tr>` : `<tr><td class="pad" style="padding:18px 36px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f7f8" style="background-color:#f7f7f8;border-left:4px solid ${RED};border-radius:2px"><tr>
      ${cell("DATE", dateTwo, false)}${cell("TIME", timeTwo, false)}${cell("FORMAT", "Live<br>Virtual", true)}
    </tr></table>
  </td></tr>`}

  ${presenterRows ? `<tr><td class="pad" style="padding:28px 36px 0">${head("FEATURING")}</td></tr>
  <tr><td class="pad" style="padding:4px 36px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${presenterRows}</table></td></tr>` : ""}

  ${bio1 ? `<tr><td class="pad" style="padding:22px 36px 0;font-family:${F};font-size:15px;line-height:24px;color:${BODY}">
    <p style="margin:0 0 12px">${esc(bio1)}</p>${bio2 ? `<p style="margin:0">${esc(bio2)}</p>` : ""}
  </td></tr>` : ""}

  <tr><td class="pad" style="padding:28px 36px 10px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td bgcolor="${BTN}" style="background-color:${BTN};border-radius:4px">
        <a href="${reg}" target="_blank" style="display:inline-block;padding:16px 30px;font-family:${F};font-size:14px;font-weight:700;letter-spacing:2px;color:#ffffff;text-decoration:none">REGISTER NOW&nbsp;&rarr;</a>
      </td>
    </tr></table>
  </td></tr>
  <tr><td class="pad" style="padding:12px 36px 36px;font-family:${F};font-size:12px;line-height:19px;color:${MUTED}">
    <strong style="color:${BODY}">Note:</strong> If you can&rsquo;t make the webinar live, a replay link will be automatically sent to your email once complete.
  </td></tr>
${wrapClose}</td></tr>

<tr><td align="center" style="padding:0">${wrapOpen(FB)}
  <tr><td align="center" style="padding:28px 0 14px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    ${SOCIAL.map(([u, k, alt]) => `<td style="padding:0 8px"><a href="${u}" target="_blank" style="color:${FL}"><img src="https://cdn-images.mailchimp.com/icons/social-block-v3/block-icons-v3/${k}-filled-${mixed ? "light" : "dark"}-40.png" width="26" height="26" alt="${alt}" style="display:block;border:0"></a></td>`).join("")}
  </tr></table></td></tr>
  <tr><td class="pad" style="padding:6px 36px 34px;font-family:Arial,sans-serif;font-size:11px;line-height:17px;color:${FT};text-align:center">
    <p style="margin:0 0 10px">Copyright &copy; *|CURRENT_YEAR|* Red Cloud Financial Services Inc. All rights reserved.<br>
    You are receiving this email because you: (a) opted in at our website or landing page; (b) have a prior/existing business relationship with Red Cloud Financial Services; or (c) registered for a webinar.</p>
    <p style="margin:0 0 10px">Our mailing address is: Red Cloud Financial Services Inc. &middot; 120 Adelaide St W Suite 1400 &middot; Toronto, ON M5H 1T1 &middot; Canada<br>
    <a href="${VCARD}" style="color:${FL}">Add us to your address book</a></p>
    <p style="margin:0 0 16px"><a href="*|UPDATE_PROFILE|*" style="color:${FL}">Update preferences</a> &nbsp;&middot;&nbsp; <a href="*|UNSUB|*" style="color:${FL}">Unsubscribe</a></p>
    <p style="margin:0 0 6px;color:${FH};font-weight:bold">Disclosure Requirement</p>
    <p style="margin:0 0 8px">Part of Red Cloud Financial Services business is to connect mining companies with suitable investors. Red Cloud Financial Services, its affiliates and their respective officers, directors, representatives, researchers and members of their families may hold positions in the companies mentioned in this document and may buy and/or sell their securities. Additionally, Red Cloud Financial Services may have provided in the past, and may provide in the future, certain advisory or corporate finance services and receive financial and other incentives from issuers as consideration for the provision of such services.</p>
    <p style="margin:0 0 8px">Red Cloud Financial Services has prepared this document for general information purposes only. This document should not be considered a solicitation to purchase or sell securities or a recommendation to buy or sell securities. The information provided has been derived from sources believed to be accurate but cannot be guaranteed. This document does not take into account the particular investment objectives, financial situations, or needs of individual recipients and other issues (e.g. prohibitions to investments due to law, jurisdiction issues, etc.) which may exist for certain persons. Recipients should rely on their own investigations and take their own professional advice before investment. Red Cloud Financial Services will not treat recipients of this document as clients by virtue of having viewed this document.</p>
    <p style="margin:0 0 16px">Red Cloud Financial Services takes no responsibility for any errors or omissions contained herein, and accepts no legal responsibility for any errors or omissions contained herein, and accepts no legal responsibility from any losses resulting from investment decisions based on the content of this document.</p>
    <p style="margin:0">This email was sent to *|EMAIL|* &middot; <a href="*|ABOUT_LIST|*" style="color:${FL}">why did I get this?</a><br>*|LIST:ADDRESSLINE|*</p>
  </td></tr>
${wrapClose}</td></tr>

</table>
</body>
</html>`;
}

/* Which design the drafts use. "team" is the team's own invite format (the
   Pipeline Proof Co example); "light" is the newsletter-style design above, and
   "mixed" the same with a dark hero, a dark details band and the dark footer.
   "mixed" is the one in use. */
/* Approved 2 Oct 2026 (Cliff + Marty, from test draft 9409355). */
export const EBLAST_DESIGN = "mixed";
export const DESIGN_IMAGES = { team: ["top"], light: ["hero", "card"], mixed: ["heroDark", "card"] };
export const eblastBody = (rec, opts, design = EBLAST_DESIGN) =>
  design === "light" || design === "mixed" ? eblastHtmlLight(rec, { ...(opts || {}), variant: design }) : eblastHtml(rec, opts);
