import { renderSvg, measure, wrap } from "./render.mjs";
import { EMAIL_HERO_PLATE, RC_LOGO_WHITE, RC_LOGO_WHITE_SIZE, EMAIL_HERO_PLATE_LIGHT, EMAIL_HERO_PLATE_LIGHT_SIZE, RC_LOGO_DARK, RC_LOGO_DARK_SIZE } from "./email-assets.mjs";

/* ── artwork for the dark invite email ─────────────────────────
   The Bi-Weekly newsletter's look, applied to one webinar: a charcoal hero
   with dim-red contour lines, the white Red Cloud logo, letter-spaced eyebrows
   behind a short red bar, a heavy white headline with one line in red — and the
   webinar thumbnail framed in red corner brackets, which is how the newsletter
   itself shows a live webinar.

   Both are images rather than HTML because that is how the newsletter does it:
   a mail client cannot be trusted with web fonts, letter-spacing or a
   background texture, and an image looks the same in Outlook as in Gmail. The
   facts that matter — date, presenters, the Register link — are ALSO in the
   HTML beneath, so nothing depends on images loading.
   ───────────────────────────────────────────────────────────── */

const W = 1200;
const RED = "#d7192a";

/* Two themes. LIGHT is the one in use (the dark one read as too heavy for an
   invite — 1 Oct 2026); dark is kept because it costs nothing to keep. */
const THEMES = {
  light: { bg: "#f7f7f8", plate: EMAIL_HERO_PLATE_LIGHT, plateType: "jpeg", plateAR: EMAIL_HERO_PLATE_LIGHT_SIZE.h / EMAIL_HERO_PLATE_LIGHT_SIZE.w,
           logo: RC_LOGO_DARK, logoSize: RC_LOGO_DARK_SIZE, kicker: "#7d7d82", date: "#1d1d1f", eyebrow: "#3a3a3e",
           head: "#1d1d1f", sub: "#3a3a3e", rule: false, frameBg: "#ffffff" },
  dark:  { bg: "#1d1d1f", plate: EMAIL_HERO_PLATE, plateType: "jpeg", plateAR: 700 / 1200,
           logo: RC_LOGO_WHITE, logoSize: RC_LOGO_WHITE_SIZE, kicker: "#a7a7ab", date: "#ffffff", eyebrow: "#ffffff",
           head: "#ffffff", sub: "#d9d9dc", rule: true, frameBg: "#1d1d1f" },
};
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* letter-spaced text measures wider than its glyphs by (n-1) × spacing */
const spaced = (t, size, weight, ls) => measure(t, size, weight) + Math.max(0, String(t).length - 1) * ls;

/* Fit a heading into at most `maxLines` lines of `width`, shrinking from `size`
   to no smaller than `floor` — the same rule the graphics use for titles. */
function fitLines(text, size, weight, width, maxLines, floor) {
  for (let s = size; s >= floor; s -= 2) {
    const lines = wrap(text, s, weight, width);
    if (lines.length <= maxLines && lines.every((l) => measure(l, s, weight) <= width)) return { size: s, lines };
  }
  const lines = wrap(text, floor, weight, width);
  return { size: floor, lines: lines.slice(0, maxLines) };
}

const text = (x, top, size, weight, fill, str, extra = "") =>
  `<text x="${x}" y="${(top + size * 0.78).toFixed(1)}" font-family="Montserrat${weight}" font-size="${size}" fill="${fill}"${extra}>${esc(str)}</text>`;

/**
 * The hero: logo, "WEBINAR INVITE · <date>", red bar, "RED CLOUD WEBINAR SERIES
 * PRESENTS", the company in white, "LIVE WEBINAR." in red, the title beneath.
 * @param f { company, subject, dateShort }  — dateShort like "OCT 7, 2026"
 */
