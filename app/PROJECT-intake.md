# Red Cloud — Webinar Intake & Graphics

Reference for building on another machine and bringing the work back. **This
repo is the source of truth and lives here.**

Live: <https://redcloud-webinar-form.netlify.app> · Netlify project
`redcloud-webinar-form`.

**Ops console: `/ops.html`.** It takes the token in the URL *fragment* —
`/ops.html#t=<OPS_TOKEN>` — so one saved bookmark signs you in. Fragments are
never sent to the server and never appear in logs, so the bookmark itself is
the key: treat it like a password. The page wipes the fragment from the address
bar as soon as it reads it, so the token is not on screen during a screen-share.
Typing the token into the gate still works. `OPS_TOKEN` lives in the Netlify
environment; changing it there invalidates existing bookmarks.

---

## 1. What it does

A client fills in one page. Everything after that is automatic:

1. The client enters **only their website**. The rest of the form stays hidden.
2. `company-profile` reads the site and recent press releases, and returns
   company name, tickers, commodity, senior management (with roles and bios),
   headline suggestions and the logo URL. The form fills itself in.
3. They pick speakers from a dropdown and upload headshots. The webinar
   **date and time are pre-booked by Red Cloud** and arrive in the link — see
   "Sending the form" below — so the client reads the slot, never picks it.
4. On submit, the record is stored, files go to **Box**, and **8 graphics are
   drawn immediately** — no human, no Canva.
5. Time-based connectors (emails, Mailchimp) fire later off the schedule.

### Sending the form to a client

**Open the form itself with `?setup`:**

```
https://redcloud-webinar-form.netlify.app/?setup
```

A dark Red Cloud-only bar appears above the form. Set the webinar date and the
Eastern time there and the client's banner **updates underneath as you type**,
so what you are looking at is exactly what they will get. Add their email and
first name, then send. The link you hand out never carries `?setup`, so the bar
can never appear for a client.

The same panel also exists at the top of `/ops.html` if you are already in
there. Both give you the same buttons:

- **Open email draft** — opens your own mail app with the address, subject and
  a written message already in it. You press send.
- **Copy link** / **Copy message** — for pasting into an existing thread.

Nothing is emailed by the server. There is no mail provider configured
(`RESEND_API_KEY` / `MAIL_FROM` are unset), and an invitation coming from a
real person's address that the client can simply reply to is better anyway.

The link it builds is just this, so you can also write it by hand:

```
https://redcloud-webinar-form.netlify.app/?date=2026-09-24&time=11:00
```

`date` is `YYYY-MM-DD`; `time` is 24-hour **Eastern**, on the half hour between
08:00 and 18:00.

The slot then appears as a banner **directly above the website box** — the
first thing on the page, because a client wants the booking confirmed before
doing any work. It reads e.g. *Thursday, September 24, 2026 — 11:00 AM ET ·
8:00 AM PT*, and tells them to reply by email if it is wrong.

The date/time fields further down are hidden when both parameters are present,
since they would only repeat it. They stay in the DOM, so their values still
submit. With one parameter, or none, they stay visible and editable — which is
what internal tests use.

---

## 2. Running it locally

```bash
npm install
npx netlify dev
```

Deploy:

```bash
npx netlify deploy --prod --dir public
```

> `npm install` on macOS pulls the darwin resvg binary. Netlify runs Linux, so
> `@resvg/resvg-js-linux-x64-gnu` is a hard dependency in `package.json` and the
> darwin one is **excluded from the bundle** in `netlify.toml`. Deploying the
> macOS binary took the whole site down with a 502 once — every function that
> imports the connector list failed to load.

Health check without deploying:

```bash
node -e 'import("./netlify/shared/connectors/graphics.mjs").then(m=>m.check()).then(console.log)'
```

Expect: `Ready. Draws 8 graphics locally, no Canva. Text renders (+6137 bytes).`
The byte delta is the point — see §7.

---

## 3. Layout of the repo

```
netlify/functions/     HTTP endpoints (one file = one route)
netlify/shared/        everything reusable
  record.mjs           the record store + all date/time handling
  connectors.mjs       the connector registry
  connectors/*.mjs     one integration each
  art/layouts.mjs      per-template geometry — EDIT THIS to move things
  art/render.mjs       SVG build, fonts, logo/photo analysis
  art/cutout.mjs       background remover + PNG encoder
  art/assets.mjs       plates + fonts, base64 (see §6)
  scrape.mjs           SSRF-safe site reading
public/index.html      the client form
public/ops.html        internal console
```

---

## 4. The connector pattern

Every integration is one file exporting the same shape:

