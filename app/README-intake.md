# Red Cloud — Webinar Content Form

A single, branded, client-facing form that replaces the "content request" email in the
webinar booking process. **One link, reused for every client** — nothing is pre-filled
and no client is named anywhere in the page, so the same URL can go out with every
booking email.

Everything arrives in one place: title, company bio, speakers, CC list, logo files and
brand assets.

## What it collects

| Section | Fields |
|---|---|
| 1. Who this is for | Company name*, ticker(s)*, metal/commodity, **company website**, submitter name* and email* |
| 2. Title | Webinar title*, with a live length check **and AI-drafted suggestions** |
| 3. Bio | One-paragraph company bio*, with a live word count |
| 4. Speakers | Up to four — name, job title, email (first one required) |
| 5. Logo & brand assets | Logo upload* (drag-and-drop), extra assets, a link box for oversized files |
| 6. Last few things | CC list, time zone, when the deck will be ready, technical test, free-text notes |

\* required

## Why the client is never asked for a date

Red Cloud holds the confirmed date and start time — the client does not set them, and the
form does not ask. Because this is one generic link, a submission carries no booking
context on its own, so the form asks for **company name and ticker as the required
identifiers** and those are what the answers get filed against. Nothing in the page states
or implies a date we have not been given.

The date enters the system in exactly one place: the **broadcast start** field on `/ops`,
stored as `schedule.startTimeISO`. Every date a client ever reads — the invite, the
eblast subject, the day-before email — is derived from that single value and formatted in
Eastern time (`DISPLAY_TZ`, default `America/Toronto`). There is deliberately no second
date field anywhere, because two date fields eventually disagree and the client is the one
who finds out.

## Title suggestions

Clients are worst at the title — it is the field that holds everything up. So the form
drafts some for them.

They paste their company website into section 1 and press **Suggest some titles** in
section 2. A Netlify Function reads their site, sends the text to Claude, and returns
four to six options with a one-line note on the angle each takes. Clicking one fills the
title field; they can edit it from there.

**Every title has to be about that company and no other.** The model is required to
return, alongside each title, the concrete thing it is built on — a project name, a
deposit, a district, a jurisdiction, a stated milestone — and the prompt names the
failure mode explicitly: if a title would still make sense with a different company's
name pasted in, it is rejected and rewritten. Titles like "Inside the copper story" or
"Building a gold business" are listed in the prompt as examples of what not to produce.

**Two routes in**, in order of preference:

1. **A website** — reads the homepage plus up to two same-domain pages whose link text or
   URL looks like news, press releases, investors, projects or about. That is where the
   story actually lives; a homepage alone gives you boilerplate. Text only, capped at
   24,000 characters. Measured round trip: **~12s**.
2. **The bio they have typed**, if there is no website and they have written 60+
   characters. Measured round trip: **~6s**.

The button tells them which route it is about to take. A company name on its own is
refused in 0.2s with a message asking for the website — see below for why.

### Why there is no "just the company name" route

It was built and then removed. Drafting from a bare company name needs a web search, and
web search — whether as a separate research call or as a tool on the titling call —
consistently took **over 30 seconds** and hit the function timeout, returning a 504
inactivity page rather than titles. Every issuer has a website and the field is right
there in section 1, so requiring it keeps the feature fast and predictable. Do not
re-add web search here without moving the work to a background function and polling.

### The offline fallback

When the drafting assistant is unavailable, the page builds suggestions in the browser
instead — but it does **not** emit templates. It mines the bio for named things: project
and property names, jurisdictions, stage words (drilling, maiden resource, PEA,
feasibility, permitting), and the client's own figures, then builds titles around those.
Given a real bio it produces:

```
Inside Bell Creek, northern Nevada
Drilling at Bell Creek and what follows
From Bell Creek to Kestrel Ridge: building the portfolio
20,000 metres at Bell Creek: what the programme is testing
A land position of 14,000 hectares in northern Nevada
```

