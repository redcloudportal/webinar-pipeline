/* ── Red Cloud's research team ─────────────────────────────────
   The analyst hosting a webinar appears as the second presenter on the
   registration page, under the client's own speaker:

       Ron Stewart
       Managing Director, Mining Analyst
       Red Cloud Securities

   Who it is changes per webinar, so it is chosen in /ops alongside the
   broadcast time rather than typed out each time — a typo in a colleague's
   title is the kind of thing that reaches a client's page unnoticed.

   No headshots: the registration page lists the research team by name and
   title only.
   ───────────────────────────────────────────────────────────── */

export const FIRM = "Red Cloud Securities";

export const ANALYSTS = [
  { id: "david-talbot",   name: "David Talbot",        title: "Managing Director, Head of Equity Research" },
  { id: "ron-stewart",    name: "Ron Stewart",         title: "Managing Director, Mining Analyst" },
  { id: "alina-islam",    name: "Alina Islam",         title: "Mining Analyst" },
  { id: "shikhar-sarpal", name: "Shikhar Sarpal",      title: "Associate Mining Analyst" },
  { id: "alex-riazanov",  name: "Alex Riazanov, CFA",  title: "Associate Mining Analyst" },
  { id: "rushi-dokhale",  name: "Rushi Dokhale",       title: "Associate, Research" },
];

/** Look one up by id, or by the name already stored on older records. */
export function findAnalyst(idOrName) {
  const v = String(idOrName || "").trim().toLowerCase();
  if (!v) return null;
  return ANALYSTS.find((a) => a.id === v)
      || ANALYSTS.find((a) => a.name.toLowerCase() === v)
      || null;
}
