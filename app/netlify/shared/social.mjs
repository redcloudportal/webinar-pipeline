import { startOf, longDate, webinarDateKey, DISPLAY_TZ } from "./record.mjs";
import { fileLink } from "./box.mjs";

/* ── the social copy that goes with every webinar ──────────────
   Five posts and one per clip, written from the record so nobody retypes a
   presenter's title or a ticker into a client's feed.

   The shapes below are Red Cloud's own, copied from the Skyharbour sheet of
   7 October 2026 — the emoji, the blank lines between blocks, the trailing
   space after "Register now:" that puts the link on its own line. They are
   deliberately NOT prettier than the originals: these are pasted into a
   content calendar and posted as written.

   Each of the five reads differently on purpose — the look-ahead sells the
   date, the day-of sells urgency, the replay sells what was missed — and every
   one of them ends on a call to action, to register or to watch.
   ───────────────────────────────────────────────────────────── */

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const ABBR   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* "Skyharbour Resources Ltd." -> "Skyharbour Resources". The legal suffix is
   right on a registration page and wrong in a sentence. */
export function shortCompany(name) {
  return String(name || "").trim()
    .replace(/[,\s]+(ltd\.?|limited|inc\.?|corp\.?|corporation|plc|llc|co\.?)$/i, "")
    .trim();
}

/* Titles as a person would say them out loud. "President, CEO, Director"
   becomes "CEO"; anything we have no short form for is left exactly as the
   client wrote it, which is safer than guessing. */
const SHORT_TITLES = [
  [/chief executive officer|\bceo\b/i,                        "CEO"],
  [/chief financial officer|\bcfo\b/i,                        "CFO"],
  [/chief operating officer|\bcoo\b/i,                        "COO"],
  [/chief technical officer|chief technology officer|\bcto\b/i, "CTO"],
  [/\bpresident\b/i,                                          "President"],
  [/\bchair(man|woman|person)?\b/i,                           "Chair"],
];
export function shortTitle(title) {
  const t = String(title || "").trim();
  for (const [re, out] of SHORT_TITLES) if (re.test(t)) return out;
  return t;
}

/* "TSXV: SYH | OTCQX: SYHBF | FSE: 488" -> ["$SYH", "$SYHBF"].
   Purely numeric listings (FSE: 488) are dropped: they are not cashtags and
   nothing resolves them.

   `suffix` adds the TSXV ".v", which Red Cloud writes on LinkedIn and Facebook
   and leaves off on Twitter — their own posts do it that way. No other
   exchange takes a suffix here: inventing one would put a symbol in a client's
   feed that does not exist. */
export function cashtags(tickers, { suffix = false } = {}) {
  return String(tickers || "")
    .split(/[|,;]+/)
    .map((part) => {
      const [a, b] = part.split(":").map((s) => (s || "").trim());
      const exchange = b ? a : "";
      const symbol = (b || a || "").trim();
      if (!/^[A-Za-z][A-Za-z0-9.]*$/.test(symbol)) return null;
      return `$${symbol.toUpperCase()}${suffix && /tsxv|tsx-v/i.test(exchange) ? ".v" : ""}`;
    })
    .filter(Boolean);
}

/* "1:00pm ET / 10:00am PT" -> "1:00 PM ET | 10:00 AM PT" */
export function longTime(rec) {
  const raw = (rec?.schedule?.startTime || rec?.facts?.clientTime || "").trim();
  if (!raw) return "[TIME]";
  return raw
    .replace(/\s*\/\s*/g, " | ")
    .replace(/(\d)\s*([ap])\.?m\.?/gi, (_, d, ap) => `${d} ${ap.toUpperCase()}M`);
}
/* the same, tightened for Twitter: "1 PM ET | 10 AM PT" */
export function shortTime(rec) {
  return longTime(rec).replace(/:00(?=\s*[AP]M)/g, "");
}

