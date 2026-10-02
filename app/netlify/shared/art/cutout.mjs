import zlib from "node:zlib";

/* ─────────────────────────────────────────────────────────────
   Removing a photo's background.

   The earlier approach thresholded on luminance, which only ever
   worked for near-white backdrops. This floods inward from the
   edges instead, clearing any pixel close in colour to its
   neighbours — so a grey, blue or green backdrop goes too, and a
   dark suit against a light wall is kept rather than eaten.

   It is a magic-wand, not segmentation: it cannot cut a person
   out of an office or a landscape, and it says so by reporting
   how much it removed and whether the result looks plausible.
   Anything doubtful is handed back untouched for a human.
   ───────────────────────────────────────────────────────────── */

/* ── a minimal PNG writer, so the cut-out can go back to the renderer ── */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(rgba, width, height) {
  /* accept a Buffer or any typed array — the renderer hands back both */
  if (typeof rgba.copy !== "function") rgba = Buffer.from(rgba.buffer || rgba);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}


/* ── separating a person from their backdrop ───────────────────
   The naive version — flood fill outwards while the colour stays close to the
   border colour — fails on the commonest studio headshot there is: a white
   shirt against a white wall. The collar and the wall are the same colour and
   touch each other, so the fill walks straight through the collar and eats the
   shoulder. That is exactly what happened to Jason Barnard's photo: a bite out
   of the collar, a notch in the hair, and the backdrop still sitting there.

   Three things fix it, and all three matter:

     1. The fill is not allowed to cross an EDGE. There is almost always a
        faint shadow or outline where a shirt meets a wall, even when the two
        are the same colour. Blocking the fill at any strong local gradient
        stops the leak at that boundary while still letting it flow across a
        smooth backdrop.

     2. The backdrop is modelled as a SET of sampled colours rather than one
        median, so a gradient or vignette is matched along its whole range
        instead of only near its middle.

     3. The subject mask is CLOSED afterwards — dilated then eroded — which
        heals any narrow channel the fill still managed to squeeze through
        without altering the real silhouette.
   ───────────────────────────────────────────────────────────── */

const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/* Perceptual-ish distance: luminance carries most of the weight, but a real
   hue difference still separates a warm skin tone from a cool grey wall at the
   same brightness. */
function colourDist(r1, g1, b1, r2, g2, b2) {
  const dl = lum(r1, g1, b1) - lum(r2, g2, b2);
  const dr = (r1 - r2) / 255, dg = (g1 - g2) / 255, db = (b1 - b2) / 255;
  const chroma = Math.sqrt((dr * dr + dg * dg + db * db) / 3);
  return Math.sqrt(dl * dl * 2 + chroma * chroma) / Math.SQRT2;
}

/**
 * Remove a portrait's background.
 * Returns { pixels, removed, edgeCleared, plausible }.
 */
