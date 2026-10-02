import { api } from "./_http.mjs";
import { findAnalyst, FIRM } from "../analysts.mjs";
import { longDate, rememberPage } from "../record.mjs";

/* Step 4 — build the registration page. Also carries the two rules the written
   process says people get wrong: the StreamYard code has to appear TWICE in the
   Register Now button, and the last registration page must never be deleted
   because it is the template for the next one. Both are enforced here rather
   than remembered on the day. */

export const key   = "wordpress_reg";
export const label = "WordPress registration page";
export const steps = [4];
export const needs = ["WP_BASE_URL", "WP_USER", "WP_APP_PASSWORD", "WP_TEMPLATE_PAGE_ID"];
export const when  = "on-create";

const authHeader = () => ({
  authorization: "Basic " + Buffer.from(`${process.env.WP_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64"),
});

const base = () => String(process.env.WP_BASE_URL).replace(/\/+$/, "");

const slugFor = (tickers) => {
  const sym = String(tickers || "").split(/[|,;]/)[0].split(":").pop().trim().toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return `rcwebinar-${sym || "tbc"}`;
};

/** The 8-character StreamYard registration code, taken from the end of the link. */
export function codeFrom(streamyardUrl) {
  const m = String(streamyardUrl || "").trim().replace(/\/+$/, "").match(/\/([A-Za-z0-9_-]{4,})$/);
  return m ? m[1] : null;
}

/* The substitution itself, separate from the network calls, so it can be run
   against a record without touching WordPress — which is how the page is
   previewed before the template exists. */
export function fillTemplate(rec, templateHtml) {
  const f = rec.facts;
  let content = String(templateHtml || "");

  const analyst = findAnalyst(rec.schedule?.moderator);

  const swaps = [
    [/\{\{\s*COMPANY\s*\}\}/gi, f.company],
    [/\{\{\s*TITLE\s*\}\}/gi, f.title],
    [/\{\{\s*BIO\s*\}\}/gi, f.bio],
    [/\{\{\s*TICKERS?\s*\}\}/gi, f.tickers],
    [/\{\{\s*ANALYST_NAME\s*\}\}/gi, analyst?.name],
    [/\{\{\s*ANALYST_TITLE\s*\}\}/gi, analyst?.title],
    [/\{\{\s*ANALYST_FIRM\s*\}\}/gi, analyst ? FIRM : ""],
    [/\{\{\s*PRESENTER_NAME\s*\}\}/gi, (f.speakers || [])[0]?.name],
    [/\{\{\s*PRESENTER_TITLE\s*\}\}/gi, (f.speakers || [])[0]?.title],
    [/\{\{\s*DATE\s*\}\}/gi, longDate(rec)],
    [/\{\{\s*TIME\s*\}\}/gi, rec.schedule?.startTime || f.clientTime],
  ];
  for (const [re, val] of swaps) content = content.replace(re, val || "");

  const code = codeFrom(rec.schedule?.streamyardUrl);
  const codeSlots = (content.match(/\{\{\s*SY_CODE\s*\}\}/gi) || []).length;
  if (code) content = content.replace(/\{\{\s*SY_CODE\s*\}\}/gi, code);

  return { content, analyst, code, codeSlots };
}

export async function run(rec) {
  const f = rec.facts;
  const tpl = await api(
    `${base()}/wp-json/wp/v2/pages/${process.env.WP_TEMPLATE_PAGE_ID}?context=edit`,
    { headers: authHeader() },
    "WordPress",
  );

  let content = tpl.content?.raw ?? tpl.content?.rendered ?? "";

  /* substitute the facts we hold */
  /* The Red Cloud analyst hosting this one — picked in /ops, so their name and
     title are never retyped. An unset analyst leaves the placeholders empty
     rather than printing someone else's name. */
  const analyst = findAnalyst(rec.schedule?.moderator);

  const swaps = [
    [/\{\{\s*COMPANY\s*\}\}/gi, f.company],
    [/\{\{\s*TITLE\s*\}\}/gi, f.title],
    [/\{\{\s*BIO\s*\}\}/gi, f.bio],
    [/\{\{\s*TICKERS?\s*\}\}/gi, f.tickers],
    [/\{\{\s*ANALYST_NAME\s*\}\}/gi, analyst?.name],
    [/\{\{\s*ANALYST_TITLE\s*\}\}/gi, analyst?.title],
    [/\{\{\s*ANALYST_FIRM\s*\}\}/gi, analyst ? FIRM : ""],
    /* the client's own presenter, above the analyst on the page */
    [/\{\{\s*PRESENTER_NAME\s*\}\}/gi, (f.speakers || [])[0]?.name],
    [/\{\{\s*PRESENTER_TITLE\s*\}\}/gi, (f.speakers || [])[0]?.title],
    /* the page leads with the date and repeats it under DATE & TIME */
    [/\{\{\s*DATE\s*\}\}/gi, longDate(rec)],
    [/\{\{\s*TIME\s*\}\}/gi, rec.schedule?.startTime || f.clientTime],
  ];
  for (const [re, val] of swaps) content = content.replace(re, val || "");

  /* the code, in BOTH places — the documented failure is putting it in one */
  const code = codeFrom(rec.schedule?.streamyardUrl);
  let codeNote = "no StreamYard link on the record yet, so the Register button still needs its code";
  if (code) {
    const before = (content.match(/\{\{\s*SY_CODE\s*\}\}/gi) || []).length;
    content = content.replace(/\{\{\s*SY_CODE\s*\}\}/gi, code);
    if (before < 2) {
      throw new Error(
        `The WordPress template has ${before} SY_CODE placeholder(s); the Register Now button needs two. ` +
        `Add {{SY_CODE}} in both places in the template page (id ${process.env.WP_TEMPLATE_PAGE_ID}).`,
      );
    }
    codeNote = `StreamYard code written into both places`;
  }

  const body = {
    title: `${f.company} Webinar${f.title ? ` — ${f.title}` : ""}`,
    slug: slugFor(f.tickers),
    content,
    template: tpl.template || "",
  };

  /* ── update the page we made, never make a second one ────────
     This runs at submission, before the StreamYard link usually exists, so
     the first draft has no code in the Register button. Adding the link and
     re-running is the normal path — and it used to POST a new page every
     time, leaving a trail of near-identical drafts to delete by hand.

     The page id is remembered, so a re-run edits that page instead. Status is
     only forced to draft on FIRST creation: once a person has reviewed and
     published it, a later re-run must not quietly unpublish their work. */
  const existingId = rec.pages?.wordpress;
  let page = null;

  if (existingId) {
    try {
      page = await api(
        `${base()}/wp-json/wp/v2/pages/${existingId}`,
        { method: "POST", headers: { ...authHeader(), "content-type": "application/json" }, body: JSON.stringify(body) },
        "WordPress",
      );
    } catch (err) {
      /* deleted in WordPress — fall through and make a fresh one */
      if (err.status !== 404) throw err;
      page = null;
    }
  }

  if (!page) {
    page = await api(
      `${base()}/wp-json/wp/v2/pages`,
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ ...body, status: "draft" }),   // never self-publishes
      },
      "WordPress",
    );
    await rememberPage(rec.id, page.id);
  }

  const action = existingId && page.id === existingId ? "updated" : "created";
  const who = analyst
    ? `${analyst.name} listed as the Red Cloud presenter`
    : "no Red Cloud analyst chosen yet — set one in /ops and re-run this step";

  return {
    detail: `Registration page ${action} at /${page.slug} — ${codeNote} — ${who}`,
    ref: page.link || `${base()}/?p=${page.id}`,
  };
}

export async function check() {
  const me = await api(`${base()}/wp-json/wp/v2/users/me?context=edit`, { headers: authHeader() }, "WordPress");
  const tpl = await api(
    `${base()}/wp-json/wp/v2/pages/${process.env.WP_TEMPLATE_PAGE_ID}?context=edit`,
    { headers: authHeader() },
    "WordPress",
  );
  const raw = tpl.content?.raw ?? "";
  const codes = (raw.match(/\{\{\s*SY_CODE\s*\}\}/gi) || []).length;
  const warn = codes < 2
    ? ` WARNING: the template has ${codes} {{SY_CODE}} placeholder(s) — the Register Now button needs two.`
    : "";
  return `Connected as ${me.name}. Template page "${tpl.title?.raw || tpl.title?.rendered}" found.${warn}`;
}
