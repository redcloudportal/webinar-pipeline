/* ── the registration page, as plain HTML ──────────────────────
   Red Cloud's registration pages are built in Elementor with JetEngine
   fields. Neither is reachable through the WordPress API, and the host strips
   the auth header, so nothing can be written to the site at all.

   This renders the same page as ONE self-contained block: inline styles, no
   page builder, no plugin. Someone pastes it into a Custom HTML block today;
   when API access opens, the identical string is posted as a normal page.

   Every size and colour below is MEASURED from the real page — the archived
   19 January 2026 Skyharbour registration page, read back through the
   Wayback Machine because the live ones are deleted after each webinar:

     eyebrow    12/700  letter-spacing 2px  uppercase  white
     date       20/700  uppercase  white
     company    45/700  uppercase  white   line-height 50
     title      25/400  uppercase  white   line-height 41
     button     12/700  letter-spacing 2px uppercase on #8D1E2B
     section    30/700  uppercase  #8D1E2B line-height 41
     presenter  20/700  #8D1E2B (not uppercase) over 16/500 #333
     meta head  16/700  uppercase  #8D1E2B
     meta value 18/500  #333

   Presenters are stacked, each with their firm underneath — not side by side.
   ───────────────────────────────────────────────────────────── */

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FAM = "Montserrat,'Segoe UI',Helvetica,Arial,sans-serif";
const CRIMSON = "#8D1E2B";
const INK = "#333333";
export const HERO_BG = "https://redcloudfs.com/wp-content/uploads/2023/09/Background.webp";
export const RC_LOGO = "https://redcloudfs.com/wp-content/uploads/2023/09/rc2021-logo-transbg-1-1024x342.webp";

export function streamyardCode(url) {
  const m = String(url || "").trim().replace(/\/+$/, "").match(/\/([A-Za-z0-9_-]{4,})$/);
  return m ? m[1] : null;
}

const btn = (href, label = "Register Now") =>
  `<a href="${esc(href || "#")}" style="display:inline-block;background:${CRIMSON};color:#ffffff;` +
  `text-decoration:none;font-family:${FAM};font-size:12px;font-weight:700;letter-spacing:2px;` +
  `line-height:18px;text-transform:uppercase;padding:16px 34px;">${esc(label)}</a>`;

const person = (p, firm) =>
  `<div style="margin:0 0 30px;">` +
  `<div style="font-family:${FAM};font-size:20px;font-weight:700;line-height:30px;color:${CRIMSON};">${esc(p.name)}</div>` +
  (p.title ? `<div style="font-family:${FAM};font-size:16px;font-weight:500;line-height:24px;color:${INK};">${esc(p.title)}</div>` : "") +
  (firm ? `<div style="font-family:${FAM};font-size:16px;font-weight:500;line-height:24px;color:${INK};">${esc(firm)}</div>` : "") +
  `</div>`;

const sectionHead = (t) =>
  `<h2 style="font-family:${FAM};font-size:30px;font-weight:700;line-height:41px;color:${CRIMSON};` +
  `text-transform:uppercase;margin:0 0 22px;">${esc(t)}</h2>`;

const metaBlock = (head, value) =>
  `<td style="vertical-align:top;padding-right:60px;">` +
  `<h2 style="font-family:${FAM};font-size:16px;font-weight:700;line-height:26px;color:${CRIMSON};text-transform:uppercase;margin:0 0 4px;">${esc(head)}</h2>` +
  `<div style="font-family:${FAM};font-size:18px;font-weight:500;line-height:26px;color:${INK};">${value}</div></td>`;

/**
 * @param f { company, title, bio, dateLong, time, website, logoUrl,
 *            presenters:[{name,title}], analyst:{name,title,firm},
 *            registerUrl, researchUrl, questionsEmail }
 */
