import dns from "node:dns/promises";
import net from "node:net";

/* ─────────────────────────────────────────────────────────────
   Reading a company's own website.

   The URL is typed by a stranger, so every fetch is guarded:
   http/https only, no loopback, no private ranges, no cloud
   metadata address, and redirects are followed BY HAND so every
   hop is re-checked rather than only the first.

   Everything read here is untrusted third-party text. Callers
   must fence it in the prompt and never let it act as
   instructions.
   ───────────────────────────────────────────────────────────── */

export const FETCH_TIMEOUT = 5000;      // ms per page
export const MAX_BYTES     = 900_000;   // per page, before stripping

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    v === "::" || v === "::1" ||
    v.startsWith("fc") || v.startsWith("fd") ||
    v.startsWith("fe80") || v.startsWith("::ffff:")
  );
}

export async function assertPublic(urlStr) {
  const u = new URL(urlStr);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("unsupported protocol");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("private address");
    return u;
  }
  if (!host.includes(".") || host.endsWith(".local") || host === "localhost") {
    throw new Error("non-public host");
  }
  const records = await dns.lookup(host, { all: true });
  if (!records.length || records.some((r) => isPrivateIp(r.address))) {
    throw new Error("resolves to a private address");
  }
  return u;
}

/** Fetch one page, re-checking every redirect hop. */
export async function safeFetch(startUrl) {
  let url = startUrl;
  let retried = false;
  for (let hop = 0; hop < 4; hop++) {
    const u = await assertPublic(url);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
    let res;
    try {
      res = await fetch(u, {
        redirect: "manual",
        signal: ctl.signal,
        headers: BROWSER_HEADERS,
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("redirect without location");
      url = new URL(loc, u).toString();
      continue;
    }
    /* Some firewalls refuse the first request, set a cookie, and admit the
       second. One retry carrying that cookie is cheap and gets us in often
       enough to be worth it. A site running a real JavaScript challenge still
       refuses, and that we cannot solve server-side. */
    if (res.status === 403 && !retried) {
      const cookie = res.headers.get("set-cookie");
      if (cookie) {
        retried = true;
        const ctl2 = new AbortController();
        const t2 = setTimeout(() => ctl2.abort(), FETCH_TIMEOUT);
        try {
          res = await fetch(u, {
            redirect: "manual",
            signal: ctl2.signal,
            headers: { ...BROWSER_HEADERS, cookie: cookie.split(";")[0], referer: u.origin + "/" },
          });
        } catch { /* keep the original 403 */ } finally { clearTimeout(t2); }
      }
    }

    if (!res.ok) {
      /* 403/429 is the site's protection refusing us, not a bad address —
         telling someone to "check the address" when the address is fine
         sends them looking for a typo that is not there. */
      if (res.status === 403 || res.status === 401) {
        throw new Error("the website blocked our request (its security settings)");
      }
      if (res.status === 429) throw new Error("the website asked us to slow down");
      if (res.status === 404) throw new Error("that page was not found on the site");
      throw new Error(`site returned ${res.status}`);
    }
    if (!/text\/html|application\/xhtml/i.test(res.headers.get("content-type") || "")) {
      throw new Error("not an HTML page");
    }

    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) { await reader.cancel(); break; }
      chunks.push(value);
    }
    return { html: Buffer.concat(chunks).toString("utf8"), finalUrl: u };
  }
  throw new Error("too many redirects");
}

export function stripToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same-domain links whose text or URL matches `wanted`, most promising first. */
export function findLinks(html, baseUrl, wanted, limit) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m;
  let base;
  try { base = new URL(baseUrl); } catch { return out; }

  while ((m = re.exec(html)) && out.length < limit) {
    const href = m[1];
    const label = stripToText(m[2]);
    if (!wanted.test(href) && !wanted.test(label)) continue;
    let abs;
    try { abs = new URL(href, baseUrl); } catch { continue; }
    if (abs.hostname !== base.hostname) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|mp4|docx?|pptx?)$/i.test(abs.pathname)) continue;
    const key = abs.pathname.replace(/\/$/, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(abs.toString());
  }
  return out;
}

