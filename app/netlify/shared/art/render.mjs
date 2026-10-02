import { PLATES, FONTS } from "./assets.mjs";
import { floodCutOut, encodePng, shardLoss, SHARD_LIMIT } from "./cutout.mjs";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ─────────────────────────────────────────────────────────────
   Draws a webinar graphic without calling Canva.

   Each template contributes two things, extracted once:
     · a PLATE — the fixed artwork as a PNG, with every dynamic
       field deleted. Static furniture (the WEBINAR wordmark, the
       badges, the icon pills) is baked in, so it never has to be
       reproduced and can never drift.
     · a LAYOUT — where each dynamic field sits, at what size and
       weight, taken from the Canva design itself.

   Text is laid out here rather than by a browser, so line breaks
   are measured against the real font metrics. An estimate would
   wrap a long title a word early or late, which on a 2500px
   poster is plainly visible.
   ───────────────────────────────────────────────────────────── */

/* Loaded on first use, not at import. resvg ships a per-platform native
   binary; when the wrong one is bundled the require throws, and at module
   scope that 502s every function that imports the connector list — the form
   API included. A drawing failure must only break drawing. */
let _Resvg = null;
async function resvg() {
  if (!_Resvg) ({ Resvg: _Resvg } = await import("@resvg/resvg-js"));
  return _Resvg;
}

const WEIGHTS = [500, 600, 700, 800];

const fontBuf = (weight) =>
  Buffer.from(FONTS[`Montserrat-${WEIGHTS.includes(weight) ? weight : 600}`], "base64");

/* ── getting the fonts into resvg ──────────────────────────────
   The fonts are embedded as base64 and handed over as real files
   on disk, written once per cold start into the function's own
   writable /tmp.

   Passing them as `fontBuffers` worked on macOS and silently did
   nothing on Netlify's Linux build: resvg found no font, skipped
   every text node, and returned a perfectly valid PNG of the bare
   template. Graphics went to Box blank while every check passed,
   because "it rendered without throwing" is not the same as "the
   words are on it". `fontFiles` behaves the same everywhere.
   ───────────────────────────────────────────────────────────── */
let fontDir = null;
function ensureFonts() {
  if (fontDir) return fontDir;
  const dir = join(tmpdir(), "rc-webinar-fonts");
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const w of WEIGHTS) {
    const f = join(dir, `Montserrat-${w}.ttf`);
    if (!existsSync(f)) writeFileSync(f, fontBuf(w));
    files.push(f);
  }
  fontDir = files;
  return files;
}

/* ── font metrics ──────────────────────────────────────────────
   Advance widths come straight from each font's hmtx/cmap, so a
   wrapped line is measured, not guessed. Parsed once per cold
   start and cached.
   ───────────────────────────────────────────────────────────── */

const metricsCache = new Map();

function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
function i16(b, o) { const v = u16(b, o); return v & 0x8000 ? v - 0x10000 : v; }
function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }

function readMetrics(weight) {
  if (metricsCache.has(weight)) return metricsCache.get(weight);
  const b = fontBuf(weight);

  const numTables = u16(b, 4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])] = { off: u32(b, o + 8) };
  }

  const unitsPerEm = u16(b, tables.head.off + 18);
  const numHMetrics = u16(b, tables.hhea.off + 34);

  /* cmap format 4 — the Basic Multilingual Plane, which is all these graphics use */
  const cmapOff = tables.cmap.off;
  let subOff = 0;
  for (let i = 0, n = u16(b, cmapOff + 2); i < n; i++) {
    const rec = cmapOff + 4 + i * 8;
    const pid = u16(b, rec), eid = u16(b, rec + 2);
    if ((pid === 3 && (eid === 1 || eid === 0)) || pid === 0) subOff = cmapOff + u32(b, rec + 4);
  }

  const segX2 = u16(b, subOff + 6);
  const ends = subOff + 14, starts = ends + segX2 + 2;
  const deltas = starts + segX2, ranges = deltas + segX2;

  const glyphFor = (cp) => {
    for (let s = 0; s < segX2 / 2; s++) {
      if (cp > u16(b, ends + s * 2)) continue;
      const start = u16(b, starts + s * 2);
      if (cp < start) return 0;
      const ro = u16(b, ranges + s * 2);
      if (ro === 0) return (cp + i16(b, deltas + s * 2)) & 0xffff;
      const gi = u16(b, ranges + s * 2 + ro + (cp - start) * 2);
      return gi ? (gi + i16(b, deltas + s * 2)) & 0xffff : 0;
    }
    return 0;
  };

  const advance = (gid) => {
    const i = Math.min(gid, numHMetrics - 1);
    return u16(b, tables.hmtx.off + i * 4);
  };

  const m = { unitsPerEm, widthOf: (ch) => advance(glyphFor(ch.codePointAt(0))) };
  metricsCache.set(weight, m);
  return m;
}

/** Width of a string at a given size, in px. */
export function measure(text, size, weight) {
  const m = readMetrics(weight);
  let units = 0;
  for (const ch of String(text)) units += m.widthOf(ch);
  return (units / m.unitsPerEm) * size;
}