export async function heroPng(f, { width = 600 * 2, theme = "light" } = {}) {
  const T = THEMES[theme] || THEMES.light;
  const X = 72, R = W - 72, maxW = R - X;
  const parts = [];

  // logo, top left
  const lw = theme === "light" ? 300 : 320, lh = Math.round(lw * T.logoSize.h / T.logoSize.w);
  parts.push(`<image x="${X}" y="${theme === "light" ? 70 : 62}" width="${lw}" height="${lh}" href="data:image/png;base64,${T.logo}"/>`);

  // top right: what this is, and when
  parts.push(text(R, 74, 19, 600, T.kicker, "WEBINAR INVITE", ` text-anchor="end" letter-spacing="6"`));
  if (f.dateShort) parts.push(text(R, 108, 30, 800, T.date, f.dateShort.toUpperCase(), ` text-anchor="end" letter-spacing="3"`));

  let y = 232;
  parts.push(`<rect x="${X}" y="${y}" width="84" height="7" fill="${RED}"/>`);
  y += 34;
  parts.push(text(X, y, 21, 700, T.eyebrow, "RED CLOUD WEBINAR SERIES PRESENTS", ` letter-spacing="6"`));
  y += 21 + 22;

  // the company, heavy and white — two lines at most, shrinking to fit
  const head = fitLines(String(f.company || "").toUpperCase(), 80, 800, maxW, 2, 52);
  for (const l of head.lines) { parts.push(text(X, y, head.size, 800, T.head, l)); y += head.size * 1.06; }
  parts.push(text(X, y, head.size, 800, RED, "LIVE WEBINAR."));
  y += head.size * 1.06 + 18;

  // the title, quieter
  if (f.subject) {
    const sub = fitLines(f.subject, 30, 500, maxW - 40, 2, 22);
    for (const l of sub.lines) { parts.push(text(X, y, sub.size, 500, T.sub, l)); y += sub.size * 1.4; }
  }
  const H = Math.round(y + 54);
  if (T.rule) parts.push(`<rect x="${X}" y="${H - 6}" width="${maxW}" height="6" fill="${RED}"/>`);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${T.bg}"/>` +
    /* the plate covers the hero whatever its height: scaled up to the height
       when the text runs long, centred, sides cropped */
    `<svg x="0" y="0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
    `<image x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" href="data:image/${T.plateType};base64,${T.plate}"/></svg>` +
    parts.join("") + `</svg>`;
  return { png: await renderSvg(svg, { width }), width: W, height: H };
}

/**
 * The webinar thumbnail, rounded and framed with the newsletter's two red
 * corner brackets (top left, bottom right), on the email's charcoal.
 */
export async function framedPng(thumbPng, thumbW = 1280, thumbH = 720, { width = 600 * 2, showH = 648, theme = "light" } = {}) {
  const T = THEMES[theme] || THEMES.light;
  /* the thumbnail's own dark band (its bottom 72px) is cropped off, as the
     newsletter does — inside a frame on charcoal it reads as a stray bar */
  const pad = 72, top = 34, iw = W - pad * 2, ih = Math.round(iw * showH / thumbW);
  const H = top + ih + 34, arm = 54, t = 6, off = 18;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><clipPath id="r"><rect x="${pad}" y="${top}" width="${iw}" height="${ih}" rx="12"/></clipPath></defs>` +
    `<rect width="${W}" height="${H}" fill="${T.frameBg}"/>` +
    `<g clip-path="url(#r)"><svg x="${pad}" y="${top}" width="${iw}" height="${ih}" viewBox="0 0 ${thumbW} ${showH}" preserveAspectRatio="xMidYMin slice">` +
    `<image x="0" y="0" width="${thumbW}" height="${thumbH}" href="data:image/png;base64,${Buffer.from(thumbPng).toString("base64")}"/></svg></g>` +
    // top-left bracket
    `<rect x="${pad - off}" y="${top - off}" width="${arm}" height="${t}" fill="${RED}"/>` +
    `<rect x="${pad - off}" y="${top - off}" width="${t}" height="${arm}" fill="${RED}"/>` +
    // bottom-right bracket
    `<rect x="${pad + iw + off - arm}" y="${top + ih + off - t}" width="${arm}" height="${t}" fill="${RED}"/>` +
    `<rect x="${pad + iw + off - t}" y="${top + ih + off - arm}" width="${t}" height="${arm}" fill="${RED}"/>` +
    `</svg>`;
  return { png: await renderSvg(svg, { width }), width: W, height: H };
}