```js
export default {
  key: "graphics",              // stable id, used by /ops retry
  label: "Webinar graphics",
  steps: [5],                   // which checklist steps it satisfies
  needs: [],                    // env vars; missing => state "off"
  when: "on-create",            // or { offsetMinutes: -1440 }
  rebuildOnSchedule: true,      // redraw when the date changes
  slow: true,                   // dispatch to a background function
  async run(rec) { ... },
  async check() { ... },        // shown on /ops
}
```

**A connector missing its env vars reports `off` and can never block another
one.** That is why the site runs today with only Box and graphics configured.

Live state (verified 2026-08-26):

| Connector | When | State |
|---|---|---|
| `box_storage` File to Box | on-create | **on** |
| `graphics` Webinar graphics | on-create | **on** |
| `social` Social copy | on-create | **on** |
| `trello` Trello card | on-create | off |
| `wordpress_reg` Registration page | on-create | off |
| `invites` Calendar invites | on-create | off |
| `mailchimp` Invite eblast | T−10080m | off |
| `send_distribution` | T−10020m | off |
| `send_tech_test` | T−4320m | off |
| `send_day_before` | T−1440m | off |
| `send_links` | T−60m | off |
| `send_replay` | T+240m | off |

The `off` ones need `RESEND_API_KEY` + `MAIL_FROM` (all five emails and
invites), or their own keys.

> `clip-jobs.mjs`, `clip-preview.mjs`, `clips-view.mjs`, the `clips` action and
> `public/clips.html` are **Clip Studio** — live, not dead code. They are the
> control plane for the webinar-to-social-clips pipeline; the work itself
> (transcribe, suggest, cut, export to Box) runs on the Mac mini in
> `~/rc-clips/bin` (`rcworker.py`, `rcbundle.py`, `rcedges.py`, `rcbox.py`).
> `/api/clips` is deliberately ungated and returns no personal data;
> `/api/clip-jobs` needs `WORKER_TOKEN`. Clip edges are settled against the
> audio at cut time (`rcedges.py`), not taken from transcript timecodes, which
> run up to ~2s off. Full notes: vault `entities/rcworker.md`.

---

## 5. Time handling — read before touching dates

`startTimeISO` is the **single source of truth**. Everything else derives.

- `startOf(rec)` → Date or `null` (null for missing *and* malformed)
- `dateKey(rec)` → `2026-09-24` in Red Cloud's timezone
- `longDate(rec)` → falls back to `facts.clientDate`, then `"TBC"`

**Always format in `DISPLAY_TZ` (`America/Toronto`).** Naive UTC formatting
prints *tomorrow's* date for any evening ET webinar. There is a test for this.

An earlier version read `schedule.date` which was never written — calendar
invites were structurally unreachable and every dated email said "TBC".

Folder names use the **submission** date, not the broadcast date, because the
broadcast date changes. The folder id is remembered and self-heals if deleted.

---

## 6. Graphics

Seven templates, all drawn locally with `@resvg/resvg-js`. Canva was abandoned
at runtime — Brand Templates and Autofill are Enterprise features behind a
metered quota that ran out.

| Template | Size | Scale |
|---|---|---|
<!-- all seven plates are the LIGHT variant (Canva page 2, text stripped) -->
| LinkedIn/FB | 1200×1200 | 1.3 |
| Invite small | 2500×3958 | — |
| Invite large | 2500×4534 | — |
| Twitter | 1600×900 | 1.0 — **the reference** |
| Instagram | 1080×1350 | 1.3 |
| Replay – website | 1280×720 | 1.35 |
| Replay – YouTube | 1280×720 | 1.05 |
| Webinar thumbnail | 1280×720 | — (no text) |

### The webinar thumbnail

The tile that fronts the webinar on the website and on YouTube. It carries the
client's logo and **nothing else** — no date, no title, no presenter. Anything
more is unreadable at the size a thumbnail is actually seen, and the page
around it already says all of it.

Built from the Canva original (the Skyharbour thumbnail of 14 January 2026):
plate `thumbnail`, dark band `#241F20` across the bottom 72px, logo slot
566×260 centred on **x 640, y 324** — the middle of the space *above* the band,
not the middle of the canvas. 566 wide reproduces the original exactly, because
a wide mark is width-limited; a square mark hits the 260 cap instead and stays
clear of the band.

If a record has no usable logo this template is **not built at all** — it would
upload as a bare background, which looks finished and is not. The run says so:
*"Webinar thumbnail 1280x720 NOT built: that template is the logo and nothing
else."* Fix the logo (`logo` action in `/ops`, pointing at a PNG or JPEG) and
re-run graphics.