If the bio names nothing concrete, it shows **no suggestions at all** and asks them to
name their projects first — deliberately, because filler that fits any company is worse
than an empty state.

### Switching it on

The function needs an Anthropic API key. **Set it yourself** — never paste a key into a
chat or a commit:

```bash
cd red-cloud-webinar-intake && npx netlify env:set ANTHROPIC_API_KEY "sk-ant-..." --context production
```

Or Netlify → Site configuration → Environment variables → Add. Then redeploy.

**Never paste an API key into a chat, a commit, or a shared document.** If one is ever
exposed, revoke it at <https://console.anthropic.com/settings/keys> and issue a new one —
rotating takes a minute, and a leaked key can be used by anyone who sees it.

The model is configurable too, if you want to trade quality for cost:

```bash
npx netlify env:set ANTHROPIC_MODEL "claude-sonnet-5" --context production
```

Defaults to `claude-opus-5` when unset. **The key is set and the feature is live** —
verified end to end against a real issuer's website.

### Two SDK traps, in case this is ever rebuilt

Both cost real debugging time and neither throws a useful error:

- `client.beta.messages.parse` in SDK 0.71.x reads **`output_format`**, not
  `output_config.format`. Pass the schema the wrong way and the API happily returns a
  plain text block, `parsed_output` is `null`, and you get a silent empty result. The
  beta header is added by the SDK automatically — that is not the problem.
- `betaZodOutputFormat` calls `z.toJSONSchema()`, which is **Zod 4 only**. On Zod 3 it
  throws at schema-build time.

If suggestions ever come back empty, the function logs `stop_reason`, the content block
types and `output_tokens` on every call — Netlify → Functions → `suggest-titles` → Logs.
`blocks: ["text"]` means the schema was not applied.

**Until the key is set the feature degrades rather than breaks:** the endpoint returns
`501`, and the page falls back to simple template-built suggestions with a note saying
they are generic. Nothing errors, nothing blocks the client from submitting.

### How it is kept safe

The endpoint fetches a URL a stranger typed, so:

- **SSRF guard** — http/https only; loopback, private ranges (10/172.16/192.168/100.64),
  link-local including the `169.254.169.254` cloud-metadata address, IPv6 loopback and
  unique-local, bare hostnames and `.local` are all refused. Redirects are followed by
  hand so **every hop** gets re-checked, not just the first.
- **Bounded** — 8s timeout per page, 900 KB per response, 3 pages max, HTML content-type
  only.
- **Prompt injection** — page text is third-party content, so it is fenced in tags, the
  system prompt tells the model to treat it as data and never follow instructions inside
  it, the response is schema-constrained (Zod → structured outputs), and every returned
  title is re-checked for length before it reaches the page. A malicious site can at
  worst produce a silly title suggestion, which a human then reads and chooses to ignore.
- **Throttle** — 12 requests per IP per 10 minutes. This is per function instance and
  therefore best-effort; it is a speed bump against accidental hammering, not a defence
  against a determined attacker. If cost ever becomes a concern, put the endpoint behind
  Netlify's rate limiting.

Model: `claude-opus-5`, adaptive thinking at `low` effort, structured output via
`client.beta.messages.parse` with `betaZodOutputFormat` (note: the beta path and Zod 4 —
the non-beta `messages.parse` / `zodOutputFormat` pairing does not exist in SDK 0.71.x).
Cost per press is small (a few cents at most) but it is not zero — it scales with how
much of their site gets read, and the name-only route adds a web search on top.

## Deploying

**Do not run `netlify deploy` from the repo root.** The root is linked to a different
Netlify project (`grsilvermininganalyticreport`), so a deploy from there would overwrite
that site. This folder needs its own Netlify project.

First time — create the project and deploy, from inside this folder:

The project already exists — **redcloud-webinar-form**
(`2e3f3bd7-7383-4b24-8b7f-694a0bb9881b`), live at
<https://redcloud-webinar-form.netlify.app>. To redeploy after a change:

