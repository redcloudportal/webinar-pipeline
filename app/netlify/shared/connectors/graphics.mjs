import { boxConfig, getAccessToken as boxToken, ensureFolder, uploadFile, safeName as boxSafeName, folderLink, resolveClientFolder } from "../box.mjs";
import { longDate, rememberFolder, knownFolder, noteFolderGone, folderWasDeleted , webinarDateKey, rememberAssets, publishArt } from "../record.mjs";
import { metalColour, metalLabel } from "../metals.mjs";
import { heroPng, framedPng } from "../art/email-art.mjs";
import { subject } from "../social.mjs";
import { draw, analyseLogo, analysePhoto, removeBackground, fitLogoToSlot, plateLuminance } from "../art/render.mjs";
import { LAYOUTS } from "../art/layouts.mjs";
import { safeFetch, findLogos, BROWSER_HEADERS } from "../scrape.mjs";

/* Step 5 — build the webinar graphics.

   Drawn here rather than in Canva. Each template contributes a PLATE (its fixed
   artwork, exported once) and a LAYOUT (where the dynamic fields sit); the
   renderer composes them with the submission's facts.

   Why not Canva: its autofill API is metered, and the free quota ran out after
   three graphics — one webinar's worth is seven. Drawing locally has no quota,
   no polling, and takes milliseconds. The cost is that a template change needs
   its plate and layout re-extracted; tools/extract-plate.md has the steps.

   Nothing publishes itself. These are drafts for the approval at step 6. */

export const key   = "graphics";
export const label = "Webinar graphics";
export const steps = [5];
export const needs = ["BOX_CLIENT_ID", "BOX_CLIENT_SECRET", "BOX_SUBJECT_ID", "BOX_FOLDER_ID"];
export const when  = "on-create";
/* Deliberately NOT needsSchedule. These are wanted the moment a submission
   lands, so they are drawn immediately with whatever is known. Without a
   confirmed time the date reads "TBC" — and /ops redraws them, replacing the
   files, as soon as a broadcast time is saved. */
export const rebuildOnSchedule = true;
/* seven renders plus seven uploads — too long to hold an HTTP request open */
export const slow = true;