This is the one template where `logo.trim` is on. Client logo files carry wildly
different amounts of empty space around the mark, so fitting the *file* to the
slot draws one company's logo half the size of another's. With `trim`, the ink
is measured (`inkBox`) and the file is scaled and offset so the **mark** lands
in the slot. Every other template is untouched: with no `trim` the fractions are
0,0,1,1 and the arithmetic reduces to exactly what it was.

Rules baked in:

- Type scale: every template carries its own `scale` in `layouts.mjs`. Twitter is the 1.0 reference the others were measured against.
- **Everything uppercase except** `company_website` and `company_bio`.
- The **logo** is always transparent, and is **reversed to white** when it
  would otherwise disappear — decided by measuring the actual plate pixels
  under the slot (`slotLuminance`) against the logo's own luminance.
- The **headshot appears on the YouTube replay tile only**. Every other
  template uses the logo. Exactly one layout carries a `headshot` slot, and
  `check()` fails loudly if that count ever changes.
- **Every plate is the LIGHT variant.** `check()` measures each one and refuses
  if any scores below 0.35 luminance. Measured: the dark variants sat at
  0.21–0.27, the light ones at 0.41–0.79, so a wrong re-export is caught with
  margin on both sides.
- **A logo with too little contrast is fixed one of two ways**, chosen by
  measuring how colourful it is (`chroma`, the mean distance from grey):
  - **one-colour mark** (`chroma < 0.10`) → recoloured to a flat white or
    near-black silhouette, keeping its exact shape. This is *not* an RGB
    inversion: inverting flips hue too, so a navy-and-gold logo came back pale
    yellow and blue — visible, and not the client's brand.
  - **coloured mark** → colours left completely alone; a rounded panel is drawn
    behind it instead, which is what most brand guides ask for anyway. **The
    panel is always light** — white at 95% with a hairline edge. It used to go
    black whenever the artwork under the slot was light, and six of the seven
    logo slots sit on light artwork, so a pale coloured logo would have put a
    black slab on nearly every template.

  Measured on Instagram's dark panel: a black mark goes from 0.165 to 0.510
  luminance with chroma unchanged; a navy/gold mark reaches 0.752 on its panel
  with its own colours intact.
- **Ticker `fitWidth` is the width of the WHITE area, measured off each
  plate** — not the canvas. Right-aligned text grows leftwards, so without
  this a four-listing ticker runs under the red WEBINARS badge:
  Twitter 960 · LinkedIn 710 · Invites 1340 · Instagram 590.
  **Re-measure these if a plate is ever redesigned.**

### More than one presenter

The form asks **How many presenters?** (1–3) and shows that many speaker blocks.
Dropping the count clears the hidden blocks, because a hidden block still
submits and would reappear on the graphics.

`fieldsFor` passes every presenter as a `{ name, title }` pair in
`fields.presenters`. With one presenter the template's own name/title pair is
used. With two or three, `presenterColumns()` in `render.mjs` lays them out side
by side — name on top, role beneath, a thin crimson rule between — matching the
designed Valor Gold tile. (It used to fold speaker 2 into the lead's title line,
so Serdar Donmez read as part of Jordan Trimble's job title.)

Sizing is solved, not taken from the worst column: each column needs its name on
one line and its role split across at most two, every width scales with the
type size, so the largest size that fits the row is one division. All columns
share that size. A containment pass then guarantees nothing runs past the space
— text off the canvas is worse than smaller type. `draw()` and `collisions()`
both call `presenterColumns()`, so what is checked is what is drawn.

Per-template room is `presenterColumns.width` in `layouts.mjs`: Twitter stops
before the website bar (790), LinkedIn stops before the logo (515, which is why
names there run smaller). Measured with real names: two presenters keep full
size on Twitter and the invites; three typical names still fit at full size on
Twitter. Very long names on the narrow templates (LinkedIn, YouTube) shrink
noticeably — readable at full resolution, small as a thumbnail.

### Logo when none is supplied

If nothing usable was uploaded or picked on the form, the graphics step reads the
company's website and tries every image **the page itself calls a logo** (tag or
filename says logo/brand, or JSON-LD logo) — best first, preferring a normal mark
over a white one. Icons and photos are excluded: without that filter Skyharbour's
list ran on into `people-icon.svg`, which would have been accepted as the logo. A
client's own upload is never overridden. SVG logos are rasterised with resvg
rather than refused. WebP still cannot be drawn — Valor Gold and Rio Grande only
serve WebP, so they need a PNG from the client or a hosted conversion.

### Background remover (`cutout.mjs`)

**What it can and cannot do.** It separates a person from a backdrop that
differs from them in colour, or is divided from them by a visible seam. It
cannot separate a white shirt from a white wall when the two meet with no
colour difference and no measurable gradient — that needs to know what a person
is, which is a segmentation model, not arithmetic. Jason Barnard's photo is
that case, measured: the edge threshold bottoms out at 0.05 and the fill still
walks into his shirt, taking half his torso.

