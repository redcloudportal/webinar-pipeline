/* ─────────────────────────────────────────────────────────────
   The commodity colours, taken from Red Cloud's own METALS
   REFERENCE SHEET in Canva. The coloured dot beside the metal
   label on every webinar graphic uses these, so a uranium
   webinar gets uranium yellow rather than whatever the last
   client's dot happened to be.
   ───────────────────────────────────────────────────────────── */

export const METAL_COLOURS = {
  gold:     "#9d7213",
  silver:   "#bfbfbe",
  copper:   "#c86423",
  zinc:     "#9b9b9b",
  pgm:      "#848f92",
  nickel:   "#d6d6d6",
  critical: "#d6aa4a",
  cobalt:   "#1167db",
  lithium:  "#80888d",
  uranium:  "#ebd82f",
};

/* Clients type this field freehand — "Uranium", "uranium/vanadium",
   "Gold & Silver", "PGMs". Match on the first metal we recognise, and be
   explicit when nothing matches rather than guessing a colour. */
const ALIASES = {
  au: "gold", ag: "silver", cu: "copper", zn: "zinc", ni: "nickel",
  co: "cobalt", li: "lithium", u: "uranium", u3o8: "uranium",
  platinum: "pgm", palladium: "pgm", pgms: "pgm", rhodium: "pgm",
  "critical minerals": "critical", "rare earth": "critical", "rare earths": "critical",
  ree: "critical", moly: "critical", molybdenum: "critical",
  potash: "critical", vanadium: "critical", graphite: "critical",
};

/** The metal key for whatever the client typed, or null if nothing matches.

    Matches on the metal named EARLIEST in the string, not the first entry in the
    map — "copper and gold" is a copper webinar, and picking by map order would
    silently make it a gold one. */
export function metalKey(input) {
  const s = String(input || "").toLowerCase().trim();
  if (!s) return null;

  let best = null;
  const consider = (key, at) => {
    if (at < 0) return;
    if (!best || at < best.at) best = { key, at };
  };

  for (const key of Object.keys(METAL_COLOURS)) {
    consider(key, s.search(new RegExp(`\\b${key}`, "i")));
  }
  for (const [alias, key] of Object.entries(ALIASES)) {
    consider(key, s.search(new RegExp(`\\b${alias}\\b`, "i")));
  }
  return best ? best.key : null;
}

/** Dot colour for a commodity, or null when we cannot tell — never a wrong guess. */
export function metalColour(input) {
  const key = metalKey(input);
  return key ? METAL_COLOURS[key] : null;
}

/** What the graphic prints in the commodity slot: uppercase, as the templates do. */
export function metalLabel(input) {
  return String(input || "").trim().toUpperCase();
}

/** Title case, for the form field a client reads and edits — "Gold", not "gold". */
export function metalTitleCase(input) {
  return String(input || "").trim()
    .split(/(\s+|[-/&])/)
    .map((part, i) => {
      if (!/[a-z]/i.test(part)) return part;
      /* initialisms stay shouted */
      if (/^(pgm|pgms|ree|esg|u3o8)$/i.test(part)) return part.toUpperCase();
      /* joining words stay lowercase unless they lead — "Copper and Gold" */
      if (i > 0 && /^(and|or|of|the|with|de|del)$/i.test(part)) return part.toLowerCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}