/** Break text to fit a width, measuring each candidate line. */
export function wrap(text, size, weight, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (measure(candidate, size, weight) <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

/* ── laying out one text block ─────────────────────────────────
   Wraps the value at the block's width and, when the block declares
   `maxLines`, shrinks the type until it fits. A client's title is
   unbounded; the space under WEBINAR is not — a 4-line title at
   full size ran 163px into the bio. Shrinking to fit is what a
   designer would do by hand, so the renderer does the same, down
   to a floor of 60% so it can never become unreadably small.

   draw() and collisions() both use this, so what is checked is
   exactly what is drawn.
   ───────────────────────────────────────────────────────────── */
function layoutText(f, value, k) {
  let size = f.size * k;
  let text = String(value);

  const compute = (sz, val) => {
    const lines = [];
    for (const para of String(val).split("\n")) {
      if (f.wrap) lines.push(...wrap(para, sz, f.weight, f.wrap));
      else lines.push(para);
    }
    const widths = lines.map((l) => measure(l, sz, f.weight));
    return { lines, maxW: widths.length ? Math.max(...widths) : 0 };
  };

  let out = compute(size, text);
  const floor = f.size * k * 0.6;

  /* too many lines -> smaller type, down to the floor */
  if (f.maxLines) {
    while (out.lines.length > f.maxLines && size > floor) {
      size = Math.max(floor, size * 0.92);
      out = compute(size, text);
    }
  }

  /* clampLines: shrinking cannot rescue a 150-word bio, so drop whole trailing
     sentences until it fits — what a designer would cut, not a mid-word "…" */
  if (f.clampLines && out.lines.length > f.clampLines) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    while (sentences.length > 1 && out.lines.length > f.clampLines) {
      sentences.pop();
      text = sentences.join(" ");
      out = compute(size, text);
    }
    if (out.lines.length > f.clampLines) {          // one giant sentence
      out.lines = out.lines.slice(0, f.clampLines);
      const last = out.lines[out.lines.length - 1];
      out.lines[out.lines.length - 1] = last.replace(/\s+\S*$/, "") + "\u2026";
      out.maxW = Math.max(...out.lines.map((l) => measure(l, size, f.weight)));
    }
  }

  /* too wide for the space -> smaller type; names and tickers are unbounded
     and the canvas is not */
  if (f.fitWidth && out.maxW > f.fitWidth) {
    size = Math.max(size * (f.fitWidth / out.maxW), f.size * k * 0.45);
    out = compute(size, text);
  }

  return { size, lines: out.lines, maxW: out.maxW };
}


/* ── more than one presenter: side by side ─────────────────────
   One presenter keeps the template's own name/title pair. Two or three are
   laid out as columns — name on top, role beneath, a thin rule between —
   matching the designed Valor Gold tile, instead of stacking everyone into
   one title line where the second name reads as the first person's job.

   Each column is sized to its own content (capped so they all fit), roles wrap
   to at most two lines, and every column shares the SMALLEST size any of them
   needed, so no one presenter looks more important because their name is
   shorter. Beyond three there is no honest room; the rest are reported, not
   squeezed into illegibility.

   draw() and collisions() both call this, so what is checked is what is drawn.
   ───────────────────────────────────────────────────────────── */
export const MAX_PRESENTER_COLUMNS = 3;

export function presenterColumns(layout, fields, k = layout.scale || 1) {
  const nameSpec = layout.text.find((t) => t.key === "presenter_name");
  const titleSpec = layout.text.find((t) => t.key === "presenter_title");
  const all = (fields.presenters || []).filter((p) => p && (p.name || p.title));
  if (!nameSpec || all.length < 2) return null;

  const shown = all.slice(0, MAX_PRESENTER_COLUMNS);
  const cfg = layout.presenterColumns || {};
  let total = cfg.width || nameSpec.fitWidth || 735;
  const up = (v, spec) => (spec && spec.upper ? String(v || "").toUpperCase() : String(v || ""));

  /* ── one shared size, solved rather than taken from the worst column ──
     The first version shrank every column to whatever the longest name needed
     on its own. With three presenters one long name ("DR. LAURENCE (LAURIE)
     CURTIS") pulled everyone down to 12px on the Twitter card — unreadable.

     Instead: at a trial size, each column needs max(name on one line, role
     split as evenly as possible across two lines). Every one of those widths,
     and the gap, scales linearly with the type size, so the largest size at
     which the whole row fits is a single division — no search, no guessing.
     Roles keep the template's own name:role size ratio. */
  const s0 = nameSpec.size * k;
  const ratio = titleSpec ? (titleSpec.size / nameSpec.size) : 1;
  const nameW = (p, sz) => (p.name ? measure(up(p.name, nameSpec), sz, nameSpec.weight) : 0);
  const twoLineW = (p, sz) => {
    if (!p.title || !titleSpec) return 0;
    const words = up(p.title, titleSpec).split(/\s+/).filter(Boolean);
    const w = (arr) => measure(arr.join(" "), sz, titleSpec.weight);
    if (words.length < 2) return w(words);
    let best = Infinity;
    for (let i = 1; i < words.length; i++) best = Math.min(best, Math.max(w(words.slice(0, i)), w(words.slice(i))));
    return best;
  };
  const oneLineW = (p, sz) => (p.title && titleSpec ? measure(up(p.title, titleSpec), sz, titleSpec.weight) : 0);
  const need = (p, sz) => Math.max(nameW(p, sz), twoLineW(p, sz * ratio));
  const rowAt = (sz) => shown.reduce((a, p) => a + need(p, sz), 0) + sz * 2.1 * (shown.length - 1);

  /* Lay the row out at a given size. Spare width goes back to the columns, so
     a short role such as "VP OF EXPLORATION" can sit on one line instead of
     being broken for no reason. */
  const layoutRow = (size) => {
    const gap = size * 2.1;
    let widths = shown.map((p) => need(p, size));
    const spare = total - rowAt(size);
    if (spare > 0) {
      widths = widths.map((w, i) => {
        const want = Math.max(w, nameW(shown[i], size), oneLineW(shown[i], size * ratio));
        return w + Math.max(0, Math.min(want - w, spare / shown.length));
      });
    }
    const cols = [];
    let x = nameSpec.x;
    shown.forEach((p, i) => {
      const colW = widths[i];
      const nSpec = { ...nameSpec, x, size: size / k, fitWidth: colW, wrap: undefined, maxLines: undefined };
      const tSpec = titleSpec && { ...titleSpec, x, size: (size * ratio) / k, wrap: colW, maxLines: 2, fitWidth: colW };
      const name = p.name ? { spec: nSpec, ...layoutText(nSpec, up(p.name, nameSpec), k) } : null;
      const title = p.title && tSpec ? { spec: tSpec, ...layoutText(tSpec, up(p.title, titleSpec), k) } : null;
      const w = Math.max(name ? name.maxW : 0, title ? title.maxW : 0);
      cols.push({ x, w, name, title });
      x += w + gap;
    });
    const right = cols.length ? cols[cols.length - 1].x + cols[cols.length - 1].w : nameSpec.x;
    return { cols, gap, size, right };
  };

  const floor = s0 * 0.55;
  let row = layoutRow(Math.max(floor, Math.min(s0, s0 * (total / rowAt(s0)))));

  /* ── never past the edge ──────────────────────────────────
     Below the 55% floor the analytic size can still overrun: three presenters
     on the narrow YouTube tile ran to x1282 on a 1280 canvas, and three long
     names to x1553. Text off the canvas, or over the website bar, is worse
     than smaller type — so if the row still overruns, it is scaled down to
     the space until it fits, floor or not. */
  for (let pass = 0; pass < 6 && row.right > nameSpec.x + total + 0.5; pass++) {
    row = layoutRow(row.size * (total / (row.right - nameSpec.x)) * 0.98);
  }

  /* ── keep clear of something below the row (LinkedIn's logo) ──
     `avoid: { x, y }` marks the region right of x and below y as taken. The
     old answer was a narrow column area everywhere, which shrank two
     presenters to 24px on LinkedIn beside ~450px of empty space. Instead use
     the full width, and only if the row then reaches into the region, shrink
     it until it clears — wider space lets short roles sit on one line, which
     is itself what lifts the bottom edge. Only if that fails does it fall back
     to stopping short of the region horizontally. Whichever gives the larger
     type wins. */
  const rowBottom = (rw) => Math.max(...rw.cols.map((c) => Math.max(
    c.name ? c.name.spec.y + c.name.size * 1.2 + Math.max(0, c.name.lines.length - 1) * c.name.size * (c.name.spec.lineHeight || 1.4) : 0,
    c.title ? c.title.spec.y + c.title.size * 1.2 + Math.max(0, c.title.lines.length - 1) * c.title.size * (c.title.spec.lineHeight || 1.4) : 0)));
  const intrudes = (rw) => cfg.avoid && rw.right > cfg.avoid.x && rowBottom(rw) > cfg.avoid.y;
  if (intrudes(row)) {
    let wide = row;
    for (let pass = 0; pass < 30 && intrudes(wide) && wide.size > floor * 0.8; pass++) wide = layoutRow(wide.size * 0.96);
    total = Math.max(0, cfg.avoid.x - nameSpec.x - nameSpec.size * k * 0.6);
    let narrow = layoutRow(Math.max(floor, Math.min(s0, s0 * (total / rowAt(s0)))));
    for (let pass = 0; pass < 6 && narrow.right > nameSpec.x + total + 0.5; pass++) {
      narrow = layoutRow(narrow.size * (total / (narrow.right - nameSpec.x)) * 0.98);
    }
    row = !intrudes(wide) && wide.size >= narrow.size ? wide : narrow;
  }
  const cols = row.cols, gap = row.gap, nameSize = row.size;

  const blockBottom = (b) => b.spec.y + b.size * 1.2 + Math.max(0, b.lines.length - 1) * b.size * (b.spec.lineHeight || 1.4);
  const bottom = Math.max(...cols.map((c) => Math.max(c.name ? blockBottom(c.name) : 0, c.title ? blockBottom(c.title) : 0)));
  const dividers = cols.slice(0, -1).map((c) => ({ x: c.x + c.w + gap / 2, y1: nameSpec.y + nameSize * 0.1, y2: bottom }));

  return {
    cols, dividers, bottom,
    stroke: Math.max(2, nameSize * 0.075),
    colour: cfg.divider || "#852A29",
    omitted: all.length - shown.length,
  };
}

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* PNG or JPEG — resvg reads the magic bytes, but the URI must not lie */
const imgUri = (buf) => {
  const jpeg = buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
  return `data:image/${jpeg ? "jpeg" : "png"};base64,` + buf.toString("base64");
};
const pngUri = imgUri;

/**
 * Draw one graphic.
 *   layout  the template's spec (see layouts.mjs)
 *   fields  { key: string } values
 *   opts    { dotColour, logo: { buffer, width, height } }
 */
export async function draw(layout, fields, opts = {}) {
  const k = layout.scale || 1;
  const plate = PLATES[layout.plate];
  if (!plate) throw new Error(`missing plate ${layout.plate}`);

  const parts = [
    `<image x="0" y="0" width="${layout.width}" height="${layout.height}" ` +
    `href="data:image/jpeg;base64,${plate}" preserveAspectRatio="none"/>`,
  ];

  if (layout.dot && opts.dotColour) {
    let cx = layout.dot.cx;
    /* a fixed dot position assumes a short commodity; "COPPER AND GOLD" walked
       straight over it. Attached, the dot is placed off the measured text. */
    if (layout.dot.attach) {
      const cf = layout.text.find((x) => x.key === "commodity");
      const cv = fields.commodity;
      if (cf && cv) {
        const m = layoutText(cf, cf.upper ? String(cv).toUpperCase() : cv, k);
        const startX = cf.anchor === "end" ? cf.x - m.maxW
          : cf.anchor === "middle" ? cf.x - m.maxW / 2 : cf.x;
        const gap = layout.dot.r * 1.4;
        cx = layout.dot.attach === "before" ? startX - gap - layout.dot.r
                                            : startX + m.maxW + gap + layout.dot.r;
      }
    }
    parts.push(`<circle cx="${cx}" cy="${layout.dot.cy}" r="${layout.dot.r}" fill="${opts.dotColour}"/>`);
  }

  if (layout.logo && opts.logo?.buffer) {
    const { width: lw, height: lh } = opts.logo;

    /* ── how much of the FILE is actually the mark ────────────
       Client logos arrive with wildly different amounts of empty space baked
       around them. Fitting the file to the slot therefore draws one company's
       mark half the size of another's, through no fault of either. On the
       templates where the logo is one element among many that goes unnoticed;
       on a template whose only element IS the logo it is the whole design.

       Templates that ask for it (logo.trim) are fitted to the mark instead of
       to the file: the ink is measured, and the file is scaled and offset so
       that the ink — not the padding — lands in the slot. Every other template
       keeps its existing arithmetic exactly, because with no trim the
       fractions below are 0,0,1,1 and this reduces to what it was. */
    let ix = 0, iy = 0, ifw = 1, ifh = 1;
    if (layout.logo.trim) {
      const ink = opts.logo.ink || await inkBox(opts.logo.buffer, { hasAlpha: opts.logo.hasAlpha });
      if (ink) { ix = ink.x0; iy = ink.y0; ifw = ink.x1 - ink.x0; ifh = ink.y1 - ink.y0; }
    }
    const mw = lw * ifw, mh = lh * ifh;             // the mark's own pixel size
    const scale = Math.min(layout.logo.w / mw, layout.logo.h / mh);
    const w = mw * scale, h = mh * scale;           // the mark, as drawn
    const fw = lw * scale, fh = lh * scale;         // the whole file, as drawn
    const lox = layout.logo.x + (layout.logo.w - w) / 2;   // where the mark starts
    const loy = layout.logo.y + (layout.logo.h - h) / 2;

    /* A logo with no alpha channel has a solid background baked in — almost
       always white — and stamping that onto the artwork puts a white slab
       behind the mark. This drops near-white pixels to transparent.

       It runs ONLY when the file has no alpha of its own, so a properly
       prepared transparent logo is never touched, and a reversed white-on-dark
       mark is never destroyed (those arrive as transparent PNGs).

       luminanceToAlpha gives a mask of how light each pixel is; the discrete
       table turns the top ~8% into zero alpha and leaves everything else fully
       opaque, so it is a threshold rather than a fade. */
    const knockout = opts.logo.hasAlpha === false;
    /* How the mark is being helped to stand out — see fitLogoToSlot.
         reverse : recolour to a flat white (or dark) silhouette
         plate   : leave the colours alone, put a panel behind it */
    const mode = opts.logo.mode || (opts.logo.invert === true ? "reverse" : "none");
    const reverse = mode === "reverse";
    const plate = mode === "plate";
    const toWhite = opts.logo.toWhite !== false;

    /* ── the panel goes down BEFORE the mark ──────────────────
       A rounded rectangle a little larger than the logo, in the tone the
       backdrop is not. This is the only fix for a coloured logo that has no
       contrast where it lands: recolouring it would misstate the brand. */
    if (plate) {
      const pad = Math.round(Math.min(layout.logo.w, layout.logo.h) * 0.12);
      const px0 = lox - pad;
      const py0 = loy - pad;
      /* ALWAYS light, never a black panel.

         It used to go dark whenever the artwork under the slot was light,
         which put a black slab in the middle of the light band on LinkedIn and
         the replay tiles — heavy, and nothing else in the brand looks like it.
         A light panel on light artwork adds no tonal contrast on its own, so a
         hairline edge delimits the mark instead. */
      parts.push(
        `<rect x="${px0}" y="${py0}" width="${w + pad * 2}" height="${h + pad * 2}" ` +
        `rx="${Math.round(pad * 0.9)}" fill="#ffffff" fill-opacity="0.95" ` +
        `stroke="rgba(36,30,31,0.16)" stroke-width="${Math.max(1, Math.round(pad * 0.09))}"/>`,
      );
    }

    if (knockout || reverse) {
      /* ORDER MATTERS: knock the background out FIRST, then invert what is left.

         Inverting first turns a white background black, and the luminance
         knockout then removes the now-light artwork instead of the now-dark
         background — which put the logo in a solid black box. */
      const steps = [];
      let source = "SourceGraphic";

      if (knockout) {
        steps.push(
          `<feColorMatrix type="luminanceToAlpha" in="SourceGraphic" result="lum"/>`,
          `<feComponentTransfer in="lum" result="mask"><feFuncA type="discrete" ` +
          `tableValues="1 1 1 1 1 1 1 1 1 1 1 1 0"/></feComponentTransfer>`,
          `<feComposite in="SourceGraphic" in2="mask" operator="in" result="cut"/>`,
        );
        source = "cut";
      }

      if (reverse) {
        /* Force RGB to a flat tone and keep alpha, so the result is the logo's
           exact silhouette in white (or near-black).

           This is NOT an RGB inversion. Inverting flips hue as well as tone,
           so a navy-and-gold mark came back pale yellow and blue — visible,
           but no longer the client's logo. Only marks measured as effectively
           one colour reach this path, and a one-colour mark reversed to white
           is what a brand guide would ask for. */
        const v = toWhite ? 1 : 0.07;
        steps.push(
          `<feColorMatrix type="matrix" in="${source}" ` +
          `values="0 0 0 0 ${v}  0 0 0 0 ${v}  0 0 0 0 ${v}  0 0 0 1 0"/>`,
        );
      }

      parts.push(`<filter id="logoFix" color-interpolation-filters="sRGB">${steps.join("")}</filter>`);
    }

    parts.push(
      `<image x="${lox - ix * fw}" y="${loy - iy * fh}" ` +
      `width="${fw}" height="${fh}"${knockout || reverse ? ' filter="url(#logoFix)"' : ""} href="${pngUri(opts.logo.buffer)}"/>`,
    );
  }

  if (layout.headshot && opts.headshot?.buffer) {
    /* same luminance knockout as the logo, applied only when the photo was
       measured as having a plain light backdrop */
    if (opts.headshot.cutOut) {
      parts.push(
        `<filter id="shotFix" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="luminanceToAlpha" result="lum"/>` +
        `<feComponentTransfer in="lum" result="mask"><feFuncA type="discrete" ` +
        `tableValues="1 1 1 1 1 1 1 1 1 1 1 0"/></feComponentTransfer>` +
        `<feComposite in="SourceGraphic" in2="mask" operator="in"/>` +
        `</filter>`,
      );
    }
    const H = layout.headshot;
    const { width: iw, height: ih } = opts.headshot;
    const cut = opts.headshot.cutOut === true;

    if (cut) {
      /* A cut-out person is not a photo panel: fit the whole figure inside the
         slot and stand it on the bottom edge, so they meet the artwork rather
         than being cropped mid-shoulder. */
      const scale = Math.min(H.w / iw, H.h / ih);
      const w = iw * scale, h = ih * scale;
      parts.push(
        `<image x="${H.x + (H.w - w) / 2}" y="${H.y + (H.h - h)}" width="${w}" height="${h}" ` +
        `filter="url(#shotFix)" href="${pngUri(opts.headshot.buffer)}"/>`,
      );
    } else {
      /* ── the photo keeps its background: frame it deliberately ──
         Some photographs cannot be separated from their backdrop by any
         amount of arithmetic. Jason Barnard's is the clear case: his white
         shirt meets a white wall with no colour difference and no measurable
         seam between them, so there is nothing for an algorithm to find
         short of knowing what a person is.

         Left as a bare rectangle it reads as a cut-out that went wrong. In a
         circle it reads as a portrait, which is how a headshot is normally
         presented on a branded tile — and it works for every photo, whatever
         its background.

         The circle is clamped inside the canvas because this slot starts
         off-canvas to the left, where a centred circle would be clipped. */
      const d = Math.min(H.w, H.h) * 0.94;
      const cx = Math.min(Math.max(H.x + H.w / 2, d / 2 + 18), layout.width - d / 2 - 18);
      const cy = H.y + H.h / 2;

      const scale = Math.max(d / iw, d / ih);
      const w = iw * scale, h = ih * scale;
      parts.push(
        `<clipPath id="hs"><circle cx="${cx}" cy="${cy}" r="${d / 2}"/></clipPath>` +
        `<g clip-path="url(#hs)"><image x="${cx - w / 2}" y="${cy - h / 2}" ` +
        `width="${w}" height="${h}" href="${pngUri(opts.headshot.buffer)}"/></g>` +
        /* a hairline ring separates a light photo from light artwork */
        `<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="none" ` +
        `stroke="rgba(36,30,31,0.14)" stroke-width="${Math.max(2, d * 0.006)}"/>`,
      );
    }
  }


  const columns = presenterColumns(layout, fields, k);
  const emit = (spec, size, lines) => {
    const lineHeight = size * (spec.lineHeight || 1.4);
    lines.forEach((line, i) => {
      const y = spec.y + size * 0.78 + i * lineHeight;
      parts.push(
        `<text x="${spec.x}" y="${y}" font-family="Montserrat${spec.weight}" font-size="${size}" ` +
        `fill="${spec.fill}"${spec.anchor ? ` text-anchor="${spec.anchor}"` : ""}` +
        `${spec.spacing ? ` letter-spacing="${spec.spacing}"` : ""}>${esc(line)}</text>`,
      );
    });
  };
  if (columns) {
    for (const c of columns.cols) {
      if (c.name) emit(c.name.spec, c.name.size, c.name.lines);
      if (c.title) emit(c.title.spec, c.title.size, c.title.lines);
    }
    for (const d of columns.dividers) {
      parts.push(`<line x1="${d.x}" y1="${d.y1}" x2="${d.x}" y2="${d.y2}" ` +
                 `stroke="${columns.colour}" stroke-width="${columns.stroke}"/>`);
    }
  }

  for (const f of layout.text) {
    if (columns && (f.key === "presenter_name" || f.key === "presenter_title")) continue;
    /* Some slots are drawn INTO baked artwork — the replay thumbnails have a
       white chip painted on the plate. Leaving it empty looks like a fault, and
       the chip cannot be removed, so the field names what to put there instead. */
    let value = fields[f.key] || (f.fallback ? fields[f.fallback] : "");
    if (value == null || value === "") continue;
    value = String(value);
    if (f.upper) value = value.toUpperCase();

    const { size, lines } = layoutText(f, value, k);
    const lineHeight = size * (f.lineHeight || 1.4);
    lines.forEach((line, i) => {
      /* Canva positions a text box by its top edge; SVG draws from the
         baseline, so drop by the cap-height-ish 0.78em to line them up */
      const y = f.y + size * 0.78 + i * lineHeight;
      parts.push(
        `<text x="${f.x}" y="${y}" font-family="Montserrat${f.weight}" font-size="${size}" ` +
        `fill="${f.fill}"${f.anchor ? ` text-anchor="${f.anchor}"` : ""}` +
        `${f.spacing ? ` letter-spacing="${f.spacing}"` : ""}>${esc(line)}</text>`,
      );
    });
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" ` +
    `viewBox="0 0 ${layout.width} ${layout.height}">${parts.join("")}</svg>`;

  const Resvg = await resvg();
  return new Resvg(svg, {
    font: {
      fontFiles: ensureFonts(),
      loadSystemFonts: false,
      defaultFontFamily: "Montserrat600",
    },
    /* Templates are drawn at their Canva size. An email needs the same
       artwork a few hundred pixels wide instead of 2500 — rendered at that
       size rather than scaled down afterwards, so the type stays sharp. */
    fitTo: opts.width ? { mode: "width", value: Math.round(opts.width) } : { mode: "original" },
  }).render().asPng();
}

/* ── layout safety ─────────────────────────────────────────────
   Type is positioned absolutely, so making it bigger can push one
   block into the one below without any error being raised. This
   reports where that would happen, given real text, so a scale
   change can be checked rather than eyeballed.
   ───────────────────────────────────────────────────────────── */
export function collisions(layout, fields) {
  const k = layout.scale || 1;
  const blocks = [];

  const columns = presenterColumns(layout, fields, k);
  if (columns) {
    for (const c of columns.cols) {
      for (const [label, b] of [["name", c.name], ["title", c.title]]) {
        if (!b) continue;
        const height = b.size * 1.2 + Math.max(0, b.lines.length - 1) * b.size * (b.spec.lineHeight || 1.4);
        blocks.push({ key: `presenter ${label} @${Math.round(c.x)}`, left: c.x, right: c.x + b.maxW,
                      top: b.spec.y, bottom: b.spec.y + height, lines: b.lines.length });
      }
    }
  }

  for (const f of layout.text) {
    if (columns && (f.key === "presenter_name" || f.key === "presenter_title")) continue;
    const value = fields[f.key] || (f.fallback ? fields[f.fallback] : "");
    if (value == null || value === "") continue;
    /* the SAME layout the renderer uses — autofit included — so what is
       checked is exactly what is drawn */
    const { size, lines, maxW } = layoutText(f, value, k);
    /* One line occupies roughly its ascender-to-descender box (~1.2em), not a
       full line-height — line-height only opens up space BETWEEN lines. */
    const height = size * 1.2 + Math.max(0, lines.length - 1) * size * (f.lineHeight || 1.4);
    const left = f.anchor === "end" ? f.x - maxW : f.anchor === "middle" ? f.x - maxW / 2 : f.x;
    blocks.push({ key: f.key, left, right: left + maxW, top: f.y, bottom: f.y + height, lines: lines.length });
  }

  blocks.sort((a, b) => a.top - b.top);
  const clashes = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      /* blocks collide only when they overlap in BOTH axes — the old left-edge
         test let a full-width bio sail into the date badge unreported */
      const horiz = a.left < b.right && b.left < a.right;
      if (horiz && a.bottom > b.top && b.bottom > a.top) {
        clashes.push(`${a.key} (${a.lines} lines) overruns ${b.key} by ${Math.round(a.bottom - b.top)}px`);
      }
    }
  }
  const last = blocks[blocks.length - 1];
  if (last && last.bottom > layout.height) {
    clashes.push(`${last.key} runs ${Math.round(last.bottom - layout.height)}px past the bottom edge`);
  }
  return clashes;
}