**Take the gentlest acceptable cut, never the largest.** `removeBackground`
tries no-inset before inset and low tolerance before high, and stops at the first
cut that passes. For a while it kept the cut that removed the *most*, which was a
regression: more removal is what a cut that has broken into the person looks
like. On synthetic portraits it chose an 18px inset that shaved 11% off the suit,
and against a blue wall it deleted 98.7% of a navy suit while every check passed.
Insets also clear top and sides only — the bottom band is the shoulders.

**Torn silhouettes are declined.** A cut can clear the backdrop, keep the whole
person and still look torn: Jordan Trimble's photo had dark objects in the room
behind him that didn't match the light wall, so they stayed fused to his suit as
shards. `shardLoss()` measures how much of the lower 55% of the silhouette a
morphological opening removes (thin protrusions go, shoulders stay); above
`SHARD_LIMIT` (0.004) the photo is framed as a portrait instead. Measured: Jordan
0.0089, clean synthetic portraits 0.0000, shards glued to a synthetic shoulder
0.0404. The limit is calibrated on one real photo — revisit it as more real
headshots come through, especially any good cut-out that gets declined.

When a real separation is not possible the photo is **framed as a circular
portrait** instead. That is deliberate: a bare rectangle with the backdrop
still in it reads as a cut-out that failed, whereas a circle reads as a
headshot and works for any photo. A cut that removes less than 15% is treated
as no cut at all — 5% is a decorative border coming off, not a person being
separated.

Flood-fill from the border against the **median border colour**. Comparing each
pixel to the one it spread *from* is a connected-gradient walk that removed
99.9% of the image.

Two rules that are easy to get wrong and were both wrong once:

1. **The cut falls just outside the edge.** Background pixels touching the
   subject are handed back before anything is deleted; feathering then softens
   *outward only*. Feathering inward fades the person's own outline and
   produces a chewed silhouette.
2. **Plausibility measures the top and upper sides only.** A normally framed
   headshot has shoulders running off the bottom edge — that border *is* the
   subject and can never clear. Counting it scored a clean portrait at 64.6%
   against a 90% threshold and rejected a perfectly good cut.

Tolerance escalates gently: `0.05 → 0.07 → 0.09 → 0.12 → 0.16 → 0.20`, first
credible cut wins. If none is credible the photo is drawn as supplied and the
record says so — it never mangles a face silently.

Measured retention (synthetic head-and-shoulders, five backdrops incl.
navy-on-blue and black-on-dark): **face 100%, suit 100%, background 95–99%
cleared, zero hair strands erased.**

---

## 4a. Social copy


Every webinar gets its posts written from the record, so nobody retypes a
presenter's title or a ticker into a client's feed. Five posts, plus one for
every clip cut from the recording:

| | Channel | Carries |
|---|---|---|
| Look Ahead | LI/FB | date, time, presenters, **register** |
| Look Ahead | Twitter | short date/time, lead cashtag, **register** |
| Day of | LI/FB | TODAY + time, **register** |
| Day of | Twitter | TODAY + time, **register** |
| Replay | interchangeable | ICYMI, **watch the replay** |
| Clip — *name* | interchangeable | the clip's own name, **watch the full replay** |

They read differently on purpose — the look-ahead sells the date, the day-of
sells urgency, the replay sells what was missed — and every one of them ends on
a call to action.

**Where it goes.** Two files into the client's Box folder next to the graphics:
`— social copy.csv`, which has the content calendar's own four columns
(`Date | Type | Link to Asset | Social Copy`) so it pastes into that tab whole,
and `— social copy.txt` to read. `/ops` shows the same posts with a Copy button
on each.

**Shapes are Red Cloud's own**, copied from the Skyharbour sheet of 7 October
2026 — the emoji, the blank lines, the trailing space after `Register now:` that
puts the link on its own line. Do not tidy them; they are posted as written.

Rules worth knowing before editing `shared/social.mjs`:

- **Cashtags.** Purely numeric listings (`FSE: 488`) are dropped — they are not
  cashtags and nothing resolves them. TSXV takes the `.v` suffix on LinkedIn and
  Facebook and not on Twitter, which is how Red Cloud writes them. No other
  exchange gets a suffix: inventing one puts a symbol in a client's feed that
  does not exist.
- **Titles.** A short label ("Corporate Update & Outlook") slots into a sentence;
  a headline ("How Skyharbour Turns 44 Athabasca Projects Into Partner Funding")
  does not, and is given its own line instead. Five words is the cut-off.