function parts(rec) {
  const key = webinarDateKey(rec);
  if (!key) return null;
  const d = startOf(rec);
  if (d) {
    const f = (o) => new Intl.DateTimeFormat("en-CA", { timeZone: DISPLAY_TZ, ...o }).format(d);
    return { weekday: f({ weekday: "long" }), month: Number(f({ month: "numeric" })) - 1, day: Number(f({ day: "numeric" })) };
  }
  const [y, m, day] = key.split("-").map(Number);
  const u = new Date(Date.UTC(y, m - 1, day));
  return { weekday: new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "long" }).format(u), month: m - 1, day };
}

/** "Wednesday, October 7, 2026" */
export const dateLong = (rec) => longDate(rec);
/** "Wednesday, Oct. 7" */
export function dateShort(rec) {
  const p = parts(rec);
  return p ? `${p.weekday}, ${ABBR[p.month]}. ${p.day}` : "[DATE]";
}
/** "07-Oct" — how the content calendar's own date column is written */
export function dateCell(rec) {
  const p = parts(rec);
  return p ? `${String(p.day).padStart(2, "0")}-${ABBR[p.month]}` : "";
}

/** The page people are being sent to. Whatever Red Cloud has set wins. */
export function registrationUrl(rec) {
  const set = (rec?.schedule?.registrationUrl || "").trim();
  if (set) return set;
  const slug = String(rec?.facts?.company || "").toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `https://redcloudfs.com/events/${slug}/` : "[REGISTRATION LINK]";
}
export const replayUrl = (rec) => (rec?.schedule?.replayUrl || "").trim() || "[REPLAY LINK]";

/* "Skyharbour Resources CEO Jordan Trimble and VP of Exploration Serdar Donmez" */
function presenterPhrase(rec, { lead = true } = {}) {
  const co = shortCompany(rec?.facts?.company);
  const people = (rec?.facts?.speakers || []).filter((s) => s && s.name);
  if (!people.length) return co;
  const bits = people.map((s, i) => {
    const role = shortTitle(s.title);
    const who = role ? `${role} ${s.name}` : s.name;
    return i === 0 && lead && co ? `${co} ${who}` : who;
  });
  if (bits.length === 1) return bits[0];
  return `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}`;
}
/* the same list without the company in front, comma-separated — used where an
   "and" would collide with the one in front of Red Cloud, and on Twitter */
function presenterPhraseShort(rec) {
  return presenterPhrase(rec, { lead: false }).replace(/ and /g, ", ");
}
/* with the company, but comma-separated for the same reason */
function presenterPhraseComma(rec) {
  return presenterPhrase(rec).replace(/ and /g, ", ");
}
/* just the one who speaks in a clip */
function leadPresenter(rec) {
  const s = (rec?.facts?.speakers || []).find((x) => x && x.name);
  if (!s) return shortCompany(rec?.facts?.company);
  const role = shortTitle(s.title);
  return role ? `${role} ${s.name}` : s.name;
}
/* "Skyharbour Resources'" — not "Resources's" */
const possessive = (s) => (/s$/i.test(s) ? `${s}'` : `${s}'s`);

/* "Skyharbour Resources: Corporate Update & Outlook" — the client's own title
   if it already names them, otherwise their name in front of it. */
function headline(rec) {
  const co = shortCompany(rec?.facts?.company);
  const t = String(rec?.facts?.title || "").trim();
  if (!t) return co;
  return co && t.toLowerCase().startsWith(co.toLowerCase()) ? t : `${co}: ${t}`;
}
/* Is the title a short label ("Corporate Update & Outlook") or a full headline
   ("How Skyharbour Turns 44 Athabasca Projects Into Partner Funding")? Both
   turn up. A label slots into a sentence — "for a Corporate Update & Outlook
   webinar" — and a headline does not; it has to stand on its own line or the
   sentence reads as though a word is missing. */
const isLabel = (t) => t && t.split(/\s+/).length <= 5;