/* ── is this a reversed (white) logo? ──────────────────────────
   Companies keep two marks: the normal one, and a white "reversed"
   version for dark backgrounds. Every logo slot in these templates
   sits on something light — the invites put it on a white band —
   so a reversed logo is invisible there, and nothing about the
   file says which kind it is.

   This renders the logo small, exactly as the real graphic would
   including the white knockout, then measures the pixels that
   survive. A mark whose visible pixels are nearly all near-white
   is the reversed one.
   ───────────────────────────────────────────────────────────── */
/* ── where the mark sits inside its own file ──────────────────
   Returns the mark's bounding box as fractions of the file (0..1), or null if
   the file is edge-to-edge artwork with nothing to trim. Rendered with
   preserveAspectRatio="none" into a square so a pixel column maps straight
   onto a fraction of the width, which is all this needs; the distortion never
   reaches the graphic.

   A file with no alpha gets the same white knockout the real draw applies, so
   the box is measured around what will actually be visible rather than around
   the white rectangle behind it. */
export async function inkBox(buffer, { hasAlpha } = {}) {
  const Resvg = await resvg();
  const N = 200;
  const knockout = hasAlpha === false;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" viewBox="0 0 ${N} ${N}">` +
    (knockout
      ? `<filter id="k" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="luminanceToAlpha" result="lum"/>` +
        `<feComponentTransfer in="lum" result="mask"><feFuncA type="discrete" ` +
        `tableValues="1 1 1 1 1 1 1 1 1 1 1 1 0"/></feComponentTransfer>` +
        `<feComposite in="SourceGraphic" in2="mask" operator="in"/></filter>`
      : "") +
    `<image x="0" y="0" width="${N}" height="${N}" preserveAspectRatio="none"` +
    `${knockout ? ' filter="url(#k)"' : ""} href="${imgUri(buffer)}"/></svg>`;

  const px = new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels;

  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (px[(y * N + x) * 4 + 3] < 40) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null;            // nothing visible — leave it alone

  const box = { x0: x0 / N, y0: y0 / N, x1: (x1 + 1) / N, y1: (y1 + 1) / N };
  /* barely any padding: not worth the extra arithmetic, and a one-pixel
     measurement error would then be the only thing moving the mark */
  if (box.x1 - box.x0 > 0.98 && box.y1 - box.y0 > 0.98) return null;
  return box;
}