export function registrationPageHtml(f) {
  const people = (f.presenters || []).filter((p) => p && p.name);
  const rows = people.map((p) => person(p, f.company)).join("")
    + (f.analyst && f.analyst.name ? person(f.analyst, f.analyst.firm || "Red Cloud Securities") : "");

  const rightCol =
    (f.logoUrl ? `<img src="${esc(f.logoUrl)}" alt="${esc(f.company)}" style="max-width:250px;height:auto;display:block;margin:0 0 40px;">` : "") +
    `<img src="${RC_LOGO}" alt="Red Cloud Financial Services" style="max-width:260px;height:auto;display:block;">`;

  return `<!-- Red Cloud webinar registration page — generated from the client's intake form.
     Paste into a new WordPress page as a single Custom HTML block.
     Slug: rcwebinar-{ticker}. The Questions form is marked below. -->
<div style="font-family:${FAM};color:${INK};">

  <div style="background-image:url('${HERO_BG}');background-size:cover;background-position:center;padding:74px 48px;">
    <div style="font-family:${FAM};font-size:12px;font-weight:700;letter-spacing:2px;line-height:18px;text-transform:uppercase;color:#ffffff;">Webinars</div>
    <div style="font-family:${FAM};font-size:20px;font-weight:700;line-height:30px;text-transform:uppercase;color:#ffffff;margin:18px 0 6px;">${esc(f.dateLong || "")}</div>
    <div style="font-family:${FAM};font-size:45px;font-weight:700;line-height:50px;text-transform:uppercase;color:#ffffff;margin:0 0 10px;">${esc(f.company)}</div>
    <div style="font-family:${FAM};font-size:25px;font-weight:400;line-height:41px;text-transform:uppercase;color:#ffffff;margin:0 0 30px;">${esc(f.title)}</div>
    ${btn(f.registerUrl)}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:54px 0 0;">
    <tbody><tr>
      <td style="vertical-align:top;width:63%;padding:0 40px 0 48px;">
        ${sectionHead("Presenters")}
        ${rows}

        ${f.bio ? `<p style="font-family:${FAM};font-size:16px;font-weight:400;line-height:26px;color:${INK};margin:26px 0 16px;">${esc(f.bio)}</p>` : ""}
        ${f.researchUrl ? `<p style="font-family:${FAM};font-size:16px;line-height:26px;margin:0 0 34px;"><a href="${esc(f.researchUrl)}" style="color:${CRIMSON};font-weight:600;">Click here</a> to read all of Red Cloud&rsquo;s research on ${esc(f.company)}</p>` : ""}

        ${sectionHead("Questions")}
        <p style="font-family:${FAM};font-size:16px;line-height:26px;margin:0 0 8px;">We&rsquo;ll address your questions in the live Q&amp;A session following the presentation!</p>
        <p style="font-family:${FAM};font-size:16px;line-height:26px;margin:0 0 26px;">You can also email us directly at
          <a href="mailto:${esc(f.questionsEmail || "webinars@redcloudfs.com")}" style="color:${CRIMSON};font-weight:600;">${esc(f.questionsEmail || "webinars@redcloudfs.com")}</a></p>
        <!-- QUESTIONS FORM: paste the site's existing webinar question form here
             (Elementor form). Everything else on this page is self-contained. -->

        ${btn(f.registerUrl)}

        <p style="font-family:${FAM};font-size:13px;line-height:22px;color:#777777;margin:26px 0 0;">
          <strong>Note:</strong> If you can&rsquo;t make the webinar live, a replay link will be automatically sent to your email once complete.<br>
          By registering for this webinar you are consenting to receiving future communications from ${esc(f.company)} and Red Cloud Financial Services Inc.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:40px 0 0;"><tbody><tr>
          ${metaBlock("Date & Time", esc(f.dateLong || "") + (f.time ? `<br>${esc(f.time)}` : ""))}
          ${metaBlock("Location", "Virtual")}
        </tr></tbody></table>
      </td>
      <td style="vertical-align:top;width:37%;padding:6px 48px 0 0;">${rightCol}</td>
    </tr></tbody></table>
</div>`;
}