```bash
cd red-cloud-webinar-intake && npm install && npx netlify deploy --prod --dir public --functions netlify/functions --site 2e3f3bd7-7383-4b24-8b7f-694a0bb9881b
```

The `--site` flag is not optional — without it the CLI resolves the parent directory's
link and deploys to the wrong project.

### Layout

```
public/                     the static site (this is what gets published)
netlify/functions/          suggest-titles.mjs
package.json                function dependencies
netlify.toml                publish = public, functions = netlify/functions
```

`public/` exists so `node_modules/` is never published as static files.

### Form detection — already fixed, but worth knowing

New Netlify sites ship with `ignore_html_forms: true`, so form posts return **404** until
it is turned off. It has been turned off on this site and the form is registered and
accepting submissions. If forms ever start 404ing after a rebuild, that setting is the
first thing to check.

### Turn on the email notification — STILL TO DO

Netlify → **redcloud-webinar-form** → **Forms** → *Form notifications* → **Add
notification** → *Email notification* → form `webinar-content` → send to
`media@redcloudfs.com`.

**This has not been done yet.** Until it is, submissions are recorded in the dashboard but
nobody is told about them.

The notification includes a `summary` field: the whole content sheet as clean plain
text, formatted like the old email template and ready to paste straight into the Trello
card. Uploaded files appear as download links on the submission in the Netlify dashboard.

## File uploads

- The form posts as `multipart/form-data` with two file inputs, `logo` and `assets`,
  both accepting multiple files.
- **8 MB per file** is Netlify's ceiling. The form checks sizes in the browser, flags any
  file that is over, and blocks submission until it is removed — better than a failed
  upload after a long wait. The "or send us a link" box is the escape hatch for big files.
- Uploads count toward the Netlify plan's form storage. If a client sends a 200 MB video,
  the link box is the right route.
- The upload progress bar is driven by `XMLHttpRequest`, which reports progress; `fetch`
  does not.

## Testing it locally

Form submissions **cannot work on a local file server** — there is no Netlify behind it
to receive the POST, so `python3 -m http.server` answers `501` and the form reports a
failure. That is expected, not a bug.

The page detects this: on `localhost`, `127.0.0.1` or `file://` it shows a blue "Local
preview" banner above the send button, and if you press send anyway it says plainly that
nothing is wrong with the form. It also shows you the exact summary that would have been
submitted, so you can check the output without deploying.

To test submissions end to end locally, run `npx netlify dev` from inside this folder
instead — that proxies through Netlify and forms work.

## The automation layer

Every submission becomes a **webinar record** in Netlify Blobs, and every integration
reads from and writes back to that one record. This is the spine the process teardown
argued for: the twelve facts are captured once and merged everywhere, instead of being
retyped into fifteen systems.

### How it runs

```
client submits  →  submission-created-background
                      creates the record
                      runs every "on-create" connector

every 15 min    →  scheduler
                      finds timed connectors that are due and fires them

any time        →  /ops        the dashboard: what ran, what failed, retry
                   /api/health what is switched on, and does it work
```

### The connectors