export async function analyseLogo(buffer, { hasAlpha } = {}) {
  const Resvg = await resvg();
  const knockout = hasAlpha === false;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    (knockout
      ? `<filter id="k" color-interpolation-filters="sRGB">` +
        `<feColorMatrix type="luminanceToAlpha" result="lum"/>` +
        `<feComponentTransfer in="lum" result="mask"><feFuncA type="discrete" ` +
        `tableValues="1 1 1 1 1 1 1 1 1 1 1 1 0"/></feComponentTransfer>` +
        `<feComposite in="SourceGraphic" in2="mask" operator="in"/></filter>`
      : "") +
    `<image x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet"` +
    `${knockout ? ' filter="url(#k)"' : ""} href="${imgUri(buffer)}"/></svg>`;

  const px = new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels;

  let visible = 0, light = 0, lumSum = 0, chromaSum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a < 40) continue;                       // effectively transparent
    visible++;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lumSum += lum;
    if (lum > 0.82) light++;
    /* how far this pixel is from grey. A black, white or grey mark scores ~0;
       anything with brand colour in it scores well above. */
    chromaSum += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  }

  if (!visible) return { blank: true, reversed: false, coverage: 0, meanLuminance: 0, chroma: 0, monochrome: true };

  const meanLuminance = lumSum / visible;
  const chroma = chromaSum / visible;
  return {
    blank: false,
    coverage: visible / (px.length / 4),
    meanLuminance,
    chroma,
    /* A one-colour mark can be recoloured wholesale without lying about the
       brand — reversing a black wordmark to white is normal practice. A mark
       with real colour in it cannot, so it gets a panel instead. */
    monochrome: chroma < 0.10,
    /* mostly light pixels AND a light average — a colour mark with some white
       in it fails the second test */
    reversed: light / visible > 0.7 && meanLuminance > 0.8,
  };
}