/** What a mining issuer's story and people live behind. */
/* ── how we introduce ourselves ───────────────────────────────
   We used to send "RedCloudWebinarForm/1.0", and Cloudflare and most WAFs
   403 an unrecognised agent on sight — clients pasted in a perfectly good
   website and were told we could not read it.

   These are the headers an ordinary browser sends. We are fetching a public
   marketing page that the client has just asked us to read, at normal speed,
   once — nothing here bypasses a paywall or a login.
   ─────────────────────────────────────────────────────────── */
export const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-CA,en;q=0.9",
  "upgrade-insecure-requests": "1",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
};

export const NEWS_LINKS = /news|press|release|media|investor/i;

/* An individual announcement, not the news index. Mining releases open with the
   full listing — "Valor Gold Corp. (TSXV: VG) (OTCQB: VGCFF) announces..." —
   which is often the only place on a site where every exchange and symbol is
   written out in plain text. A stock-information page frequently is not. */
export const RELEASE_LINKS = /news-release|press-release|\/news\/[a-z0-9-]{12,}|\/\d{4}\/\d{2}\//i;

/* Two tiers, because "about" is both the likeliest word to match and the least
   likely page to actually list anybody. A site with /about/ and
   /about/our-team/ offers them in that order, so taking document order spent
   the slot on the page with no people on it and the management came back
   empty. Named-people pages are tried first. */
/* Broadened after Valor Gold returned nobody: junior miners label this page a
   dozen ways, and each miss meant an empty speaker dropdown. "bio"/"bios" and
   "board" in particular are common on TSXV sites. */
export const TEAM_STRONG = /team|management|leadership|our-people|people|directors|board|executives?|officers|bios?\b|advisors?|key-personnel|senior/i;
export const TEAM_WEAK   = /about|corporate|governance|who-we-are|company/i;
export const TEAM_LINKS  = new RegExp(TEAM_STRONG.source + "|" + TEAM_WEAK.source, "i");

/* ── finding an actual press release ───────────────────────────
   A release opens with the full listing —
   "Valor Gold Corp. (TSX: VGC) (OTCQB: VLGDF) is pleased to
   announce..." — and that is frequently the ONLY place on a site
   where every exchange and symbol appears as plain text. Stock
   information pages often carry share counts and no ticker at all.

   Many of these sites render their news index in JavaScript, so
   the individual releases are unreachable by following links. The
   sitemap lists them regardless, which is why it is worth the
   extra request.
   ───────────────────────────────────────────────────────────── */

const SITEMAPS = ["/post-sitemap.xml", "/sitemap_index.xml", "/sitemap.xml", "/news-sitemap.xml"];