/** Strip the protocol so the graphic reads "company.com", as the templates do. */
function tidyWebsite(url) {
  return String(url || "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** The facts each field wants, in the shape the templates expect. */
export function fieldsFor(rec) {
  const f = rec.facts;
  const speakers = f.speakers || [];
  const lead = speakers[0] || {};

  /* Every presenter, kept as name + title pairs.

     This used to fold speakers 2+ into the lead's title as "Name, Title" on a
     second line, so on Skyharbour's graphics Serdar Donmez sat underneath
     Jordan Trimble's job title and read as part of it. The renderer now lays
     two or three presenters out side by side, each with their own name and
     role, divided by a rule — the way the designed templates do it. */
  const presenters = speakers
    .map((s) => ({ name: s.name || "", title: s.title || "" }))
    .filter((p) => p.name || p.title);

  return {
    company:         f.company || "",
    webinar_title:   f.title || "",
    commodity:       metalLabel(f.metals),
    tickers:         f.tickers || "",
    presenter_name:  lead.name || "",
    presenter_title: lead.title || "",
    presenters,
    /* longDate already returns "TBC" when no broadcast time is set */
    webinar_date:    longDate(rec),
    webinar_time:    rec.schedule?.startTime || f.clientTime || "TBC",
    company_website: tidyWebsite(f.website),
    company_bio:     f.bio || "",
  };
}

/* Image dimensions, read from the file itself.

   resvg composites PNG and JPEG. WebP and SVG it will not, so those are
   refused by name rather than producing a graphic with a silent hole where the
   logo should be. Clients' own sites increasingly serve WebP. */
function pngHasAlpha(buf) {
  /* IHDR colour type: 4 = grey+alpha, 6 = RGBA. 3 is a palette, which carries
     transparency only if a tRNS chunk is present. */
  const colourType = buf[25];
  if (colourType === 4 || colourType === 6) return true;
  if (colourType === 3) return buf.includes(Buffer.from("tRNS", "ascii"));
  return false;
}

function imageSize(buf) {
  if (buf.length > 26 && buf.readUInt32BE(0) === 0x89504e47) {
    return {
      kind: "png",
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      hasAlpha: pngHasAlpha(buf),
    };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    /* walk the JPEG segments to the frame header that carries the size */
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        /* JPEG cannot carry transparency at all */
        return { kind: "jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), hasAlpha: false };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (buf.length > 12 && buf.toString("ascii", 8, 12) === "WEBP") return { kind: "webp" };
  if (buf.toString("utf8", 0, 200).includes("<svg")) return { kind: "svg" };
  return null;
}

/** Fetch one file and read its PNG dimensions. */
async function fetchPng(url) {
  try {
    /* browser headers: the same firewalls that refused our page fetches refuse
       a bare image request too */
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error(`download returned ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const size = imageSize(buffer);

    /* An SVG logo is the best kind a site can serve, and it used to be refused.
       resvg is already here to draw the graphics, so rasterise it at a width
       that stays crisp in the largest logo slot and carry on. */
    if (size?.kind === "svg") {
      const { Resvg } = await import("@resvg/resvg-js");
      const png = Buffer.from(new Resvg(buffer.toString("utf8"), {
        fitTo: { mode: "width", value: 1600 }, font: { loadSystemFonts: false },
      }).render().asPng());
      return { buffer: png, width: png.readUInt32BE(16), height: png.readUInt32BE(20), kind: "svg", hasAlpha: true };
    }
    if (!size || !size.width) {
      /* `rec` is not in scope here — this used to say `${rec.id}` and threw a
         ReferenceError, so the real reason ("it is a WebP") was replaced by a
         confusing "rec is not defined" in the logs. */
      console.error(`graphics: ${url} is ${size?.kind || "an unrecognised format"}, so it was left off`);
      return { unusable: size?.kind || "unrecognised" };
    }
    /* a data URI is fine for both — resvg reads the magic bytes.
       `hasAlpha: false` means the file carries a solid background, so the
       renderer knocks the white out rather than stamping a white box onto the
       artwork. Clients supply such files constantly. */
    return { buffer, width: size.width, height: size.height, kind: size.kind, hasAlpha: size.hasAlpha };
  } catch (err) {
    console.error(`graphics: could not read ${url}:`, err.message);
    return null;
  }
}

const looksReversed = (url) =>
  /(white|light|reverse|reversed|knockout|-inv|inverted)/i.test(decodeURIComponent(url));

/* Two logos, where the client gave us two. The first upload is the main logo;
   a file whose name says white/light/reversed is used on templates whose logo
   area is a dark photograph. Most clients send only one, and then the main
   logo is used everywhere with a note — better a flagged graphic than a logo
   nobody can see. */
/* ── choosing which logo to draw ───────────────────────────────
   Every logo slot in these templates sits on something light — the
   invites put it on a white band — so a company's REVERSED (white)
   mark is invisible there. Nothing in the file says which kind it
   is, so each candidate is rendered small and measured.

   Order of preference:
     1. a candidate that is not reversed, in the order supplied
     2. otherwise the reversed one, drawn inverted so it is at
        least visible, and said so plainly on the record

   Inverting a white mark gives a dark one, which is right for a
   single-colour logo and approximate for anything else. It beats
   an invisible logo, and the note tells a human to check. */
async function fetchLogos(rec) {
  /* Only files the client actually put in the logo field, then whatever was
     found on their own site. A headshot can never be a candidate: it is
     excluded explicitly rather than by hoping it sorts last. */
  const headshotUrls = new Set((rec.headshots || []).map((h) => h.url));

  let uploaded = rec.logoFiles;
  if (!Array.isArray(uploaded)) {
    /* Records written before logoFiles existed. Fall back to the old
       positional guess, minus the bug: skip anything that is a headshot. */
    uploaded = (rec.files || []).filter((u) => !headshotUrls.has(u)).slice(0, 1);
  }

  const sources = [];
  for (const u of uploaded) if (u && !headshotUrls.has(u)) sources.push(u);
  if (rec.facts?.logoUrl) sources.push(rec.facts.logoUrl);

  const tried = [];
  let unusable = null;
  for (const url of sources) {
    const img = await fetchPng(url);
    /* A format the renderer cannot read — WebP above all, which is what most
       WordPress sites now serve. Remember it so the record can say so plainly
       instead of just showing a missing logo. */
    if (img?.unusable) { unusable = unusable || img.unusable; continue; }
    if (!img) continue;
    const look = await analyseLogo(img.buffer, { hasAlpha: img.hasAlpha });
    if (look.blank) {
      console.error(`graphics: a logo for ${rec.id} rendered as nothing, skipping it`);
      continue;
    }
    if (!look.reversed) return { main: { ...img }, look, note: null };
    tried.push({ img, look });
  }

  /* ── nothing usable supplied: find it ourselves ────────────
     Skyharbour's second submission arrived with no drawable logo and the
     graphics went out with an empty slot, although a perfectly good one sat in
     the header of their own website. When the client gives us nothing we can
     use, read their site and try every logo candidate on it, best first,
     preferring a normal mark over a reversed one. A client's own upload is
     never overridden — this only runs when there was nothing to use. */
  let fromSite = false;
  if (!tried.length && rec.facts?.website) {
    try {
      const home = /^https?:\/\//i.test(rec.facts.website) ? rec.facts.website : `https://${rec.facts.website}`;
      const { html, finalUrl } = await safeFetch(home);
      const urls = findLogos(html, finalUrl.toString(), { includeOg: false, logoOnly: true })
        .filter((u) => !sources.includes(u))
        .slice(0, 8);
      for (const url of urls) {
        const img = await fetchPng(url);
        if (!img || img.unusable) continue;
        const look = await analyseLogo(img.buffer, { hasAlpha: img.hasAlpha });
        if (look.blank) continue;
        if (!look.reversed) {
          return { main: { ...img }, look, note: `no usable logo was supplied, so the one on ${finalUrl.hostname} was used — worth a glance` };
        }
        tried.push({ img, look });
        fromSite = true;
      }
    } catch (err) {
      console.error(`graphics: could not read ${rec.facts.website} for a logo:`, err.message);
    }
  }

  if (tried.length) {
    return {
      main: tried[0].img,
      look: tried[0].look,
      note: fromSite
        ? "no usable logo was supplied; the only one on their website is a white version, recoloured per template to read on each backdrop — worth a look"
        : "the only logo supplied is the reversed (white) version — it is flipped per " +
          "template so it reads on each backdrop, which is worth a look",
    };
  }
  return {
    main: null, look: null,
    note: unusable === "webp"
      ? "the logo on the company's website is a WebP, which we cannot draw with — ask them for a PNG or JPG " +
        "and re-run this step"
      : unusable
        ? `the supplied logo is ${unusable}, which we cannot draw with — ask for a PNG or JPG`
        : null,
  };
}


export async function run(rec) {
  const cfg = boxConfig();
  const company = boxSafeName(rec.facts.company);
  const fields = fieldsFor(rec);
  const dotColour = metalColour(rec.facts.metals);
  const { main: logo, look: logoLook, note: logoNote } = await fetchLogos(rec);

  /* Only the YouTube replay tile uses a headshot, and only the lead speaker's.
     Its design wants the presenter cut out and standing on the texture, so the
     background is removed properly rather than left as a photo panel. */
  const leadShot = (rec.headshots || []).find((h) => h.speaker === 1);
  let headshot = leadShot ? await fetchPng(leadShot.url) : null;
  let headshotNote = null;
  if (headshot) {
    const cut = await removeBackground(headshot.buffer, headshot.width, headshot.height);
    if (cut?.alreadyCutOut) {
      headshot = { ...headshot, cutOut: true };
    } else if (cut) {
      headshot = { buffer: cut.buffer, width: cut.width, height: cut.height, cutOut: true };
    } else {
      /* a busy or non-uniform backdrop needs real segmentation, which is not
         available here — the photo goes on as supplied and a human is told */
      headshotNote = "the presenter photo has a background we could not remove automatically, " +
                     "so it is placed as supplied — a plain-backdrop or pre-cut photo would sit better";
    }
  }

  const token = await boxToken();

  const clientFolder = await resolveClientFolder(
    rec, token, { knownFolder, rememberFolder, noteFolderGone, folderWasDeleted, dateStamp: webinarDateKey },
  );
  /* null means the Box folder was deleted on purpose. Drawing every graphic
     just to put them back in a folder someone tidied away is the bug this
     guards; say so plainly instead. */
  if (!clientFolder) {
    return { status: "skipped", detail: "Box folder was deleted, so nothing was rebuilt. Submit again to start a fresh folder." };
  }
  const graphicsFolder = await ensureFolder("Graphics", clientFolder, token);

  const made = [];
  const failed = [];
  const flipped = [];
  const plated = [];
  const needsHeadshot = [];
  const skippedNoLogo = [];
  const assets = {};      // template name -> Box file id, for the social copy
  let thumbPng = null;    // kept for the invite email's framed card

  for (const [name, layout] of Object.entries(LAYOUTS)) {
    if (layout.emailOnly) continue;      // drawn for the email below, never filed
    try {
      /* Whether the mark needs reversing depends on THIS template's backdrop,
         measured from its own artwork — Instagram puts the logo on a dark panel
         while every other template uses a light one, so the same logo needs
         opposite treatment depending on where it lands. */
      let wanted = logo;
      if (logo) {
        const fit = await fitLogoToSlot(layout, logoLook);
        if (fit.mode === "reverse") {
          /* a mark that is ALREADY the reversed white version and is being
             reversed again lands back where it started, so the flags cancel */
          wanted = { ...logo, mode: logo.invert ? "none" : "reverse", toWhite: fit.toWhite };
          if (!logo.invert) flipped.push(layout.label);
        } else if (fit.mode === "plate") {
          wanted = { ...logo, mode: "plate", toWhite: fit.toWhite };
          plated.push(layout.label);
        }
      }
      if (layout.headshot && !headshot) needsHeadshot.push(layout.label);

      /* A template whose ONLY element is the logo has nothing left to say
         without one: it would upload as a bare background, which looks
         finished and is not. Skip it and name it, rather than filing a blank
         tile someone has to notice for themselves. */
      if (layout.logo && !wanted && !layout.text.length) {
        skippedNoLogo.push(layout.label);
        continue;
      }

      const png = await draw(layout, fields, { dotColour, logo: wanted, headshot });
      const up = await uploadFile({
        name: `${company} — ${layout.label}.png`,
        mimeType: "image/png",
        data: png,
        parentId: graphicsFolder,
        token,
      });
      if (up?.id) assets[name] = String(up.id);
      if (name === "thumbnail") thumbPng = png;
      made.push(layout.label);
    } catch (err) {
      console.error(`graphics: ${name} failed for ${rec.id}:`, err.message);
      failed.push(`${layout.label} (${err.message})`);
    }
  }

  if (!made.length) throw new Error(`No graphics could be built. ${failed.join("; ")}`);

  /* so the social copy can point at the exact file for each post */
  await rememberAssets(rec.id, assets);

  /* ── the image the invite email loads ──────────────────────
     The team's invite carries the LARGE invite and nothing else (the 1600x900
     X card at the bottom was taken out of their example on 1 Oct 2026). Box
     cannot serve it to a mail client, so it is drawn again at email size —
     drawn at that size, not scaled down, so the type stays sharp — and
     published where a fetch with no credentials can reach. A failure here must
     not cost the graphics that already filed. */
  const emailArt = {};
  /* the newsletter-style design's two images: the hero, and the webinar
     thumbnail in red corner brackets */
  try {
    const p = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric",
      timeZone: rec.schedule?.startTimeISO ? (process.env.DISPLAY_TZ || "America/Toronto") : "UTC" });
    const key = webinarDateKey(rec);
    const when = rec.schedule?.startTimeISO ? new Date(rec.schedule.startTimeISO)
      : key ? new Date(`${key}T12:00:00Z`) : null;
    const subj = subject(rec);
    const hero = await heroPng({ company: rec.facts.company, subject: subj, dateShort: when ? p.format(when).replace(".", "") : "" });
    emailArt.hero = await publishArt(rec.id, "hero", hero.png, { template: "email-hero", width: hero.width });
    const heroD = await heroPng({ company: rec.facts.company, subject: subj, dateShort: when ? p.format(when).replace(".", "") : "" }, { theme: "dark" });
    emailArt.heroDark = await publishArt(rec.id, "heroDark", heroD.png, { template: "email-hero-dark", width: heroD.width });
    if (thumbPng) {
      const card = await framedPng(thumbPng);
      emailArt.card = await publishArt(rec.id, "card", card.png, { template: "email-card", width: card.width });
    }
  } catch (err) {
    console.error(`graphics: could not draw the newsletter-style email images for ${rec.id}:`, err.message);
  }
  for (const [slot, key, width] of [["top", "inviteLarge", 1200]]) {
    try {
      const L = LAYOUTS[key];
      if (!L) continue;
      const fit = logo ? await fitLogoToSlot(L, logoLook) : null;
      const lg = !logo ? null
        : fit?.mode === "reverse" ? { ...logo, mode: logo.invert ? "none" : "reverse", toWhite: fit.toWhite }
        : fit?.mode === "plate" ? { ...logo, mode: "plate", toWhite: fit.toWhite }
        : logo;
      const png = await draw(L, fields, { dotColour, logo: lg, width });
      emailArt[slot] = await publishArt(rec.id, slot, png, { template: key, width });
    } catch (err) {
      console.error(`graphics: could not publish the email ${slot} image for ${rec.id}:`, err.message);
    }
  }

  /* "TBC" only when the graphics ACTUALLY read TBC.

     This used to be `!rec.schedule?.startTimeISO`, which flagged every graphic
     built before a broadcast time was confirmed — including the ones carrying
     the client's own date perfectly well. The message sent people rebuilding
     graphics that were already correct. */
  const confirmed = Boolean(rec.schedule?.startTimeISO);
  const dateOnArt = longDate(rec);
  const provisional = !confirmed && dateOnArt === "TBC";
  const clientDated = !confirmed && dateOnArt !== "TBC";

  return {
    detail: `Built ${made.length} graphic${made.length === 1 ? "" : "s"}` +
            (provisional ? " — no date yet, so they read TBC; they redraw when a broadcast time is set" : "") +
            (clientDated ? ` — dated ${dateOnArt} from the client; redraws if Red Cloud confirms a different time` : "") +
            (logo ? "" : " (no usable logo — needs a PNG or JPEG)") +
            (logoNote ? ` — ${logoNote}` : "") +
            (plated.length
              ? ` — logo placed on a panel for ${plated.join(", ")} because its colours could not be changed`
              : "") +
            (headshotNote ? ` — ${headshotNote}` : "") +
            (needsHeadshot.length
              ? ` — ${needsHeadshot.join(", ")} has no presenter headshot`
              : "") +
            (emailArt.top ? "" : " — the invite email has no image: the large invite could not be published") +
            (skippedNoLogo.length
              ? ` — ${skippedNoLogo.join(", ")} NOT built: that template is the logo and nothing else`
              : "") +
            (flipped.length
              ? ` — logo reversed for ${flipped.join(", ")} so it reads against the backdrop`
              : "") +
            (dotColour ? "" : ` (commodity "${rec.facts.metals}" not on the metals sheet, so no dot colour)`) +
            (failed.length ? ` — failed: ${failed.join("; ")}` : ""),
    ref: folderLink(graphicsFolder),
  };
}

export async function check() {
  const names = Object.values(LAYOUTS).filter((l) => !l.emailOnly).map((l) => l.label);
  const first = Object.values(LAYOUTS).find((l) => !l.emailOnly);

  /* Rendering without throwing proves nothing: if no font is available, resvg
     draws the plate, silently skips every text node, and returns a perfectly
     valid PNG. That is how blank graphics reached Box while every check passed.
     So compare a render carrying text against an empty one — identical bytes
     means the text was dropped. */
  let withText, blank;
  try {
    withText = await draw(first, { webinar_title: "Connection test", tickers: "TSX: TEST" }, {});
    blank = await draw(first, {}, {});
  } catch (err) {
    return `Templates present but the renderer failed: ${err.message}`;
  }

  if (withText.length === blank.length) {
    return `BROKEN: text is not being drawn — graphics would come out as empty templates. ` +
           `The font files are not reaching the renderer (${withText.length} bytes with and without text).`;
  }

  /* ── two standing rules from Red Cloud, checked rather than assumed ──

     1. EVERY plate is the light variant. The Canva templates carry a dark
        page 1 and a light page 2, and the dark ones were shipped once by
        mistake. Measuring the plate catches a wrong re-export immediately.
     2. The headshot appears on EXACTLY ONE graphic. It is the YouTube replay
        tile; every other template uses the logo. Adding a `headshot` slot to
        a second layout would silently break that, so the count is asserted. */
  const withHeadshot = Object.values(LAYOUTS).filter((l) => l.headshot).map((l) => l.label);
  if (withHeadshot.length !== 1) {
    return `BROKEN: the headshot must appear on exactly one graphic, but ${withHeadshot.length} ` +
           `templates have a headshot slot (${withHeadshot.join(", ") || "none"}).`;
  }

  const dark = [];
  for (const layout of Object.values(LAYOUTS)) {
    const lum = await plateLuminance(layout);
    if (lum < 0.35) dark.push(`${layout.label} (${lum.toFixed(2)})`);
  }
  if (dark.length) {
    return `BROKEN: these plates are the DARK variant — every template must use the light one: ${dark.join(", ")}.`;
  }

  return `Ready. Draws ${names.length} graphics locally, no Canva. ` +
         `Text renders (+${withText.length - blank.length} bytes). ` +
         `All plates light; headshot only on ${withHeadshot[0]}. ${names.join("; ")}.`;
}