/* Clips get named by whoever marked them up, and in practice that is as often
   "Clip 1" or "Intro Clip" as it is "Maverick drilling". A name that says
   something is the post's hook; a filing label is not, and "CEO Eric Zaunscherb
   on Clip 1" is how that reads if nobody checks. Strip the filing words and the
   numbers — if two real words survive, the name can carry the post; otherwise
   the webinar's own title does, and the clip name is not shown at all. */
const FILING = /\b(intro|outro|opener|closer|teaser|highlight|clip|cut|cutdown|short|reel|part|segment)s?\b/gi;
function saysSomething(name) {
  const left = String(name || "").replace(FILING, " ").replace(/[^A-Za-z\s'-]/g, " ").trim();
  return left.split(/\s+/).filter(Boolean).length >= 2;
}

/* just the subject, with the company stripped off the front */
export function subject(rec) {
  const co = shortCompany(rec?.facts?.company);
  const t = String(rec?.facts?.title || "").trim();
  if (!t) return "webinar";
  const re = new RegExp(`^${co.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:–-]\\s*`, "i");
  return co ? t.replace(re, "") : t;
}

/* ── pulling a line out of the clip itself ────────────────────
   A clip post that only names the clip says nothing. The transcript is already
   on the record, so the post can carry what the speaker actually said in those
   seconds — which is the thing worth reading.

   The transcript is machine-made and it gets names wrong ("Eric Sunscher" for
   Eric Zaunscherb), so nothing here is posted unread: the run and /ops both say
   the quote came from the auto-transcript. What it is good at is the numbers,
   and the numbers are what these clips are for.
   ───────────────────────────────────────────────────────────── */

const seconds = (tc) => {
  const p = String(tc || "").split(":");
  if (p.length !== 3) return null;
  const v = Number(p[0]) * 3600 + Number(p[1]) * 60 + Number(p[2]);
  return Number.isFinite(v) ? v : null;
};

/* Housekeeping the host says in every single webinar. None of it is the clip. */
const BOILERPLATE = [
  /solicitation to buy or sell/i, /investment advisor/i, /do your own research/i,
  /download (their|the) presentation/i, /cautionary statement/i, /forward.looking/i,
  /my name is/i, /welcome to/i, /i'?ll be your host/i, /type (them|it) into the chat/i,
  /thank you for your attention/i, /access .{0,20}research by going to/i,
  /\[music\]/i, /\[end of presentation\]/i, /questions?,? (but )?to do that/i,
];

/* openers that make a sentence read as a fragment once it is lifted out */
const LEAD_IN = /^(so|and|but|now|moving on|finally|then|well|okay|right|again|also)\b[\s,]*/i;

/* A speaker says "55 m oz." and "approx." mid-sentence. Splitting on every
   period cuts the quote off at the abbreviation and the post then reads as
   though the number were the end of the thought — "55 m oz." on its own. These
   periods are hidden while the text is split and put back afterwards. */
const ABBREV = /\b(m\s?oz|oz|approx|no|inc|ltd|corp|co|dr|mr|mrs|ms|st|vs|etc|al|u\.s|a\.m|p\.m|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\./gi;
const DOT = "\u0001";

function sentencesOf(text) {
  const hidden = String(text || "").replace(/\s+/g, " ").replace(ABBREV, (m) => m.replace(".", DOT));
  return hidden.split(/(?<=[.!?])\s+/)
    .map((x) => x.replace(new RegExp(DOT, "g"), ".").trim())
    .filter(Boolean);
}

/* "Moving on, our timelines and value creation, we were able to raise $33m"
   -> "We were able to raise $33m". A short scene-setting clause in front of the
   real sentence survives the lead-in strip and still reads as a fragment. */
function trimClause(line) {
  const m = line.match(/^[^,]{1,60},\s+(we|our|the company|it|that|this)\b/i);
  if (!m) return line;
  const rest = line.slice(line.indexOf(",") + 1).trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Every quotable line in a passage, strongest first. */
function rankedSentences(text) {
  const out = [];
  for (const raw of sentencesOf(text)) {
    if (BOILERPLATE.some((re) => re.test(raw))) continue;
    if (/\?$/.test(raw)) continue;                       // a question is the host, not the pitch
    let line = trimClause(raw.replace(LEAD_IN, ""));
    if (!/[.!]$/.test(line)) continue;                   // cut off mid-thought by the clip edge
    const words = line.split(/\s+/).length;
    if (words < 8 || line.length > 185) continue;
    /* A capitalised "The"/"We" sitting mid-sentence after a lowercase word is
       the transcriber having missed a full stop — two sentences welded into
       one, and it reads as nonsense in quotation marks. There is always another
       sentence in the clip; take that one instead. */
    if (/[a-z]\s+(The|This|These|We|Our|It|They|I)\s+[a-z]/.test(line)) continue;

    /* what makes one of these worth posting: a figure in it */
    const figures = (line.match(/\$\s?[\d.,]+|\d[\d.,]*\s?(%|m\b|g\/t|oz|million|billion|metres?|meters?|km)/gi) || []).length;
    let score = figures * 3;
    if (line.length >= 60 && line.length <= 180) score += 2;   // reads as a post, not a paragraph
    if (/^[A-Z]/.test(line)) score += 1;
    if (/\b(we|our)\b/i.test(line)) score += 1;                 // the company talking about itself
    if (/\b(um|uh|you know|i mean|sort of|kind of)\b/i.test(line)) score -= 3;
    out.push({ line: line.charAt(0).toUpperCase() + line.slice(1), score });
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.line);
}

/** The strongest line the speaker says inside this clip, or null.

   `used` holds the lines already given to earlier clips. Clips overlap — an
   "Extra clip" is often the one before it with thirty seconds on the end — and
   without this the same sentence goes out twice over. */
export function clipQuote(rec, name, used) {
  const cj = rec?.clipJob;
  const mark = cj?.marks?.[name];
  const t = cj?.transcript;
  if (!mark || !Array.isArray(t) || !t.length) return null;
  const a = seconds(mark.in), b = seconds(mark.out);
  if (a == null || b == null) return null;
  const span = t.filter((x) => x.end > a && x.start < b).map((x) => x.text).join(" ");
  const ranked = rankedSentences(span);
  if (!used) return ranked[0] || null;
  const fresh = ranked.find((l) => !used.has(l));
  if (fresh) used.add(fresh);
  return fresh || null;
}

/**
 * Every post for this webinar.
 * @returns [{ when, type, asset, copy }]
 */
export function socialRows(rec) {
  const co       = shortCompany(rec?.facts?.company);
  const tags     = cashtags(rec?.facts?.tickers, { suffix: true });   // LI/FB
  const plain    = cashtags(rec?.facts?.tickers);                     // Twitter, replay, clips
  const lead     = plain[0] || "";
  const reg      = registrationUrl(rec);
  const replay   = replayUrl(rec);
  const assets   = rec?.assets || {};
  const link     = (k) => (assets[k] ? fileLink(assets[k]) : "");
  const people   = presenterPhrase(rec);
  const peopleC  = presenterPhraseComma(rec);
  const peopleX  = presenterPhraseShort(rec);
  const subj     = subject(rec);
  const label    = isLabel(subj);

  const rows = [];

  rows.push({
    when: "Look Ahead", type: "LI/FB", asset: link("linkedin"),
    copy:
`Upcoming Webinar | ${headline(rec)}

📅 ${dateLong(rec)}

⏰ ${longTime(rec)}

Join ${people} for ${label ? `a ${subj} webinar` : "this webinar"} with Red Cloud Financial Services.

Register now: 
${reg}

${tags.join(" | ")}`,
  });

  rows.push({
    when: "Look Ahead", type: "Twitter", asset: link("twitter"),
    copy:
`What's ahead for ${co}?

📅 ${dateShort(rec)}

⏰ ${shortTime(rec)}
${label ? "" : `\n${subj}\n`}
Join ${peopleX} & @RedCloudFS${label ? ` for the ${lead} ${subj}` : ` for the ${lead} webinar`}:

${reg}`,
  });

  rows.push({
    when: "Day of", type: "LI/FB", asset: link("linkedin"),
    copy:
`${headline(rec)}

Join ${peopleC} and Red Cloud Financial Services for today's live webinar.

TODAY ⏰ ${longTime(rec)}: 
${reg}

${tags.join(" | ")}`,
  });

  rows.push({
    when: "Day of", type: "Twitter", asset: link("twitter"),
    copy:
`TODAY ⏰ ${shortTime(rec)}

Join ${peopleX} & @RedCloudFS for the ${lead} ${label ? `${subj} ` : ""}webinar.

Register: 
${reg}`,
  });

  rows.push({
    when: "Replay", type: "Interchangeable", asset: link("replayWebsite") || link("replayYoutube"),
    copy:
`🎬 Webinar Replay Now Available

ICYMI: ${people} joined @RedCloudFS${label ? ` for a ${subj}` : `.\n\n${subj}`}.

Watch the replay: ${replay}

${plain.join(" ")}`,
  });

  /* ── one per clip ─────────────────────────────────────────
     The clips are cut from the webinar and posted in the weeks after it, so
     each one carries the replay link rather than the registration link: by
     then there is nothing left to register for. The clip's own name is the
     hook — those are chosen by a person watching the recording. */
  const marks = Object.keys(rec?.clipJob?.marks || {});
  const usedQuotes = new Set();   // so overlapping clips never quote the same line
  for (const name of marks) {
    const hook = saysSomething(name);
    const quote = clipQuote(rec, name, usedQuotes);
    /* With a line from the clip, that line IS the post — the hook only has to
       say whose it is. Without one, fall back to the clip's name or the
       webinar's title. */
    const copy = quote
      ? (hook
        ? `🎥 ${name}

"${quote}"

— ${leadPresenter(rec)}, ${co}, from ${possessive(co)} webinar with @RedCloudFS.

Watch the full replay: ${replay}

${plain.join(" ")}`
        : `🎥 "${quote}"

— ${leadPresenter(rec)}, ${co}, in a clip from their webinar with @RedCloudFS.

Watch the full replay: ${replay}

${plain.join(" ")}`)
      : (hook
        ? `🎥 ${name}

${leadPresenter(rec)} on ${name}, from ${possessive(co)} webinar with @RedCloudFS.

Watch the full replay: ${replay}

${plain.join(" ")}`
        : `🎥 ${subj}

${leadPresenter(rec)} of ${co}, in a clip from their webinar with @RedCloudFS.

Watch the full replay: ${replay}

${plain.join(" ")}`);

    rows.push({ when: `Clip — ${name}`, type: "Interchangeable", asset: "", quoted: Boolean(quote), copy });
  }

  return rows;
}

/* ── the two ways it leaves the system ───────────────────────── */

const csvCell = (s) => `"${String(s == null ? "" : s).replace(/"/g, '""')}"`;

/** The content-calendar tab, as a CSV with that tab's own four columns. */
export function socialCsv(rec) {
  const d = dateCell(rec);
  const head = ["Date", "Type", "Link to Asset", "Social Copy"];
  const body = socialRows(rec).map((r) => [d, `${r.when} ${r.type}`.trim(), r.asset, r.copy]);
  return [head, ...body].map((cols) => cols.map(csvCell).join(",")).join("\r\n");
}

/** The same thing to read, for the content sheet and for /ops. */
export function socialText(rec) {
  const lines = [
    "SOCIAL COPY",
    "Paste into the client's content calendar. One row per post; the asset link",
    "is the exact graphic that post goes out with.",
    "",
  ];
  for (const r of socialRows(rec)) {
    lines.push("─".repeat(66));
    lines.push(`${r.when.toUpperCase()}  ·  ${r.type}${r.asset ? `  ·  ${r.asset}` : ""}`);
    lines.push("");
    lines.push(r.copy);
    lines.push("");
  }
  return lines.join("\n");
}