export function floodCutOut(rgba, width, height, { tolerance = 0.09, feather = true, edgeFactor = 1.6, inset = 0 } = {}) {
  const n = width * height;
  /* a Buffer, not a typed array — encodePng writes it with .copy() */
  const out = Buffer.from(rgba);
  const at = (i) => i * 4;

  /* ── 1. the backdrop, sampled from the top and upper sides ──
     Not the bottom: a normally framed portrait has shoulders running off it,
     so those rows are the person. */
  const samples = [];
  const sideDepth = Math.floor(height * 0.6);
  for (let x = inset; x < width - inset; x += 2) {
    for (const y of [inset, inset + 1, inset + 2]) samples.push((y * width + x) * 4);
  }
  for (let y = inset + 3; y < sideDepth; y += 2) {
    for (const x of [inset, inset + 1, width - 2 - inset, width - 1 - inset]) {
      if (x >= 0 && x < width) samples.push((y * width + x) * 4);
    }
  }
  /* thin to a manageable palette — every sample would be O(n·samples) */
  const palette = [];
  for (const o of samples) {
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    if (!palette.some((p) => colourDist(r, g, b, p[0], p[1], p[2]) < 0.035)) {
      palette.push([r, g, b]);
      if (palette.length >= 24) break;
    }
  }
  if (!palette.length) return { pixels: out, removed: 0, edgeCleared: 0, plausible: false };

  const nearBackdrop = (o, tol) => {
    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
    for (const p of palette) if (colourDist(r, g, b, p[0], p[1], p[2]) <= tol) return true;
    return false;
  };

  /* ── 2. where are the edges? ──────────────────────────────
     Local luminance gradient. A shirt against a wall of the same colour still
     has a seam; this is what the fill must not cross. */
  const grad = new Float32Array(n);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = lum(rgba[at(i)], rgba[at(i) + 1], rgba[at(i) + 2]);
      let m = 0;
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        m = Math.max(m, Math.abs(l - lum(rgba[at(j)], rgba[at(j) + 1], rgba[at(j) + 2])));
      }
      grad[i] = m;
    }
  }
  /* a seam is relative to how contrasty the picture is, so scale the threshold
     off the backdrop's own noise rather than fixing it */
  /* A fixed 0.055 was a guess, and on a textured backdrop it sits BELOW the
     backdrop's own grain — so the fill was blocked everywhere and cleared a
     sliver. Take the threshold from the picture instead: sample gradients in
     the border band (which is backdrop by definition) and put the cut-off
     above almost all of them. Ordinary grain then passes; a real seam, which
     is far stronger than grain, still blocks. */
  const band = [];
  for (let y = 0; y < Math.min(6, height); y++) {
    for (let x = 1; x < width - 1; x += 2) band.push(grad[y * width + x]);
  }
  for (let y = 6; y < sideDepth; y += 2) {
    for (const x of [1, 2, width - 3, width - 2]) band.push(grad[y * width + x]);
  }
  band.sort((a, b) => a - b);
  const pct = (q) => band.length ? band[Math.min(band.length - 1, Math.floor(band.length * q))] : 0;
  /* p97 of the backdrop's own grain, with a floor so a perfectly flat studio
     wall still gets a usable threshold, and a ceiling so a busy background
     cannot raise it so high that the seam stops mattering */
  let edgeStop = Math.min(0.34, Math.max(0.05, pct(0.97) * edgeFactor));

  /* ── 3. flood inward from the border, stopping at edges ──── */
  const bg = new Uint8Array(n);
  const stack = [];

  /* ── start inside any frame ───────────────────────────────
     Client photos routinely carry a drawn border, a white matte or a
     letterbox bar. Seeding from the true edge fills that band and stops at
     the frame line, which is a hard edge — Jason Barnard's photo cleared a
     10px ring and nothing else, identically at every tolerance, because the
     fill never got past the frame.

     `inset` starts the fill that many pixels in. Everything outside is
     background by definition (it is the frame), so it is cleared outright. */
  if (inset > 0) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        /* top and sides only. A portrait's shoulders run off the BOTTOM edge,
           so a bottom band is the person, not a frame — clearing it removed an
           18px strip of suit from every cut that used an inset. */
        if (x < inset || y < inset || x >= width - inset) bg[y * width + x] = 1;
      }
    }
  }
  const push = (i) => { if (!bg[i] && nearBackdrop(at(i), tolerance)) { bg[i] = 1; stack.push(i); } };
  /* Seed from the top and both sides — NOT the bottom.

     This was the bug that ate Jason Barnard's collar. His shirt runs off the
     bottom of the frame, and a white shirt on the bottom row matches a white
     wall, so the fill was seeded INSIDE his shirt and spread upward through
     it. The sampling already ignored the bottom row for exactly this reason;
     the seeding did not, which undid it.

     Backdrop below the shoulders is still reached from the side columns, so
     nothing is lost by leaving that row out. */
  for (let x = inset; x < width - inset; x++) push(inset * width + x);
  for (let y = inset; y < height - inset; y++) {
    push(y * width + inset); push(y * width + (width - 1 - inset));
  }

  while (stack.length) {
    const i = stack.pop();
    const x = i % width, y = (i - x) / width;
    const nb = [];
    if (x > 0) nb.push(i - 1);
    if (x < width - 1) nb.push(i + 1);
    if (y > 0) nb.push(i - width);
    if (y < height - 1) nb.push(i + width);
    for (const j of nb) {
      if (bg[j]) continue;
      if (grad[j] > edgeStop) continue;            // do not cross the seam
      if (!nearBackdrop(at(j), tolerance)) continue;
      bg[j] = 1;
      stack.push(j);
    }
  }

  /* ── 3b. did the edge rule strangle the fill? ─────────────
     The seam rule is what stops a white shirt being eaten, but on a softly
     lit or slightly noisy backdrop the local gradient is above the threshold
     almost everywhere, so the fill cannot travel and clears a token sliver.
     That is what happened to Jason Barnard's photo: ~5% removed at every
     tolerance, the backdrop left sitting there.

     If the fill barely moved, run it again without the edge rule. The leak
     closing and the torso check below are what keep that honest — they, not
     the seam rule, are the real safety net. */
  let cleared = 0;
  for (let i = 0; i < n; i++) if (bg[i]) cleared++;

  if (cleared / n < 0.08) {
    /* Matching every pixel against the border palette cannot follow a
       graduated backdrop: Jason Barnard's wall drifts far enough from its own
       edges that a tolerance loose enough to cover it (0.20) also matches his
       suit, taking 54% and over half his torso with it.

       So grow by LOCAL CONTINUITY instead — each step compares a pixel to the
       one it spread from, with a tight per-step limit. That walks a gradient
       for as far as the gradient actually goes.

       On its own that is the "connected walk" that once removed 99.9% of an
       image. What makes it safe here is that the edge rule STAYS ON: a walk
       can follow a smooth ramp but cannot cross the seam where a person
       begins. Continuity finds the backdrop; the seam contains it. */
    const STEP = 0.03;
    bg.fill(0);
    stack.length = 0;
    for (let x = 0; x < width; x++) push(x);
    for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }

    while (stack.length) {
      const i = stack.pop();
      const x = i % width, y = (i - x) / width;
      const oi = at(i);
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < width - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - width);
      if (y < height - 1) nb.push(i + width);
      for (const j of nb) {
        if (bg[j]) continue;
        if (grad[j] > edgeStop) continue;
        const oj = at(j);
        if (colourDist(rgba[oi], rgba[oi + 1], rgba[oi + 2],
                       rgba[oj], rgba[oj + 1], rgba[oj + 2]) > STEP) continue;
        bg[j] = 1;
        stack.push(j);
      }
    }
  }

  /* ── 4. close narrow leaks in the subject ─────────────────
     Anything the fill squeezed through is a thin channel; dilating the subject
     then eroding it back seals those without moving the real outline. */
  const R = Math.max(2, Math.round(Math.min(width, height) * 0.006));
  const subj = new Uint8Array(n);
  for (let i = 0; i < n; i++) subj[i] = bg[i] ? 0 : 1;
  morph(subj, width, height, R, 1);   // dilate subject
  morph(subj, width, height, R, 0);   // erode back
  for (let i = 0; i < n; i++) if (subj[i]) bg[i] = 0;

  /* ── 5. give the anti-aliased rim back to the subject ───── */
  const grow = new Uint8Array(bg);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!bg[i]) continue;
      if ((x > 0 && !bg[i - 1]) || (x < width - 1 && !bg[i + 1]) ||
          (y > 0 && !bg[i - width]) || (y < height - 1 && !bg[i + width])) grow[i] = 0;
    }
  }

  let removed = 0;
  for (let i = 0; i < n; i++) if (grow[i]) { out[i * 4 + 3] = 0; removed++; }

  if (feather) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (grow[i] || !bg[i]) continue;
        let c = 0;
        if (grow[i - 1]) c++; if (grow[i + 1]) c++;
        if (grow[i - width]) c++; if (grow[i + width]) c++;
        if (c) out[i * 4 + 3] = Math.round(255 * (1 - c / 5));
      }
    }
  }

  /* ── 6. is this a believable cut-out? ─────────────────────
     Top and upper sides only, for the same reason the sampling ignores the
     bottom. A backdrop the fill could not follow leaves those edges opaque. */
  let edgePixels = 0, edgeCleared = 0;
  for (let x = 0; x < width; x++) { edgePixels++; if (grow[x]) edgeCleared++; }
  for (let y = 1; y < sideDepth; y++) {
    for (const x of [0, width - 1]) { edgePixels++; if (grow[y * width + x]) edgeCleared++; }
  }
  const removedFraction = removed / n;

  /* ── does a person survive? ───────────────────────────────
     Fractions alone let a bad cut through: a black suit against a dark wall
     is genuinely the same colour, the fill takes the whole torso, and the
     arithmetic still looks reasonable — leaving a head floating on nothing.

     In any head-and-shoulders portrait the bottom-centre of the frame IS the
     person. If that block has been cleared, the cut ate them, whatever the
     totals say. */
  let torso = 0, torsoKept = 0;
  for (let y = Math.floor(height * 0.80); y < Math.floor(height * 0.97); y++) {
    for (let x = Math.floor(width * 0.38); x < Math.floor(width * 0.62); x++) {
      torso++;
      if (!grow[y * width + x]) torsoKept++;
    }
  }
  const torsoSurvives = torso === 0 || torsoKept / torso > 0.6;

  return {
    pixels: out,
    removed: removedFraction,
    edgeCleared: edgeCleared / edgePixels,
    torsoKept: torso ? torsoKept / torso : 1,
    edgeStop,
    /* The floor used to be 12%, which rejected correct cuts on tightly
       cropped portraits — Jason Barnard's photo is head-and-shoulders filling
       the frame, so there is only ~5% of backdrop to take. All 12% proved was
       that something happened; the border and torso checks below say it
       happened correctly, so the floor only has to prove it happened at all. */
    plausible: edgeCleared / edgePixels > 0.9
      && removedFraction > 0.02 && removedFraction < 0.78
      && torsoSurvives,
  };
}