| Connector | Steps | Fires | Needs |
|---|---|---|---|
| File to Box | 25 | on create | `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_SUBJECT_ID`, `BOX_FOLDER_ID` |
| File to Drive | 25 | on create | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GDRIVE_FOLDER_ID` |
| Trello card | 2 | on create | `TRELLO_KEY`, `TRELLO_TOKEN`, `TRELLO_LIST_ID` |
| WordPress registration page | 4 | on create | `WP_BASE_URL`, `WP_USER`, `WP_APP_PASSWORD`, `WP_TEMPLATE_PAGE_ID` |
| Calendar invites | 8 | when a start time is saved | `RESEND_API_KEY`, `MAIL_FROM` |
| Distribution email | 9 | T&minus;7d +1h | `RESEND_API_KEY`, `MAIL_FROM` |
| Mailchimp eblast | 10 | T&minus;7d | `MAILCHIMP_API_KEY`, `MAILCHIMP_TEMPLATE_CAMPAIGN_ID` |
| Post-tech-test email | 12 | T&minus;3d | `RESEND_API_KEY`, `MAIL_FROM` |
| Day-before email | 13 | T&minus;24h | `RESEND_API_KEY`, `MAIL_FROM` |
| Presenter links | 15 | T&minus;60m | `RESEND_API_KEY`, `MAIL_FROM` |
| Replay emails | 23 | T+4h | `RESEND_API_KEY`, `MAIL_FROM` |

**A connector with missing variables reports `off` and is skipped.** It cannot throw, and
it cannot block the connectors that *are* configured. So this gets switched on one
service at a time, and a half-configured system is a working system.

### Rules enforced in code rather than remembered

The process document flags three things people get wrong on the day. They are now
structural:

- **The StreamYard code goes in both places.** The WordPress connector counts the
  `{{SY_CODE}}` placeholders in the template and refuses to build the page if there are
  fewer than two — the exact failure the doc warns about ("put it in one and the button
  half-works, which is worse than it not working at all").
- **Nothing publishes itself.** The registration page is created as a *draft*; the
  Mailchimp campaign as a *draft*. The approval gate at step 6 is untouched — the work
  simply arrives at it already built.
- **No connector fires twice.** Anything already marked done is skipped, so a retry or a
  double-trigger cannot send a client two invites.

And three guards of its own:

- **Anything more than 48 hours overdue is skipped, not sent.** Switching the scheduler on
  cannot blast a backlog of emails about webinars that already happened.
- **A connector that has failed three times is left alone.** It used to be retried every
  fifteen minutes for the full 48 hours — roughly 190 attempts against a provider that had
  already said no. `/ops` still has a Retry button for when the cause is fixed.
- **A connector that needs a broadcast time and has not got one reports `waiting`, not
  `failed`.** It is early, not broken. Saving a start time on `/ops` fires it immediately.
  This is how the calendar invites run: they cannot go out at submission time because
  nobody has confirmed a time yet, so they wait for one.

**Sends are idempotent one call at a time, not just one connector at a time.** The
calendar-invite step sends two emails; if the second fails, a retry resumes at the second
rather than putting a duplicate invite in the presenters' calendars. Every outbound send
records itself on the record the instant the provider accepts it.

### /ops — the dashboard

Silent failure is the risk automation adds, so there is one page that shows every
webinar, every connector that ran against it, what it produced, and a **Retry** button on
anything that failed. It is also where Red Cloud fills in its own half of the record —
broadcast date and time, moderator, StreamYard link.

**Timed emails do not fire until a broadcast start time is set there.** A record with no
confirmed time is simply inert, which is the safe default.

The page is gated on `OPS_TOKEN`. If that variable is unset the API refuses everything
rather than defaulting to open:

```bash
cd red-cloud-webinar-intake && npx netlify env:set OPS_TOKEN "a-long-random-string-you-choose" --context production
```

### Checking it

```bash
curl https://redcloud-webinar-form.netlify.app/api/health
```

Lists every connector, whether it is on, and exactly which variables are missing. Add
`?deep=1` and each configured connector runs a live connection test — Trello names the
list cards will land in, WordPress warns if the template is missing a `{{SY_CODE}}`,
Resend warns if the sending domain is not verified.

## Filing submissions to Box

Box and Google Drive do the same job — step 25 — and are interchangeable. Whichever has its
variables set is the one that runs; set both and both run, which is a valid way to migrate.
Neither can block the other, and an unconfigured one is simply reported `off`.

Each submission becomes a folder inside a Box folder you nominate:

```
Northern Gold Corp. — 2026-09-24/
    Northern Gold Corp. — webinar content sheet.txt
    submission.json
    logo — northern-gold-logo.svg
    headshot-ceo.jpg
