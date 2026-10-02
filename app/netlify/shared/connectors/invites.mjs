/* Step 8 — the two calendar invites, as real .ics attachments emailed to the
   right people. Presenter login runs T-15m to start; the audience invite runs
   start to +1 hour. Those offsets come straight from the process document. */

import { sendMail, mailNeeds, mailCheck } from "./_mail.mjs";
import { startOf, alreadySent, noteSend } from "../record.mjs";

export const key   = "invites";
export const label = "Calendar invites";
export const steps = [8];
export const needs = mailNeeds;
export const when  = "on-create";
/* nothing can be invited to a webinar with no time; runOne parks it until /ops sets one */
export const needsSchedule = true;

function icsStamp(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function ics({ uid, title, description, start, end, organiser, attendees }) {
  const esc = (s) => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Red Cloud//Webinar//EN", "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    `ORGANIZER;CN=Red Cloud:mailto:${organiser}`,
    ...attendees.map((a) => `ATTENDEE;CN=${esc(a)};RSVP=TRUE:mailto:${a}`),
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

export async function run(rec) {
  const f = rec.facts;
  const start = startOf(rec);
  if (!start) {
    throw new Error("No confirmed broadcast start time on the record yet — set one in /ops before invites can go out.");
  }

  const organiser = process.env.MAIL_FROM;
  const presenters = f.speakers.map((s) => s.email).filter(Boolean);
  const audience = [...new Set([...presenters, ...f.cc, f.contact.email].filter(Boolean))];

  if (!presenters.length && !audience.length) {
    throw new Error("No speaker or contact email addresses on the record to invite.");
  }

  const presenterStart = new Date(start.getTime() - 15 * 60000);
  const sent = [];
  const skipped = [];

  /* This connector makes TWO outbound sends. If the second one fails the whole
     connector is marked failed — and a retry would otherwise re-send the first,
     putting a duplicate invite in the presenters' calendars. Each send is
     recorded the instant it succeeds, and a retry resumes rather than restarts. */

  if (presenters.length) {
    if (await alreadySent(rec.id, "invite_presenter")) {
      skipped.push("presenter login (already sent)");
    } else {
      const id = await sendMail({
        to: presenters,
        subject: `Presenter Login: ${f.company} Webinar w/ Red Cloud`,
        text:
          "Media will send you a personalised URL to connect to the webinar presenter platform. " +
          "Links will be sent 45-60 minutes prior to start time.",
        ics: ics({
          uid: `${rec.id}-presenter@redcloudfs.com`,
          title: `Presenter Login: ${f.company} Webinar w/ Red Cloud`,
          description: "Connect to the webinar presenter platform via the URL we send you.",
          start: presenterStart, end: start, organiser, attendees: presenters,
        }),
        icsName: "presenter-login.ics",
      });
      await noteSend(rec.id, "invite_presenter", id);
      sent.push(`presenter login to ${presenters.length}`);
    }
  }

  if (audience.length) {
    if (await alreadySent(rec.id, "invite_audience")) {
      skipped.push("webinar invite (already sent)");
    } else {
      const id = await sendMail({
        to: audience,
        subject: `Red Cloud Webinar Series Presents ${f.company}${f.title ? ` | ${f.title}` : ""}`,
        text: `${f.title || ""}\n\n${f.bio || ""}`.trim(),
        ics: ics({
          uid: `${rec.id}-webinar@redcloudfs.com`,
          title: `Red Cloud Webinar Series Presents ${f.company}`,
          description: f.title || "",
          start, end: new Date(start.getTime() + 60 * 60000), organiser, attendees: audience,
        }),
        icsName: "webinar.ics",
      });
      await noteSend(rec.id, "invite_audience", id);
      sent.push(`webinar invite to ${audience.length}`);
    }
  }

  const parts = [sent.length ? `Sent ${sent.join(" and ")}` : null,
                 skipped.length ? `skipped ${skipped.join(" and ")}` : null].filter(Boolean);
  return { detail: parts.join("; ") || "Nothing left to send" };
}

export const check = mailCheck;