/* ── is the silhouette ragged? ─────────────────────────────────
   A cut can clear the backdrop, keep the whole person, and still look torn.
   Jordan Trimble's photo is the case: dark objects in the room behind him did
   not match the light wall, so the fill left them, fused onto his suit as
   shards down both shoulders. Every other check passed.

   Morphological OPENING removes protrusions thinner than its radius and
   leaves a real shoulder alone, so the share of the silhouette it removes is
   a direct measure of shards. Measured at r≈8 on a 590px photo: Jordan 0.68%
   of the whole silhouette, clean synthetic portraits 0.00%.

   Only the lower 55% is counted. Hair makes fine, legitimate protrusions at
   the top of a good cut-out; the shards that make a cut look torn sit along
   the shoulders and sides, and counting hair would decline good photos. */
export function shardLoss(rgba, width, height) {
  const n = width * height;
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = rgba[i * 4 + 3] > 200 ? 1 : 0;
  const o = Uint8Array.from(m);
  const r = Math.max(3, Math.round(Math.min(width, height) * 0.0135));
  morph(o, width, height, r, 0);
  morph(o, width, height, r, 1);
  let kept = 0, lost = 0;
  for (let y = Math.floor(height * 0.45); y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!m[i]) continue;
      kept++;
      if (!o[i]) lost++;
    }
  }
  return kept ? lost / kept : 0;
}

/* above this share of the lower silhouette in shards, the cut is declined and
   the photo is framed as a portrait instead */
export const SHARD_LIMIT = 0.004;

/* Square-ish morphology on a binary mask. mode 1 dilates, 0 erodes.
   Separable, so it stays linear in the radius rather than quadratic. */
function morph(mask, width, height, r, mode) {
  const n = width * height;
  const tmp = new Uint8Array(n);
  const hit = mode ? 1 : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = mode ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= width) continue;
        if (mask[y * width + xx] === hit) { v = hit; break; }
      }
      tmp[y * width + x] = v;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let v = mode ? 0 : 1;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= height) continue;
        if (tmp[yy * width + x] === hit) { v = hit; break; }
      }
      mask[y * width + x] = v;
    }
  }
}