- **Roles are shortened** — "President, CEO, Director" becomes "CEO" — but only
  where there is a known short form. Anything else is left exactly as the client
  wrote it.
- **Clip names.** Clips get named by whoever marked them up, and in practice
  that is as often "Clip 1" or "Intro Clip" as it is "Maverick drilling". A name
  that says something becomes the post's hook; a filing label does not — strip
  the filing words and the digits, and if fewer than two real words survive the
  webinar's own title carries the post instead and the clip name is not shown.
- **The links.** `registrationUrl` and `replayUrl` are set in `/ops`. With no
  registration link the copy guesses `redcloudfs.com/events/<company-slug>/`;
  with no replay link it reads `[REPLAY LINK]`, exactly as the hand-written
  sheets do. The run says which are still placeholders.
- **Asset links** come from `rec.assets`, written by the graphics connector —
  which is why `social` is registered after it. Run graphics first or the Link
  to Asset column is empty.

---

## 4b. The invite eblast

`shared/eblast.mjs` builds the Mailchimp invite from the record: the invite
artwork, the date and time, the presenters, the bio, and a Register button
pointing at the registration page. One 600px table, inline styles, written for
Outlook. Mailchimp's merge tags (`*|UNSUB|*`, `*|LIST:ADDRESS|*`) are in the
footer, because a campaign without them cannot be sent.

**The format is the team's, exactly.** `shared/eblast-template.mjs` is their own
invite with eight placeholders (title, company, date line, presenters, two bio
paragraphs, the Register link, the image). It matches *Pipeline Proof Co -
Webinar Invite - Push 1* (Mailchimp `00c2b5fc4c`), which the team set as the
example: their Japan Gold / Skyharbour invite with the bottom 1600×900 X card
removed. Filled with Japan Gold's values it reproduces that example **byte for
byte** — re-run that comparison after any edit to the template. The Twitter/X
1600×900 graphic is still drawn and filed in **Box** like the rest — it is only
kept **out of the email**.