/* ── can this photo's background be removed? ───────────────────
   The YouTube replay tile wants the presenter cut out and standing
   on its textured background, so a headshot arriving as a plain
   rectangle looks wrong.

   True cut-out of an arbitrary photo needs ML segmentation, which
   is not available inside a Netlify function. What IS reliable is
   the common case: a corporate headshot shot against a plain
   studio backdrop. This samples the border of the image — where
   the background is, whatever the subject — and reports whether
   it is uniform and light enough to knock out cleanly.

   A busy or dark background returns removable:false, and the
   caller draws the photo as supplied and says so on the record
   rather than mangling it.
   ───────────────────────────────────────────────────────────── */
export async function analysePhoto(buffer) {
  const Resvg = await resvg();
  const N = 64;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" viewBox="0 0 ${N} ${N}">` +
    `<image x="0" y="0" width="${N}" height="${N}" preserveAspectRatio="none" href="${imgUri(buffer)}"/></svg>`;
  const px = new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels;

  const at = (x, y) => {
    const i = (y * N + x) * 4;
    return { r: px[i], g: px[i + 1], b: px[i + 2], a: px[i + 3] };
  };

  /* Sample the TOP and the UPPER SIDES only.

     Sampling the whole border looked obvious and was wrong: a normally framed
     portrait has the subject's shoulders running off the bottom edge, so the
     bottom rows are the person, not the backdrop. Including them pushed the
     variance of a clean studio shot to 0.045 and every photo was judged
     unremovable. */
  const edge = [];
  for (let x = 0; x < N; x++) for (const y of [0, 1, 2]) edge.push(at(x, y));
  const sideDepth = Math.floor(N * 0.6);                 // top 60% of the height
  for (let y = 3; y < sideDepth; y++) for (const x of [0, 1, N - 2, N - 1]) edge.push(at(x, y));

  const opaque = edge.filter((p) => p.a > 40);
  /* every field is always present, so a caller reading .variance on the
     already-cut-out path does not fall over */
  if (!opaque.length) {
    return { alreadyCutOut: true, removable: false, meanLuminance: 0, variance: 0 };
  }

  const lum = (p) => (0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b) / 255;
  const lums = opaque.map(lum);
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const variance = lums.reduce((a, l) => a + (l - mean) ** 2, 0) / lums.length;

  /* transparent border already => somebody cut it out for us */
  const transparentEdge = 1 - opaque.length / edge.length;

  return {
    alreadyCutOut: transparentEdge > 0.4,
    meanLuminance: mean,
    variance,
    /* uniform (low spread) and light enough that a luminance knockout will
       take the backdrop and leave the face */
    removable: variance < 0.010 && mean > 0.72,
  };
}

