import { api } from "./_http.mjs";

/* Outbound mail via Resend — one HTTP call, no SMTP to babysit.
   Every send is recorded on the webinar record by the caller. */

export const mailNeeds = ["RESEND_API_KEY", "MAIL_FROM"];

export async function sendMail({ to, subject, text, html, ics, icsName, bcc }) {
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const body = {
    from: process.env.MAIL_FROM,
    to: list(to),
    subject,
    text: text || undefined,
    html: html || undefined,
  };
  if (bcc?.length) body.bcc = list(bcc);
  if (ics) {
    body.attachments = [{
      filename: icsName || "invite.ics",
      content: Buffer.from(ics, "utf8").toString("base64"),
    }];
  }
  const res = await api(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Resend",
  );
  return res.id;
}

export async function mailCheck() {
  const domains = await api(
    "https://api.resend.com/domains",
    { headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` } },
    "Resend",
  );
  const from = String(process.env.MAIL_FROM).split("@").pop().replace(/>$/, "");
  const match = (domains.data || []).find((d) => d.name === from);
  if (!match) {
    return `Connected, but "${from}" is not a verified sending domain — mail will bounce until it is added and verified in Resend.`;
  }
  return `Connected. Sending as ${process.env.MAIL_FROM} (domain status: ${match.status}).`;
}