async function fromSitemap(origin) {
  for (const path of SITEMAPS) {
    let res;
    try {
      const u = await assertPublic(origin + path);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
      try {
        res = await fetch(u, { redirect: "follow", headers: BROWSER_HEADERS });
      } finally { clearTimeout(timer); }
    } catch { continue; }
    if (!res.ok) continue;

    const xml = (await res.text()).slice(0, 400_000);
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    if (!locs.length) continue;

    /* an index of sitemaps — follow the one most likely to hold posts */
    if (/sitemapindex/i.test(xml)) {
      const inner = locs.find((l) => /post|news|release/i.test(l));
      if (inner) {
        try {
          const r2 = await fetch(await assertPublic(inner), { headers: BROWSER_HEADERS });
          if (r2.ok) {
            const x2 = (await r2.text()).slice(0, 400_000);
            const l2 = [...x2.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
            if (l2.length) return l2;
          }
        } catch { /* fall through */ }
      }
      continue;
    }
    return locs;
  }
  return [];
}

/** Read a site: homepage, then the most useful follow-ups, within a time budget. */

/* ── when the front door is bolted ─────────────────────────────
   Some sites sit behind protection that fingerprints the TLS handshake, not
   the headers. Node's handshake is not a browser's, so every request is
   refused no matter how we introduce ourselves — grsilvermining.com returns
   403 to Node and 200 to curl with identical headers.

   Most junior-mining sites are WordPress, and its REST API is usually left
   open even when the HTML is not. It also gives cleaner content than
   scraping: real titles and body text instead of navigation and footers.
   ─────────────────────────────────────────────────────────── */
async function wpJson(origin, path) {
  const u = await assertPublic(`${origin}${path}`);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(u, {
      redirect: "follow",
      signal: ctl.signal,
      headers: { ...BROWSER_HEADERS, accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    return Array.isArray(body) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function readViaWordPress(website, { maxChars = 34000 } = {}) {
  const origin = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).origin;

  /* Plenty of these sites file news under a custom post type rather than
     "posts" — GR Silver uses `press_release`, and its `posts` collection is
     empty. Ask the site what types it has and read anything news-shaped, so
     the tickers and the current story are not missed. */
  let newsTypes = [];
  try {
    const u = await assertPublic(`${origin}/wp-json/wp/v2/types`);
    const res = await fetch(u, { headers: { ...BROWSER_HEADERS, accept: "application/json" } });
    if (res.ok) {
      const types = await res.json().catch(() => ({}));
      newsTypes = Object.values(types || {})
        .map((t) => t?.rest_base)
        .filter((b) => typeof b === "string" && /press|news|release/i.test(b) && !/\(/.test(b));
    }
  } catch { /* the standard collections below are enough on their own */ }

  const wanted = [
    ...newsTypes.map((b) => `/wp-json/wp/v2/${b}?per_page=10&_fields=link,title,content,date`),
    "/wp-json/wp/v2/posts?per_page=10&_fields=link,title,content,date",
    "/wp-json/wp/v2/pages?per_page=20&_fields=link,title,content",
  ];

  const results = await Promise.all(wanted.map((path) => wpJson(origin, path)));
  if (results.every((r) => !r)) return null;

  /* news first — the tickers and the current story live in recent releases,
     and the character budget runs out before the page archive does */
  const items = results.flatMap((r) => r || []);
  if (!items.length) return null;

  let text = "";
  const sources = [];
  for (const it of items) {
    if (text.length > maxChars) break;
    const title = it?.title?.rendered ? stripToText(it.title.rendered) : "";
    const bodyHtml = it?.content?.rendered || "";
    if (!title && !bodyHtml) continue;
    text += `\n\n${title}\n${stripToText(bodyHtml)}`;
    if (it.link) sources.push(it.link);
  }
  if (!text.trim()) return null;

  return { text: text.slice(0, maxChars), sources, logo: null, viaWordPress: true };
}

export async function readSite(website, { budgetMs = 13000, maxChars = 34000, extraPages = 4 } = {}) {
  const start = /^https?:\/\//i.test(website) ? website : `https://${website}`;

  /* www and the bare domain are frequently protected differently — one sits
     behind the firewall and the other redirects in front of it. If the address
     the client gave is refused, the other spelling is worth one try before
     telling them we cannot read their site. */
  let html, finalUrl;
  try {
    ({ html, finalUrl } = await safeFetch(start));
  } catch (err) {
    let alt = null;
    try {
      const u = new URL(start);
      u.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
      alt = u.toString();
    } catch { /* not a parseable URL — the original error is the useful one */ }
    if (alt) {
      try {
        ({ html, finalUrl } = await safeFetch(alt));
      } catch { /* fall through to the WordPress API */ }
    }
    if (!html) {
      const viaWp = await readViaWordPress(website, { maxChars });
      if (viaWp) return viaWp;
      throw err;
    }
  }

  const home = finalUrl.toString();
  let text = stripToText(html);
  const sources = [home];
  const deadline = Date.now() + budgetMs;
  /* Follow-ups stop early so there is always time left for one press release.
     Letting them run to the full budget is what starved it before: five
     ordinary pages used the clock and the one page carrying the tickers was
     never opened. */
  const browseDeadline = Date.now() + budgetMs * 0.55;

  /* Alternate between the two kinds rather than concatenating them.

     Concatenating looked fine and was not: a site with three news links used
     every available slot on news and the team page was never opened, so the
     management list came back empty. Interleaving guarantees each kind gets a
     turn however many links of the other sort a homepage happens to carry. */
  const news = findLinks(html, home, NEWS_LINKS, extraPages);
  /* specific people-pages first, generic ones only as a fallback */
  const strong = findLinks(html, home, TEAM_STRONG, extraPages);
  const weak = findLinks(html, home, TEAM_WEAK, extraPages).filter((u) => !strong.includes(u));
  const team = [...strong, ...weak];
  const targets = [];
  /* TEAM first on each pass. The speakers dropdown is the thing clients notice
     missing — a headline can be typed in seconds, a management list cannot —
     so when the budget runs out it should be news that got cut, not people. */
  for (let i = 0; targets.length < extraPages && (i < news.length || i < team.length); i++) {
    if (targets.length < extraPages && i < team.length) targets.push(team[i]);
    if (targets.length < extraPages && i < news.length) targets.push(news[i]);
  }

  /* follow-ups, remembering the html of any news index so we can open one
     actual release from it afterwards */
  let newsIndexHtml = null, newsIndexUrl = null;
  let teamHubHtml = null, teamHubUrl = null;
  for (const link of targets) {
    if (text.length > maxChars || Date.now() > browseDeadline) break;
    try {
      const sub = await safeFetch(link);
      text += "\n\n" + stripToText(sub.html);
      sources.push(sub.finalUrl.toString());
      if (!newsIndexHtml && NEWS_LINKS.test(link)) {
        newsIndexHtml = sub.html;
        newsIndexUrl = sub.finalUrl.toString();
      }
      /* Remember a hub so we can go one level deeper for people. */
      if (TEAM_LINKS.test(link) && !teamHubHtml) {
        teamHubHtml = sub.html;
        teamHubUrl = sub.finalUrl.toString();
      }
    } catch { /* a dud follow-up is not worth failing the whole read over */ }
  }

  /* ── one hop deeper for people ────────────────────────────────
     A generic "/about/" page usually just links onward to the real
     management page, and reading only the hub is why Valor Gold came back
     with nobody. Follow up to two people-pages found ON that hub that were
     not already visited. */
  if (teamHubHtml && text.length < maxChars && Date.now() < browseDeadline) {
    const deeper = findLinks(teamHubHtml, new URL(teamHubUrl), TEAM_STRONG, 2)
      .filter((u) => !targets.includes(u) && u !== teamHubUrl);
    for (const link of deeper.slice(0, 2)) {
      if (text.length > maxChars || Date.now() > browseDeadline) break;
      try {
        const sub = await safeFetch(link);
        text += "\n\n" + stripToText(sub.html);
        sources.push(sub.finalUrl.toString());
      } catch { /* same tolerance as above */ }
    }
  }

  /* One release in full.

     The sitemap is tried FIRST because it lists actual releases. Following
     links from the news index looked equivalent and was not: on a site whose
     index is JavaScript-rendered, the only link matching /news|release/ is the
     index itself, so it re-fetched a page it already had and called that a
     release. The tickers stayed missing and nothing reported a problem. */
  if (Date.now() < deadline && text.length < maxChars) {
    const base = new URL(home);
    const seen = new Set(sources.map((u) => u.replace(/\/$/, "")));

    const isRelease = (u) => {
      try {
        const url = new URL(u);
        if (url.hostname !== base.hostname) return false;
        if (seen.has(u.replace(/\/$/, ""))) return false;
        if (/\.(xml|jpe?g|png|pdf|docx?)$/i.test(url.pathname)) return false;
        /* an individual item has a long slug; an index is one short segment */
        const last = url.pathname.replace(/\/$/, "").split("/").pop() || "";
        return last.length >= 15;
      } catch { return false; }
    };

    let release = [...(await fromSitemap(base.origin))].reverse().find(isRelease) || null;

    if (!release && newsIndexHtml) {
      release = findLinks(newsIndexHtml, newsIndexUrl, RELEASE_LINKS, 3).find(isRelease)
        || findLinks(newsIndexHtml, newsIndexUrl, /news|release/i, 6).find(isRelease)
        || null;
    }

    if (release) {
      try {
        const r = await safeFetch(release);
        text += "\n\n" + stripToText(r.html);
        sources.push(r.finalUrl.toString());
      } catch { /* no release is survivable; the ticker just stays empty */ }
    }
  }

  return { text: text.slice(0, maxChars), sources, logo: findLogo(html, home) };
}

/* ── the company's own logo ────────────────────────────────────
   Clients routinely upload a 13KB JPEG pulled off their own site,
   which cannot hold transparency and looks poor at poster size.
   Their site usually serves something better, and often an SVG.
   Preference order reflects what actually composites well:
   a transparent PNG or an SVG beats anything else.
   ───────────────────────────────────────────────────────────── */
/* Every candidate, best first. The graphics step walks this list when a client
   supplied no usable logo, because the top pick is not always drawable or the
   right way round — Skyharbour's "logo-colour.png" is in fact a white mark. */
export function findLogos(html, baseUrl, { includeOg = true, logoOnly = false } = {}) {
  const candidates = [];
  const add = (url, score, logoish = false) => {
    if (!url) return;
    let abs;
    try { abs = new URL(url, baseUrl).toString(); } catch { return; }
    if (!/^https?:/i.test(abs)) return;
    if (/\.(svg)(\?|$)/i.test(abs)) score += 40;
    else if (/\.(png)(\?|$)/i.test(abs)) score += 25;
    else if (/\.(jpe?g|webp)(\?|$)/i.test(abs)) score += 5;
    else return;                                    // not an image we can use
    if (/favicon|apple-touch|sprite|placeholder/i.test(abs)) return;
    if (/logo/i.test(abs)) { score += 30; logoish = true; }
    /* a white/reversed mark is for dark backgrounds; prefer the standard one */
    if (/white|light|reverse|inverted/i.test(abs)) score -= 15;
    candidates.push({ url: abs, score, logoish });
  };

  /* an <img> whose src, class or alt says logo — usually the header mark */
  const imgRe = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1];
    const says = /logo|brand/i.test(tag);
    add(src, says ? 30 : 0, says);
  }

  /* explicit metadata, which sites set deliberately */
  /* og:image is usually a social banner, not a logo — fine as a last resort for
     the form's preview, wrong as a graphic's logo */
  if (includeOg) {
    const og = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1];
    add(og, 10);
  }
  const ld = html.match(/"logo"\s*:\s*"([^"]+)"/i);
  if (ld) add(ld[1].replace(/\\\//g, "/"), 45, true);

  candidates.sort((a, b) => b.score - a.score);
  /* logoOnly: for the graphics fallback. Without it Skyharbour's list ran on
     from its two logos into people-icon.svg and project photos, and a loop
     looking for a "normal-coloured" mark would have accepted an icon as the
     company logo. Only images something on the page calls a logo qualify. */
  const pool = logoOnly ? candidates.filter((c) => c.logoish) : candidates;
  return [...new Set(pool.map((c) => c.url))];
}

export function findLogo(html, baseUrl) {
  return findLogos(html, baseUrl)[0] || null;
}