/* Decode any image resvg can read into raw RGBA at its own size. */
export async function decodeImage(buffer, width, height) {
  const Resvg = await resvg();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<image x="0" y="0" width="${width}" height="${height}" href="${imgUri(buffer)}"/></svg>`;
  const r = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  return { pixels: Buffer.from(r.pixels), width: r.width, height: r.height };
}

/**
 * Remove a photo's background properly, whatever colour it is.
 * Returns a new PNG plus what it did, or null when the result is not credible.
 */
export async function removeBackground(buffer, width, height) {
  /* work at a sane size — a 4000px portrait is 16M pixels of flood fill for no
     visual gain at the size these slots render */
  const cap = 900;
  const scale = Math.min(1, cap / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const { pixels } = await decodeImage(buffer, w, h);

  /* already transparent at the edges? nothing to do */
  let opaqueEdge = 0, edge = 0;
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { edge++; if (pixels[(y * w + x) * 4 + 3] > 40) opaqueEdge++; }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { edge++; if (pixels[(y * w + x) * 4 + 3] > 40) opaqueEdge++; }
  if (opaqueEdge / edge < 0.5) return { alreadyCutOut: true, buffer, width, height };

  /* try increasing tolerance until the border clears; stop before it eats the subject */
  /* Gentlest first, in small steps. The first tolerance that produces a
     credible cut wins, so a backdrop that separates easily is never cut harder
     than it needs to be. */
  /* Take the BEST plausible cut, not the first.

     Stopping at the first acceptable result meant settling for whatever the
     gentlest tolerance managed — 4.7% on Jason Barnard's photo, a sliver off
     the edges while the backdrop stayed. Every tolerance is tried and the one
     that removes the most while still passing the border and torso checks
     wins, so a cautious early pass no longer caps the result. */
  let best = null;
  /* Insets step past a drawn border, matte or letterbox bar; without one the
     fill stops at the frame line and clears only the band outside it.

     Take the GENTLEST cut that genuinely separates the subject — no inset
     before an inset, low tolerance before high — not the largest. Taking the
     largest was a regression: more removal is exactly what a cut that has
     broken into the person looks like. Measured on synthetic portraits it
     chose an 18px inset that shaved 11% off the suit and collar, and on a
     navy suit against a blue wall deleted 98.7% of the suit while still
     passing — and it is what tore Jordan Trimble's shoulder. The gentlest
     acceptable cut removed the same 98.6% of the backdrop and kept the
     person whole. */
  const insets = [...new Set([0, Math.round(Math.min(w, h) * 0.012), Math.round(Math.min(w, h) * 0.03)])];
  search:
  for (const inset of insets) {
    for (const tolerance of [0.05, 0.09, 0.14, 0.20, 0.26]) {
      const r = floodCutOut(pixels, w, h, { tolerance, inset });
      if (r.plausible && r.removed >= 0.15) { best = { r, tolerance, inset }; break search; }
    }
  }
  /* A cut that took almost nothing is not a cut-out.

     Jason Barnard's photo cleared 5.2% — the decorative border around it —
     and passed every safety check, because nothing had been damaged. But
     nothing had been separated either, so the tile showed a rectangle with
     his background intact, which reads as a cut-out that went wrong.

     Below a real separation we hand the photo back untouched and it is framed
     as a portrait instead. Better a deliberate frame than a token cut. */
  if (best && best.r.removed < 0.15) best = null;
  /* A torn silhouette is declined like a token cut: the photo is framed as a
     circular portrait rather than shipped with shards along the shoulders. */
  if (best && shardLoss(best.r.pixels, w, h) > SHARD_LIMIT) best = null;

  if (best) {
    return {
      buffer: encodePng(best.r.pixels, w, h),
      width: w, height: h,
      removed: best.r.removed, tolerance: best.tolerance,
      alreadyCutOut: false,
    };
  }
  return null;                 // not a background we can take away safely
}

/* Overall lightness of a template's plate.

   Red Cloud's templates come in a dark and a light variant and only the light
   one is used. This measures the artwork so a wrong re-export is caught by
   check() instead of reaching a client. Cached — plates never change at run time. */
const plateCache = new Map();

export async function plateLuminance(layout) {
  if (plateCache.has(layout.plate)) return plateCache.get(layout.plate);
  const Resvg = await resvg();
  const N = 72;
  const px = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" viewBox="0 0 ${layout.width} ${layout.height}">` +
    `<image x="0" y="0" width="${layout.width}" height="${layout.height}" preserveAspectRatio="none" ` +
    `href="data:image/jpeg;base64,${PLATES[layout.plate]}"/></svg>`,
    { font: { loadSystemFonts: false } },
  ).render().pixels;
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    n++;
  }
  const lum = sum / n;
  plateCache.set(layout.plate, lum);
  return lum;
}