**The design in use: "mixed"** (`EBLAST_DESIGN` in `shared/eblast.mjs`, approved by
Cliff and Marty on 2 Oct 2026 from test draft 9409355). Dark hero with the white
logo, white body, the Date / Time / Format details as a dark band (each value on two
deliberate lines), and the newsletter's dark footer. `"light"` (all light) and
`"team"` (the team's own invite, the Pipeline Proof Co example) are still there and
are one word away. The notes below describe the newsletter look all three share.

**The newsletter look** (originally tried as an all-dark version, judged too heavy). Modelled on *Bi-Weekly 2026-10-01 - TEST
(Cassandra + Marty)*: charcoal `#1d1d1f`, Montserrat, letter-spaced eyebrows
behind a 40×3 red bar (`#d7192a`), a crimson `#8d1e2b` "REGISTER NOW →", and the
newsletter's own footer — carrying every piece of the team invite's information.
Its two images come from `art/email-art.mjs`, drawn per webinar by the graphics
run: a hero (white logo, "WEBINAR INVITE · date", "RED CLOUD WEBINAR SERIES
PRESENTS", the company, "LIVE WEBINAR." in red, the title) on a contour-line
plate generated to match the newsletter's texture (`art/email-assets.mjs`), and
the webinar thumbnail in the newsletter's red corner brackets with its dark band
cropped off. All the facts are also in the HTML, so it reads with images off.
/ops previews either design: `{ action: "eblast", design: "dark" }`.

**Artwork has to be public.** The graphics are in a private Box folder and a
mail client fetches images anonymously, so the graphics run draws the invite
template a second time at email width (1000px — drawn at that size, not scaled
down, so the type stays sharp) and puts it in a blob store. `/art/<token>.png`
serves it. The token is random rather than the record id: ids are predictable
and a webinar's artwork is confidential until it is announced.

**When it runs.** On submission, straight after the graphics, so the draft is
waiting by the time anyone looks. It used to wait until a week before broadcast
and needed a confirmed time; it no longer does — it uses the date and time the
client gave and refreshes when you confirm one.

**It is only ever a draft.** Nothing in `connectors/mailchimp.mjs` sends or
schedules a campaign. The test send, Marty's approval and scheduling are a person
pressing a button in Mailchimp.

**A NEW campaign, not a replicate — this matters.** The template campaign
(`MAILCHIMP_TEMPLATE_CAMPAIGN_ID`) is read for its **audience, segment, from-name
and reply-to**, and a plain campaign is created with those. It used to replicate,
which was a real failure: a campaign built from a Mailchimp *template* silently
ignores a pasted `html` body — the PUT returns 200, the draft keeps the
template's old content, and a test email went out with Skyharbour's subject and
Japan Gold's graphic. Nothing in the response says so.

**So the body is verified, not assumed.** After writing, the draft is read back
and must contain this webinar's company name and its artwork address, or the run
**fails** and says the draft must not be used. Never report a Mailchimp write as
done on the strength of a 200.

The template campaign therefore only has to be one with the right list and
sender; its layout is never used. Title is
`<Company> - Webinar Invite - Push 1`.

**One draft per webinar, ever.** The campaign id is saved on the record
(`rec.campaigns.mailchimp`) before anything else can fail, so a retry updates it
rather than replicating a second. When the graphics are redrawn, or a broadcast
time is confirmed, the same draft is refreshed — and the refresh waits for the
new artwork (`after = "graphics"`, chained in `run-connector-background`), so the
email never goes out showing last week's date. It only chains for a webinar that
already has a draft; redrawing an old record's graphics creates nothing.

**What a rebuild will NOT touch** (it reports why instead):
- anything that is not a plain draft — scheduled, sending, sent, paused;
- a draft a person has edited in Mailchimp. The content Mailchimp holds is
  hashed once it has *settled* (it reformats what we PUT, and a read straight
  after the write does not match what it settles to — two identical reads in a
  row are required) and compared next time. No baseline means it cannot be shown
  untouched, so it is left alone;
- a draft that was deleted in Mailchimp. Same lesson as the Box folders: putting
  it back is the bug. Resubmit for a new one.
Subject and preview text are refreshed on an update; the **title is not**,
because renaming a draft is the first thing anyone does to it.

**Each connector is handed the record as it now stands**, not as it was at
submission (`submission-created-background.mjs`). Without that the graphics step's
saved artwork address and Box file ids were invisible to the connectors after it.

Mailchimp is **off** (no `MAILCHIMP_API_KEY`), so until it is on, `/ops` →
**Copy invite email** hands over the identical HTML and subject line. In
Mailchimp: new campaign → *Code your own* → *Paste in code*.

---

## 5a. The WordPress registration page

`wordpress_reg` copies a template page, substitutes the facts, and creates a
**draft** — it never publishes. Placeholders in the template page:

| Placeholder | Filled with |
|---|---|
| `{{COMPANY}}` `{{TITLE}}` `{{BIO}}` `{{TICKERS}}` | the client's submission |
| `{{PRESENTER_NAME}}` `{{PRESENTER_TITLE}}` | the client's speaker 1 |
| `{{ANALYST_NAME}}` `{{ANALYST_TITLE}}` `{{ANALYST_PHOTO}}` `{{ANALYST_FIRM}}` | the Red Cloud analyst chosen in `/ops` |
| `{{SY_CODE}}` | the StreamYard code — **must appear twice** |

The analyst roster lives in `shared/analysts.mjs` and is served to `/ops`, which
renders it as a dropdown beside the broadcast time. Titles are therefore never
retyped. Add or remove people by editing that one file; `photo` takes a
WordPress media URL and is safe to leave empty.

Two rules the connector enforces rather than trusting to memory: the StreamYard
code appears in **both** places in the Register button (it refuses if the
template has fewer than two), and the last registration page is the template for
the next one, so it must not be deleted.

The page is built on submission, before a StreamYard link usually exists. A
re-run **updates the page it already made** (the id is remembered on the record)
rather than leaving a trail of near-identical drafts, and it only forces `draft`
status on first creation — once someone has published the page, a re-run will
not quietly unpublish their work.

### The paste route — what to use today

`wordpress_reg` cannot run at all on the live site: WP Engine strips the
`Authorization` header before PHP sees it, so every `/wp-json/` call comes back
as `401 rest_not_logged_in` no matter how the credentials are sent. Until that
ticket lands, the page is **handed over instead of created**:

    /ops → a webinar → "Copy registration page HTML"

That calls `action: "regpage"`, which renders `shared/regpage.mjs` from the
record and returns one self-contained block. Paste it into a new WordPress page
as a single **Custom HTML** block, slug `rcwebinar-{ticker}`. No Elementor, no
JetEngine, no plugin.

Every size, weight and colour in `regpage.mjs` was **measured** off a real Red
Cloud page — the 19 Jan 2026 Skyharbour page, read back through the Wayback
Machine, because the live pages are deleted after each webinar (step 21 of the
written process) and none was still up to copy from. Do not "tidy" those
numbers; they are the design:

| | |
|---|---|
| eyebrow "Webinars" | 12px / 700, letter-spacing 2px, uppercase, white |
| hero date | 20px / 700, uppercase, white |
| company | 45px / 700, uppercase, white, line-height 50 |
| hero title | 25px / 400, uppercase, white, line-height 41 |
| Register Now | 12px / 700, ls 2px, white on `#8D1E2B` |
| section headings | 30px / 700, uppercase, `#8D1E2B` |
| presenter name | 20px / 700, `#8D1E2B`, **not** uppercase |
| presenter role / firm | 16px / 500, `#333` |
| DATE & TIME heading | 16px / 700, uppercase, `#8D1E2B`; value 18px / 500 |

Presenters are **stacked**, each with their firm underneath — the client's
speakers first, the Red Cloud analyst last. Hero background, Red Cloud logo and
client logo are the site's own media URLs (`HERO_BG`, `RC_LOGO` in the module).

Two things the block cannot carry, and the button says so when you press it:
the **Questions form** is an Elementor Pro form, so paste the site's existing
one where the comment marks the spot; and a **client logo** only appears if the
record has one.

When the header problem is fixed, nothing here is wasted — the same string can
be POSTed straight to `/wp-json/wp/v2/pages`.

---

## 6a. Reading the client's website

`scrape.mjs` fetches the home page, then follows links in **team-first** order —
the speakers dropdown is what clients notice missing, so when the time budget
runs out it is news that gets cut, not people.

Three things make the management list reliable:

- **Two-tier team patterns.** `TEAM_STRONG` (team, management, leadership,
  directors, board, bios, officers, senior…) is tried before `TEAM_WEAK`
  (about, corporate, governance, company), because `/about/` used to match
  before `/about/our-team/`.
- **One hop deeper.** A generic hub like `/about/` usually only links onward to
  the real management page. Up to two `TEAM_STRONG` links found *on that hub*
  are followed. This is what finds Mink's `/corporate/directors/` on top of
  `/corporate/management/`.
- **Sitemap fallback** to reach an actual press release when the news index is
  a JS-rendered list.

Verified reach: Valor Gold `/about/our-team/` (previously returned nobody),
Skyharbour `/corporate/?scroll=team`, Mink `/corporate/management/` **and**
`/corporate/directors/`.

---

## 6c. Riverside lives in the webinar pipeline, not here

Riverside (and the rest of the new webinar automation) is built in its own repo,
`~/webinar-pipeline` → `redcloudportal/webinar-pipeline`, running on the
DigitalOcean server separate from the portal. It was briefly started here as a
dormant connector on 2 Oct 2026 and moved the same day. Nothing of it remains in
this site. See that repo's PROJECT.md.

---

## 6b. Box folder names carry the WEBINAR's date

`<Company> — YYYY-MM-DD`, where the date is the **broadcast** date: the
confirmed one if Red Cloud has set a time, otherwise the date the client gave
on the form. It is **not** the submission date — anything booked more than a
week ahead would then sit under the wrong month, and the portal's attendee-list
import keys off the folder date too.

If the broadcast moves, the next run **renames the folder in place**. The id
does not change, so nothing already filed moves and no share link breaks. A
rename that collides with an existing folder of that name is logged and stepped
over rather than failing the run — the old name is wrong but harmless, and the
two folders need merging by hand.

Only when a record has no date of any kind does it fall back to the submission
date, which is rare: the form asks for one.

---

## 7. Traps that have already cost a day

- **`fontBuffers` silently does nothing on Linux.** It works on macOS. Netlify
  returned perfectly valid PNGs of *bare templates*. Fonts must be written to
  `os.tmpdir()` and passed as **`fontFiles`**. `check()` now renders with and
  without text and compares byte sizes — that delta is the only honest proof
  text actually drew.
- **Don't add plates/fonts to `included_files`.** They're base64 in
  `assets.mjs` already; declaring them too put 12.7MB of duplicates in every
  function and made bundles 13.4MB.
- **Filter order for the logo: knock out the background FIRST, then invert.**
  Inverting first turns a white background black and the knockout then removes
  the artwork instead of the backdrop.
- **Box 409 "item name is reserved"** when many regenerations run at once —
  Box locks a filename while processing. Harmless; retry the affected record.
- **Box Service Account has its own empty Box** and must be *invited* to
  folders. It also refused to create folders inside externally-accessible
  folders, so client folders sit at Box root.
- **Deleted Box folders stay deleted.** `resolveClientFolder` used to treat a
  missing folder as an accident and recreate it, so every rebuild put deleted
  test folders straight back. A 404 on a remembered folder now writes a
  tombstone (`rec.foldersGone.box`) and the connector returns `skipped`. A new
  submission is unaffected — it has no remembered folder and no tombstone.
- **Don't blanket-retry every record.** Retry the specific record you changed.
  Twelve at once also trips the Box 409 name race above.
- **The logo is `rec.logoFiles`, never `files[0]`.** `files` holds the logo,
  then brand assets, then headshots, and the graphics connector used to take
  the first entry. Tick "use the logo from our website" and upload a headshot
  and there is no logo file, so `files[0]` was the HEADSHOT — drawn into the
  logo slot on every graphic. Headshot URLs are now excluded explicitly,
  including on old records that predate `logoFiles`.
- **The headshot is used exactly once**, on the YouTube replay tile, for
  speaker 1 only.
- **WebP logos cannot be drawn.** resvg does not decode WebP, and most
  WordPress sites now serve exactly that (Rio Grande's only logo is a `.webp`
  with no PNG original on the server). The record now says so in plain words
  instead of silently omitting the logo. A real fix needs a WASM decoder wired
  up for Node AND bundled for Netlify — `@jsquash/webp` fetches its `.wasm` at
  runtime and does not work under Node as-is.
- **Plates: Canva page 1 is the DARK variant, page 2 is the LIGHT one.** Both
  pages carry text, so neither is usable as a plate directly — the plates in
  `assets.mjs` are separately-cleaned backgrounds with every text element
  stripped (page 1 still has a "LOGO" placeholder baked in; the plates do not).
- **Fetch as a browser, not as a bot.** The scraper introduced itself as
  `RedCloudWebinarForm/1.0`, and Cloudflare and most WAFs 403 an unrecognised
  agent on sight — clients pasted a perfectly good website and were told we
  could not read it. `BROWSER_HEADERS` in `scrape.mjs` is used by every fetch;
  don't add a new one without it. A 403 now says the site blocked us rather
  than "check the address", which sent people hunting a typo that wasn't there.
- **One Box folder per company per submission day.** Two submissions from the
  same company on the same day (Skyharbour, 2026-09-15) share one folder, so the
  second overwrites the first's `submission.json`, content sheet and graphics.
  Older versions survive in Box version history. Fix: add the record's short
  suffix to the folder name.
- **A lucky test case hides bugs.** Skyharbour had management on its homepage
  *and* a clean ticker footer, masking two separate scraper bugs. Verify by
  *measuring output* — bytes, pixels — not by "it ran without throwing".

---

## 8. Environment variables

Set in the Netlify UI. **Never paste a secret into a shell command** — it lands
in shell history and in the transcript.

Currently required:

| Var | For |
|---|---|
| `OPS_TOKEN` | the `/ops` console — without it ops returns 503 |
| `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` | Box server-to-server auth |
| `BOX_SUBJECT_ID` / `BOX_SUBJECT_TYPE` | Box enterprise subject |
| `BOX_FOLDER_ID` | parent folder for client data |
| `ANTHROPIC_API_KEY` | company profile lookup |
| `ANTHROPIC_MODEL` | optional override |
| `DISPLAY_TZ` | defaults to `America/Toronto` |

Optional, each unlocking its connector: `RESEND_API_KEY`, `MAIL_FROM`,
`MAILCHIMP_API_KEY`, `MAILCHIMP_TEMPLATE_CAMPAIGN_ID`, `TRELLO_KEY`,
`TRELLO_TOKEN`, `TRELLO_LIST_ID`, `WP_BASE_URL`, `WP_USER`,
`WP_APP_PASSWORD`, `WP_TEMPLATE_PAGE_ID`, `WORKER_TOKEN`,
`CANVA_*` (unused at runtime).

Google Drive filing was removed on 31 Aug 2026 — it duplicated step 25, which
Box already does. `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` and
`GDRIVE_FOLDER_ID` are no longer read by anything and can be deleted from the
Netlify environment.

---

## 9. Working on another machine

1. `git clone` / copy this folder, then `npm install`.
2. Copy env vars from the Netlify UI into a local `.env` — **don't commit it**.
3. Change code, then **prove it with a measurement**, not a screenshot:
   - graphics: `check()` byte delta, and render the worst case
   - cutouts: retention numbers per backdrop
   - tickers: scan the plate row and compare to `fitWidth`
4. Deploy from here, then confirm on `/ops.html`.

Bring changes back into **this** folder — it is the one that deploys.

---

## 10. Outstanding

- [ ] **Rotate the Box client secret (×2) and Canva client secret (×1)** —
      they were pasted into chat and must be considered compromised.
- [ ] **Save `OPS_TOKEN` somewhere permanent.** It currently exists only in a
      session scratchpad file and in Netlify's env. If both are lost, `/ops`
      is unreachable and the token must be regenerated.
- [ ] Turn on the Netlify form notification email to `media@redcloudfs.com`.
- [ ] Delete leftover test folders in Box.
- [x] Decide the fate of the unexplained `clips` code (§4). It is Clip Studio — kept (2026-09-15).
- [ ] No record has ever carried a headshot, so the background remover is
      **unproven on a real photograph**. Upload one and regenerate.