```

The folder is named for the **broadcast** date once one is set on `/ops`, and for the
submission date until then. A single unreadable file is logged and skipped rather than
losing the folder.

### ⚠️ The Service Account starts with an empty Box

This is the same trap as Google Drive, in different clothing. A Client Credentials app
authenticating as the **enterprise** acts as the app's own **Service Account user** — a real
but invisible account with its own empty root folder. **It cannot see your files.** Point it
at a folder id it has not been invited to and every call fails with a bare `404 not found`
on an id you can see is correct.

Two ways round it, and `/api/box-check` tells you which one you are in:

1. **Share the folder with the Service Account** (recommended). Leave
   `BOX_SUBJECT_TYPE` unset, run `/api/box-check`, and it reports the exact address the app
   is signed in as — something like `AutomationUser_1234_abcd@boxdevedu.net`. Invite that
   address to your target folder as **Editor**.
2. **Act as a real person** — set `BOX_SUBJECT_TYPE=user` and `BOX_SUBJECT_ID` to a user id.
   This needs *Generate user access tokens* enabled on the app and admin authorisation.
   Files then appear as uploaded by that person.

### Setup

1. **Box Developer Console** → **Create Platform App** → *Custom App* → **Server
   Authentication (Client Credentials Grant)**.
2. On the app's **Configuration** tab, under *Application Scopes*, tick **Write all files and
   folders stored in Box**. Save.
3. Still on Configuration, copy the **Client ID** and **Client Secret**, and note the
   **Enterprise ID** shown in the *App Info* section.
4. **Authorization** tab → **Review and Submit**. An admin must approve the app in
   **Box Admin Console → Apps → Custom Apps Manager** before any token will work. An app
   that has not been authorised fails with `invalid_client`, which reads like a wrong
   secret and is not.
5. In Box, create the folder submissions should live in and copy its id from the URL —
   `app.box.com/folder/THIS_PART`. Share it with the Service Account as **Editor** (see
   above).
6. Set four variables — the secret via the Netlify UI, never a commit or a chat:

```bash
cd red-cloud-webinar-intake && npx netlify env:set BOX_CLIENT_ID "..." --context production
```

```bash
cd red-cloud-webinar-intake && npx netlify env:set BOX_SUBJECT_ID "your-enterprise-id" --context production
```

```bash
cd red-cloud-webinar-intake && npx netlify env:set BOX_FOLDER_ID "the-folder-id" --context production
```

`BOX_CLIENT_SECRET` goes in via Site configuration → Environment variables.

7. Redeploy, then **check it before trusting it**:

```bash
curl https://redcloud-webinar-form.netlify.app/api/box-check
```

That endpoint signs in, **reports which account it is signed in as**, opens the target
folder, writes a test file into a `_connection test` folder and reports back in plain
English — including which variable is missing, or that the folder has not been shared with
the Service Account. Delete the test folder afterwards.

Until all four variables are set, the connector reports `off` and does nothing. Turning this
on is additive; turning it off breaks nothing.

## Filing submissions to Google Drive

`submission-created-background.mjs` fires automatically on every verified submission and
creates a folder per company inside a Drive folder you nominate:

```
Northern Gold Corp. — 2026-09-24/
    Northern Gold Corp. — webinar content sheet.txt
    submission.json
    logo — northern-gold-logo.svg
    headshot-ceo.jpg