/* ── how dark is the artwork under a slot? ─────────────────────
   A logo slot is not always on the same shade: the invites put it
   on a white band, the replay tiles on a light texture, and a
   future template might use a dark panel. Rather than assume, the
   plate is rendered and the pixels under the slot are measured.

   Cached per template — the plates never change at runtime.
   ───────────────────────────────────────────────────────────── */
const slotCache = new Map();

export async function slotLuminance(layout, slot) {
  const key = `${layout.plate}:${slot.x},${slot.y},${slot.w},${slot.h}`;
  if (slotCache.has(key)) return slotCache.get(key);

  const Resvg = await resvg();
  const N = 48;
  /* render only the slot's region of the plate */
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" ` +
    `viewBox="${slot.x} ${slot.y} ${slot.w} ${slot.h}">` +
    `<image x="0" y="0" width="${layout.width}" height="${layout.height}" ` +
    `href="data:image/jpeg;base64,${PLATES[layout.plate]}" preserveAspectRatio="none"/></svg>`;
  const px = new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels;

  let sum = 0, count = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 40) continue;
    sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    count++;
  }
  const lum = count ? sum / count : 1;
  slotCache.set(key, lum);
  return lum;
}

/**
 * Decide how a logo should be treated so it is actually visible where it lands.
 * Returns { invert, reason } — invert flips the mark's tone.
 */
