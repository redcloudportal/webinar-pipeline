import { sendMail, mailNeeds, mailCheck } from "./_mail.mjs";
import { longDate, alreadySent, noteSend } from "../record.mjs";

/* The scheduled emails — steps 9, 12, 13, 15 and 23. None of them carries any
   judgment; every one is a fixed template fired at a fixed offset. Step 15 is
   annotated "do not forget this one" in the written process, which is exactly
   the kind of thing a schedule is for. */

const fmt = (rec) => {
  const f = rec.facts;
  return {
    company: f.company,
    title: f.title || "",
    /* derived from the one confirmed start time, formatted in Red Cloud's own
       timezone — there is no second date field to fall out of step with it */
    date: longDate(rec),
    time: rec.schedule?.startTime || "TBC",
    contact: f.contact.name?.split(/\s+/)[0] || "there",
    to: [...new Set([f.contact.email, ...f.speakers.map((s) => s.email)].filter(Boolean))],
    cc: f.cc,
  };
};

function make({ key, label, steps, offsetMinutes, subject, body, audience }) {
  return {
    key, label, steps, needs: mailNeeds, when: { offsetMinutes },
    /* every one of these quotes the broadcast date back to the client */
    needsSchedule: true,
    async run(rec) {
      const v = fmt(rec);
      if (!v.to.length) throw new Error("No recipient email addresses on the record.");

      /* belt and braces: if the send succeeded but recording it did not, the
         connector stays un-done and would otherwise send the client a second copy */
      if (await alreadySent(rec.id, key)) {
        return { detail: "Already sent — not sent again" };
      }

      const id = await sendMail({
        to: v.to,
        /* 'wide' also reaches the client's own CC list; 'client' stays with the
           people running the webinar */
        bcc: audience === "wide" ? v.cc : undefined,
        subject: subject(v),
        text: body(v, rec),
      });
      await noteSend(rec.id, key, id);

      const extra = audience === "wide" && v.cc.length ? `, cc ${v.cc.length}` : "";
      return { detail: `Sent to ${v.to.length} recipient${v.to.length === 1 ? "" : "s"}${extra}` };
    },
    check: mailCheck,
  };
}

export const ALL = [
  make({
    /* an hour after the Mailchimp draft is built, so the eblast exists to point at */
    key: "send_distribution", label: "Distribution + next-steps email", steps: [9], offsetMinutes: -10020,
    audience: "wide",
    subject: (v) => `${v.company} Webinar with Red Cloud — ${v.date}`,
    body: (v) => `The ${v.company} webinar is confirmed for ${v.date} at ${v.time}.\n\n${v.title}\n\nRegistration details to follow.`,
  }),
  make({
    key: "send_tech_test", label: "Post-tech-test email", steps: [12], offsetMinutes: -4320,
    audience: "client",
    subject: (v) => `Webinar Tech Test Complete — ${v.company}`,
    body: (v) => `Hello ${v.contact},\n\nThanks for running through the technical test with us. Everything is set for ${v.date} at ${v.time}.\n\nWe will send your presenter links one hour before the start.`,
  }),
  make({
    key: "send_day_before", label: "Day-before email", steps: [13], offsetMinutes: -1440,
    audience: "client",
    subject: (v) => `Tomorrow: ${v.company} Webinar with Red Cloud`,
    body: (v) => `Hello ${v.contact},\n\nYour webinar is tomorrow, ${v.date}, at ${v.time}.\n\nWe will email your presenter links one hour before the start. Please join fifteen minutes early so we can run a quick sound and screen check.`,
  }),
  make({
    key: "send_links", label: "Presenter links at T-60", steps: [15], offsetMinutes: -60,
    audience: "client",
    subject: (v) => `Your presenter links — ${v.company} webinar today`,
    body: (v, rec) =>
      `Hello ${v.contact},\n\nYour webinar starts at ${v.time}.\n\n` +
      (rec.schedule?.presenterUrl
        ? `Presenter link: ${rec.schedule.presenterUrl}\n\n`
        : `Your Red Cloud producer will send your personalised presenter link shortly.\n\n`) +
      `Please join fifteen minutes early.`,
  }),
  make({
    key: "send_replay", label: "Replay emails", steps: [23], offsetMinutes: 240,
    audience: "wide",
    subject: (v) => `REPLAY: ${v.company} webinar`,
    body: (v, rec) =>
      `Thank you for hosting the webinar with us.\n\n` +
      (rec.steps?.youtube?.ref ? `Replay: ${rec.steps.youtube.ref}\n\n` : "") +
      `The registration list and a post-webinar summary report will follow.`,
  }),
];
