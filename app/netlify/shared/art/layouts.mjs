/* ─────────────────────────────────────────────────────────────
   Where every dynamic field sits on every template.

   Extracted from the Canva designs themselves — positions, sizes
   and colours are the values those elements carry, not eyeballed.
   `y`/`x` are the text box's top-left, as Canva reports them; the
   renderer converts to a baseline.

   Canva font refs map to Montserrat weights:
     YAD63FVFvTk  heavy display   -> 700
     YAD63FP2X60  regular UI      -> 600
     YAD63JA2occ  body            -> 500

   `fitWidth` on the tickers is the width of the WHITE area only,
   measured off each plate — not the width of the canvas. A four-
   listing ticker is long, and right-aligned text simply grows
   leftwards: without this it ran under the red WEBINARS badge.
   The values leave a margin so the text never touches the edge of
   the red.

   Every text field is uppercase, on every template, EXCEPT two:
   the website, because a domain is written lowercase; and the
   company paragraph on the invites, because forty words of caps
   flattens the word shapes that make prose readable and reads as
   a solid block of bold. Headlines and labels gain authority from
   caps; a paragraph only loses legibility. The source
   Canva designs were inconsistent about this — Twitter and the
   invites capped the headline, LinkedIn and Instagram did not —
   so it is enforced here rather than left to whichever template
   a client's graphic happens to come from.

   Twitter is the reference for type size: its title is ~3.9% of
   the canvas height and that proportion reads well. `scale`
   multiplies every text size on a template so the larger canvases
   approach the same proportion instead of leaving their type
   marooned in space — a 2500px poster set at Twitter's absolute
   sizes looks like a mistake.

   The invites cannot simply be scaled: their title sits so close
   to the bio that any increase runs into it, so their sizes and
   the bio's position are set directly. `collisions()` in
   render.mjs verifies every change against a worst-case title.

   If a designer changes a template, re-extract its plate and
   update the entry here. Nothing else needs touching.
   ───────────────────────────────────────────────────────────── */

