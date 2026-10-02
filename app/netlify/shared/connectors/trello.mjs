import { api } from "./_http.mjs";

/* Step 2 — create the Trello card, pre-filled, with the checklist already ticked
   for anything the intake form has answered. */

export const key   = "trello";
export const label = "Trello card";
export const steps = [2];
export const needs = ["TRELLO_KEY", "TRELLO_TOKEN", "TRELLO_LIST_ID"];
export const when  = "on-create";

const auth = () => `key=${encodeURIComponent(process.env.TRELLO_KEY)}&token=${encodeURIComponent(process.env.TRELLO_TOKEN)}`;

function description(rec) {
  const f = rec.facts;
  const L = [];
  L.push(`**${f.company}**${f.tickers ? ` — ${f.tickers}` : ""}`);
  if (f.metals)  L.push(`Commodity: ${f.metals}`);
  if (f.website) L.push(`Website: ${f.website}`);
  L.push("");
  L.push(`**Title**\n${f.title || "—"}`);
  L.push("");
  L.push(`**Bio**\n${f.bio || "—"}`);
  if (f.speakers.length) {
    L.push("");
    L.push("**Speakers**");
    f.speakers.forEach((s) => L.push(`- ${s.name}${s.title ? `, ${s.title}` : ""}${s.email ? ` <${s.email}>` : ""}`));
  }
  if (f.cc.length)      L.push(`\n**CC on emails**\n${f.cc.join(", ")}`);
  if (f.techTest)       L.push(`\n**Tech test**: ${f.techTest}`);
  if (f.deckWhen)       L.push(`**Deck ready**: ${f.deckWhen}`);
  if (f.assetLinks)     L.push(`**Asset links**: ${f.assetLinks}`);
  if (f.notes)          L.push(`\n**Client notes**\n${f.notes}`);
  L.push(`\n---\nSubmitted by ${f.contact.name} <${f.contact.email}> · record \`${rec.id}\``);
  return L.join("\n");
}

export async function run(rec) {
  const f = rec.facts;
  const card = await api(
    `https://api.trello.com/1/cards?${auth()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idList: process.env.TRELLO_LIST_ID,
        name: `${f.company}${f.tickers ? ` (${f.tickers})` : ""} — Webinar`,
        desc: description(rec),
        pos: "top",
      }),
    },
    "Trello",
  );

  /* the 29 steps as a checklist, so the card mirrors the documented process */
  const checklist = await api(
    `https://api.trello.com/1/checklists?${auth()}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idCard: card.id, name: "Webinar process" }),
    },
    "Trello",
  );

  const ITEMS = [
    "1 · Content collected", "2 · Trello card", "3 · StreamYard set up", "4 · Registration page",
    "5 · Graphics", "6 · Graphics approved", "7 · Calendar copy", "8 · Calendar invites",
    "9 · Distribution email", "10 · Mailchimp eblast", "11 · Tech test", "12 · Post-tech-test email",
    "13 · Day-before email", "14 · Deck uploaded", "15 · Links at T-60", "16 · Broadcast",
    "17 · Timecodes", "18 · Branded replay", "19 · YouTube", "20 · Replay page",
    "21 · Registration page removed", "22 · Analytics", "23 · Replay emails", "24 · Clips",
    "25 · Files to storage", "26 · Clip copy", "27 · CEO.ca", "28 · Feedback report", "29 · Report sent",
  ];
  for (const name of ITEMS) {
    await api(
      `https://api.trello.com/1/checklists/${checklist.id}/checkItems?${auth()}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, checked: name.startsWith("1 ·") || name.startsWith("2 ·") }),
      },
      "Trello",
    );
  }

  return { detail: `Card created with the 29-step checklist`, ref: card.shortUrl || card.url };
}

export async function check() {
  const list = await api(`https://api.trello.com/1/lists/${process.env.TRELLO_LIST_ID}?${auth()}`, {}, "Trello");
  return `Connected. Cards will land in the list "${list.name}".`;
}