```

It is a **background** function on purpose: those get 15 minutes instead of ~10 seconds,
and re-uploading a logo pack does not fit in ten seconds. Nothing it does can affect the
client — by the time it runs, Netlify has already recorded the submission and told them
it went through. A single unreadable file is logged and skipped rather than losing the
folder.

### ⚠️ It must be a Shared Drive, not My Drive

**A service account has no Google storage quota of its own.** Point it at a folder in
someone's personal My Drive — even one shared with the service account — and every upload
fails with `storageQuotaExceeded`. The target folder has to live on a **Shared Drive**
with the service account added as a member. This is the single most likely reason for it
not to work, so the code turns that specific error into a sentence saying exactly this.

### Setup

1. **Google Cloud Console** → create (or pick) a project → **APIs & Services** → enable
   the **Google Drive API**.
2. **IAM & Admin → Service Accounts** → Create service account → name it something like
   `redcloud-webinar-form`. No roles needed.
3. On that service account → **Keys** → *Add key* → *Create new key* → **JSON**. It
   downloads once. Inside are `client_email` and `private_key`.
4. In **Google Drive**, open the **Shared Drive** where webinar content should live,
   create a folder for it, and share that folder with the `client_email` address as
   **Content manager**. Copy the folder id out of the URL —
   `drive.google.com/drive/folders/THIS_PART`.
5. Set three variables (values come from the JSON — do not commit it, do not paste it
   into a chat):

```bash
cd red-cloud-webinar-intake && npx netlify env:set GOOGLE_SERVICE_ACCOUNT_EMAIL "...@....iam.gserviceaccount.com" --context production
```

```bash
cd red-cloud-webinar-intake && npx netlify env:set GDRIVE_FOLDER_ID "the-folder-id" --context production
```

For the key, use the Netlify UI (Site configuration → Environment variables) and paste
the whole `private_key` value including the `-----BEGIN PRIVATE KEY-----` and
`-----END PRIVATE KEY-----` lines, as `GOOGLE_PRIVATE_KEY`. Literal `\n` escapes are
handled either way.

6. Redeploy, then **check it before trusting it**:

```bash
curl https://redcloud-webinar-form.netlify.app/api/drive-check
```

That endpoint signs in, creates a `_connection test` folder, writes a file into it and
reports back in plain English — including which variable is missing, or that the folder
is on My Drive rather than a Shared Drive. Delete the test folder afterwards.

Until all three variables are set, the filing function logs `skipped, not configured` and
does nothing. Submissions still land in the Netlify dashboard exactly as now, so turning
this on is additive and turning it off breaks nothing.

## Draft recovery, and why it is deliberately forgetful

One link is shared with every client, so a half-finished draft must never outlive the
visit that created it. Two rules enforce that:

- Drafts live in **sessionStorage**, not localStorage — they die with the tab and are
  invisible to any other tab.
- A draft is restored **only on a reload or a back/forward step**. Arriving at the link
  fresh always starts blank, even in a tab that still holds a previous draft. The check is
  `performance.getEntriesByType('navigation')[0].type`.

So an accidental refresh mid-typing costs nothing, and the next person to open the link
sees an empty form. Verified: fill the form, reload → answers come back; navigate to the
link again in the same tab → blank, with no trace of the previous company in storage.
There is also a **Start again** button in the header, and the draft is wiped on
successful submit. Uploaded files are never stored locally at any point.

An earlier build used localStorage; the page now deletes that old key on load so nothing
lingers on a machine that visited before this change.

## A caching trap worth remembering

Netlify was holding `/` at the edge with a **one-year TTL**, so a redeploy showed up at
`/index.html` but not at the root that clients actually visit — the deploy looked
successful and the change was invisible. `netlify.toml` now sets
`Netlify-CDN-Cache-Control: public, max-age=0, must-revalidate` on `/*` and `no-store` on
`/api/*`. If a future change ever seems not to deploy, compare `curl site/` against
`curl site/index.html` before assuming the deploy failed.

## Notes

- **Drafts save to the client's own browser** (sessionStorage — see *Draft recovery*
  above, which explains why it must not be localStorage). Files are not saved to the
  draft — they have to be re-attached. Only pressing send transmits anything.
- **If the submission fails**, the form does not pretend it succeeded. It says so, keeps
  the draft, and offers a copyable plain-text summary to email across manually.
- The page carries `noindex, nofollow` and the site sends `X-Robots-Tag` to match.
- Spam protection is a honeypot field (`bot-field`). If spam becomes a problem, add
  reCAPTCHA via Netlify's `data-netlify-recaptcha` attribute.