export const LAYOUTS = {
  /* Filed in Box with the rest. Kept OUT of the invite email: the team's
     example invite (Pipeline Proof Co, 1 Oct 2026) carries only the large invite. */
  twitter: {
    label: "Twitter 1600x900",
    plate: "twitter",
    width: 1600, height: 900,
    dot: { cx: 51.16, cy: 160.67, r: 14.25 },
    logo: { x: 1135.94, y: 555.45, w: 430.12, h: 167.67 },
    presenterColumns: { width: 790 },
    text: [
      { key: "tickers",         x: 36.90,   y: 39.68,  size: 31.25, weight: 600, fill: "#ffffff", fitWidth: 960, upper: true },
      { key: "commodity",       x: 90,      y: 143.54, size: 28.76, weight: 600, fill: "#000000", upper: true, fitWidth: 560 },
      { key: "webinar_title",   x: 36.90,   y: 370.50, size: 35.43, weight: 600, fill: "#000000", wrap: 1248, upper: true, maxLines: 3 },
      { key: "webinar_date", fitWidth: 735,    x: 183.81,  y: 583.50, size: 27.35, weight: 700, fill: "#000000", upper: true },
      { key: "webinar_time", fitWidth: 735,    x: 183.81,  y: 639.28, size: 27.35, weight: 600, fill: "#000000", upper: true },
      { key: "presenter_name", fitWidth: 735,  x: 183.81,  y: 745.66, size: 27.35, weight: 700, fill: "#000000", upper: true },
      { key: "presenter_title", fitWidth: 735, x: 183.81,  y: 801.44, size: 27.35, weight: 600, fill: "#000000", upper: true },
      { key: "company_website", x: 1282.80, y: 831.05, size: 31.25, weight: 500, fill: "#ffffff", anchor: "middle", fitWidth: 430 },
    ],
  },

  linkedin: {
    label: "LinkedIn-FB 1200x1200",
    plate: "linkedin",
    width: 1200, height: 1200,
    scale: 1.3,
    dot: { cx: 51.16, cy: 146.58, r: 14.25 },
    logo: { x: 733.69, y: 953.15, w: 430.12, h: 167.67 },
    /* the logo sits right of x734 from y953, just below the presenter block.
       Columns may use the full width as long as they stay above it; see
       `avoid` in presenterColumns(). */
    presenterColumns: { width: 955, avoid: { x: 733.69, y: 945 } },
    text: [
      { key: "tickers",         x: 36.90,  y: 25.60,   size: 31.25, weight: 600, fill: "#ffffff", fitWidth: 710, upper: true },
      { key: "commodity",       x: 90,     y: 129.45,  size: 28.76, weight: 600, fill: "#000000", upper: true, fitWidth: 560 },
      { key: "webinar_title",   x: 36.90,  y: 370.39,  size: 34.06, weight: 600, fill: "#000000", wrap: 1043, maxLines: 3, upper: true },
      { key: "webinar_date", fitWidth: 735,    x: 195.07, y: 610.19,  size: 28.67, weight: 700, fill: "#000000", upper: true },
      { key: "webinar_time", fitWidth: 735,    x: 195.07, y: 668.19,  size: 28.67, weight: 600, fill: "#000000", upper: true },
      { key: "presenter_name", fitWidth: 735,  x: 195.07, y: 819.31,  size: 28.68, weight: 700, fill: "#000000", upper: true },
      { key: "presenter_title", fitWidth: 735, x: 195.07, y: 877.31,  size: 28.68, weight: 600, fill: "#000000", upper: true },
      { key: "company_website", x: 264.11, y: 1132.15, size: 31.25, weight: 500, fill: "#ffffff", anchor: "middle", fitWidth: 470 },
    ],
  },
  inviteSmall: {
    label: "Invite small 2500x3958",
    plate: "invite-small",
    width: 2500, height: 3958,
    dot: { cx: 1844.36, cy: 253.39, r: 35.29, attach: "before" },
    logo: { x: 550, y: 3020, w: 1400, h: 431 },
    text: [
      { key: "tickers",         x: 2395.90, y: 56.07,   size: 72,    weight: 700, fill: "#ffffff", anchor: "end", fitWidth: 1340, upper: true },
      { key: "commodity",       x: 2395.90, y: 214.71,  size: 80,    weight: 600, fill: "#232627", anchor: "end", upper: true, fitWidth: 1600 },
      { key: "webinar_title",   x: 110.18,  y: 962.20,  size: 128,   weight: 600, fill: "#232627", wrap: 2285, upper: true, maxLines: 3 },
      { key: "company_bio",     x: 110.18,  y: 1490   , size: 58,    weight: 500, fill: "#232627", wrap: 2285, clampLines: 5 },
      { key: "webinar_date", fitWidth: 1850,    x: 536.27,  y: 1976.49, size: 80,    weight: 700, fill: "#232627", upper: true },
      { key: "webinar_time", fitWidth: 1850,    x: 536.27,  y: 2109.76, size: 80,    weight: 600, fill: "#232627", upper: true },
      { key: "presenter_name", fitWidth: 1850,  x: 536.27,  y: 2405.67, size: 80,    weight: 700, fill: "#232627", upper: true },
      { key: "presenter_title", fitWidth: 1850, x: 536.27,  y: 2538.94, size: 80,    weight: 600, fill: "#232627", upper: true },
      { key: "company_website", fitWidth: 1500, x: 335.14,  y: 3792.99, size: 80,    weight: 600, fill: "#ffffff" },
    ],
  },
  inviteLarge: {
    label: "Invite large 2500x4534",
    plate: "invite-large",
    width: 2500, height: 4534,
    dot: { cx: 1844.36, cy: 253.39, r: 35.29, attach: "before" },
    logo: { x: 550, y: 3560, w: 1400, h: 431 },
    text: [
      { key: "tickers",         x: 2395.90, y: 56.07,   size: 72,    weight: 700, fill: "#ffffff", anchor: "end", fitWidth: 1340, upper: true },
      { key: "commodity",       x: 2395.90, y: 214.71,  size: 80,    weight: 600, fill: "#232627", anchor: "end", upper: true, fitWidth: 1600 },
      { key: "webinar_title",   x: 110.18,  y: 962.20,  size: 128,   weight: 600, fill: "#232627", wrap: 2285, upper: true, maxLines: 3 },
      { key: "company_bio",     x: 110.18,  y: 1490   , size: 58,    weight: 500, fill: "#232627", wrap: 2285, clampLines: 12 },
      { key: "webinar_date", fitWidth: 1850,    x: 536.27,  y: 2566.49, size: 80,    weight: 700, fill: "#232627", upper: true },
      { key: "webinar_time", fitWidth: 1850,    x: 536.27,  y: 2699.76, size: 80,    weight: 600, fill: "#232627", upper: true },
      { key: "presenter_name", fitWidth: 1850,  x: 536.27,  y: 2995.67, size: 80,    weight: 700, fill: "#232627", upper: true },
      { key: "presenter_title", fitWidth: 1850, x: 536.27,  y: 3128.94, size: 80,    weight: 600, fill: "#232627", upper: true },
      { key: "company_website", fitWidth: 1500, x: 333.35,  y: 4364.05, size: 80,    weight: 600, fill: "#ffffff" },
    ],
  },
  instagram: {
    label: "Instagram 1080x1350",
    plate: "instagram",
    width: 1080, height: 1350,
    scale: 1.3,
    dot: { cx: 986.04, cy: 120.58, r: 14.25, attach: "after" },
    /* This template's logo sits over a dark photograph, unlike the others.
       A normal dark-on-light logo disappears here, so a reversed (white)
       version is used when the client supplied one. */
    /* Instagram used to be the dark-background variant, and this slot was
       flagged onDark. It now uses the light plate like every other template,
       and the slot measures 0.765 — light. The flag was never read (the real
       decision comes from slotLuminance measuring the plate itself), so it is
       gone rather than left to mislead. */
    logo: { x: 594.14, y: 1027.997, w: 406.15, h: 158.32 },
    text: [
      { key: "tickers",         x: 1045.25, y: 19.20,   size: 27.36, weight: 700, fill: "#ffffff", anchor: "end", fitWidth: 590, upper: true },
      { key: "commodity",       x: 738.70,  y: 106.33,  size: 28.76, weight: 600, fill: "#232627", upper: true, fitWidth: 260 },
      { key: "webinar_title",   x: 46.20,   y: 470.54,  size: 32.84, weight: 600, fill: "#232627", wrap: 987, maxLines: 3, upper: true },
      { key: "webinar_date", fitWidth: 769,    x: 202.15,  y: 656.36,  size: 29.52, weight: 700, fill: "#232627", upper: true },
      { key: "webinar_time", fitWidth: 769,    x: 202.15,  y: 721.36,  size: 29.52, weight: 600, fill: "#232627", upper: true },
      { key: "presenter_name", fitWidth: 769,  x: 202.15,  y: 841.41,  size: 29.52, weight: 700, fill: "#232627", upper: true },
      { key: "presenter_title", fitWidth: 769, x: 202.15,  y: 906.41,  size: 29.52, weight: 600, fill: "#232627", upper: true },
      { key: "company_website", fitWidth: 640, x: 137.48,  y: 1275.32, size: 32.67, weight: 600, fill: "#ffffff" },
    ],
  },

  replayWebsite: {
    label: "Replay thumbnail - website 1280x720",
    plate: "replay-website",
    width: 1280, height: 720,
    scale: 1.35,
    /* no commodity dot on the replay thumbnails — the label sits in a white chip */
    logo: { x: 266.96, y: 275.29, w: 746.09, h: 340.15 },
    text: [
      { key: "commodity", x: 640, y: 155.64, size: 23.20, weight: 700, fill: "#222222", anchor: "middle", upper: true, fitWidth: 380, fallback: "company" },
    ],
  },

  replayYoutube: {
    label: "Replay thumbnail - YouTube 1280x720",
    plate: "replay-youtube",
    width: 1280, height: 720,
    scale: 1.05,
    logo: { x: 606.72, y: 239.49, w: 505.13, h: 230.29 },
    /* the lead presenter's photo fills the left third; cover-cropped, because a
       headshot letterboxed into a tall slot looks like a mistake */
    headshot: { x: -38.98, y: 195.52, w: 678.98, h: 524.48, cover: true },
    text: [
      { key: "commodity",       x: 640,    y: 155.64, size: 23.20, weight: 700, fill: "#222222", anchor: "middle", upper: true, fitWidth: 380, fallback: "company" },
      { key: "presenter_name", fitWidth: 640,  x: 606.72, y: 528,    size: 41.00, weight: 700, fill: "#222222", upper: true },
      { key: "presenter_title", fitWidth: 640, x: 606.72, y: 590,    size: 41.00, weight: 500, fill: "#222222", upper: true },
    ],
  },

  /* The thumbnail that fronts the webinar on the website and on YouTube.

     One element only: the client's logo, centred. No date, no title, no
     presenter — the page around it already carries those, and a thumbnail
     that repeats them is unreadable at the size it is actually seen.

     The slot is measured off the Canva original (the Skyharbour thumbnail of
     14 January 2026). 566 wide reproduces it exactly for a wide logo, because
     a wide mark is width-limited; 260 tall is the cap a square mark hits
     instead, which keeps it clear of the dark band across the bottom.
     Centred on x=640, and on y=324 — the middle of the space ABOVE the band,
     not the middle of the canvas. */
  thumbnail: {
    label: "Webinar thumbnail 1280x720",
    plate: "thumbnail",
    width: 1280, height: 720,
    scale: 1,
    logo: { x: 357, y: 194, w: 566, h: 260, trim: true },
    text: [],
  },
};

/** Templates that have both a plate and a layout, so can be drawn. */
export const READY = () => Object.keys(LAYOUTS);