export async function fitLogoToSlot(layout, logoLook) {
  if (!layout.logo) return { mode: "none", invert: false, reason: null };
  const bg = await slotLuminance(layout, layout.logo);
  const fg = logoLook?.meanLuminance ?? 0.3;

  /* Contrast here is the gap in tone between mark and backdrop. Below about a
     quarter they merge — a black logo on a dark photo, or a white one on a
     white band — and the mark has to be helped. */
  const contrast = Math.abs(bg - fg);
  if (contrast >= 0.25) return { mode: "none", invert: false, reason: null };

  const toWhite = bg < 0.5;              // dark backdrop wants a light mark

  /* A one-colour mark is recoloured to a flat silhouette. This replaced an RGB
     inversion, which flipped HUE as well as tone: a navy-and-gold logo came
     back pale yellow and blue — legible, and not the client's brand. Forcing
     the fill instead keeps the shape exactly and touches nothing else. */
  if (logoLook?.monochrome !== false) {
    return {
      mode: "reverse",
      invert: true,                       // kept so older callers still work
      toWhite,
      reason: toWhite
        ? "the logo was too dark for this template's backdrop, so it has been reversed to white"
        : "the logo was too light for this template's backdrop, so it has been reversed to dark",
    };
  }

  /* A logo with real colour in it cannot be recoloured without misrepresenting
     the brand, so the backdrop moves instead: the mark sits on its own panel,
     which is what most brand guidelines ask for anyway. */
  return {
    mode: "plate",
    invert: false,
    toWhite,
    reason: "the logo has too little contrast here and its colours cannot be changed, " +
            "so it has been placed on a light panel",
  };
}

/** Render an arbitrary SVG with the embedded Montserrat weights (family names
   "Montserrat500" … "Montserrat800"), optionally at a target width. */
export async function renderSvg(svg, { width } = {}) {
  const Resvg = await resvg();
  return new Resvg(svg, {
    font: { fontFiles: ensureFonts(), loadSystemFonts: false, defaultFontFamily: "Montserrat600" },
    fitTo: width ? { mode: "width", value: Math.round(width) } : { mode: "original" },
  }).render().asPng();
}
