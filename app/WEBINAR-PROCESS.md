# Webinar process — one card per stage

Built from what the system actually does, as of 1 October 2026. Every line is
either **[AUTO]** (it happens on its own) or **[YOU]** (somebody has to do it).

Two things decide how much of this is manual:

- **8 of 12 connectors are off.** Everything marked *(off today)* is a step the
  system is built to do and cannot, because the mail provider and Mailchimp keys
  are not set. Those are the manual lines. Turning on Resend alone converts six
  of them.
- **The registration page is pasted, not posted.** WP Engine strips the auth
  header off `/wp-json/`, so WordPress cannot be written to. `/ops` hands over
  the finished HTML instead.

`/ops` = https://redcloud-webinar-form.netlify.app/ops.html

---

## Card 1 — Book it  ·  T−3 weeks or more

- [ ] **[YOU]** Agree the date and time with the client
- [ ] **[YOU]** In `/ops`, open the webinar and set **Broadcast start** and
      **Start time as written on graphics** (e.g. `1:00pm ET / 10:00am PT`)
- [ ] **[YOU]** Pick the **Red Cloud analyst** from the dropdown — never retype
      a colleague's title
- [ ] **[YOU]** Press **Send to client** — copies the form link with the date
      and time already loaded, or opens a mail draft

> The date set here is the one date everything else is derived from. Change it
> later and every graphic, every post and the Box folder name follow.

---

## Card 2 — Client submits  ·  the form

- [ ] **[YOU]** Chase the client if nothing arrives (nothing is automatic until
      they submit)
- [ ] **[AUTO]** Box folder created: `<Company> — <webinar date>`
- [ ] **[AUTO]** Content sheet + `submission.json` + every file they uploaded
      filed into it
- [ ] **[AUTO]** **8 graphics** drawn into `Graphics/` — Twitter/X, LinkedIn/FB,
      Instagram, 2 invites, 2 replay thumbnails, webinar thumbnail
- [ ] **[AUTO]** **Social copy** written: `— social copy.csv` and `.txt`
- [ ] **[AUTO]** **Mailchimp invite draft** created from the invite graphic —
      title `<Company> - Webinar Invite - Push 1`. Draft only; nothing sends
- [ ] **[AUTO]** *(off today)* Trello card, registration page draft
- [ ] **[YOU]** Check `/ops` for anything flagged: no usable logo, a headshot
      whose background could not be removed, a title that reads badly

**If the logo failed** (WebP, or a black panel baked into the file): get a PNG
or JPEG, then **Logo** action in `/ops` → re-run graphics. Without a logo the
webinar thumbnail is not built at all.

---

## Card 3 — Registration page  ·  T−2 weeks

- [ ] **[YOU]** `/ops` → **Copy registration page HTML**
- [ ] **[YOU]** New WordPress page, **Custom HTML** block, paste, slug
      `rcwebinar-<ticker>`
- [ ] **[YOU]** Paste the site's existing **Questions form** where the comment
      marks it (the only part the block can't carry)
- [ ] **[YOU]** Preview, then publish
- [ ] **[YOU]** Put the live URL back into `/ops` → **Registration page**

> That URL is the link in every social post. Until it's set, the copy guesses
> `redcloudfs.com/events/<company>/`.

---

## Card 4 — Promote  ·  T−7 days

- [ ] **[YOU]** Open the Mailchimp draft (link on the webinar in `/ops`), check
      the image, date and Register button, and fix the registration link if
      it is still the guess
- [ ] **[YOU]** Send yourself a test, get it approved (Marty), then **schedule**
      it — the system never sends or schedules
- [ ] **[AUTO]** *(off today)* Distribution + next-steps email — **T−7 days**
- [ ] **[YOU]** Open `/ops` → **Social copy**
- [ ] **[YOU]** Read the two **Look Ahead** posts (LI/FB and Twitter), adjust if
      the title reads oddly
- [ ] **[YOU]** Paste the CSV into the client's **content calendar tab** — its
      four columns are already the right ones
- [ ] **[YOU]** Schedule the Look Ahead posts; the asset link in each row is the
      exact graphic that post goes out with

---

## Card 5 — Run-up  ·  T−3 days to T−1 hour

- [ ] **[AUTO]** *(off today)* Post-tech-test email — **T−3 days**
- [ ] **[YOU]** Run the **technical test** with the presenters (mandatory)
- [ ] **[AUTO]** *(off today)* Calendar invites — fire when the broadcast time
      is saved
- [ ] **[AUTO]** *(off today)* Day-before email — **T−1 day**
- [ ] **[YOU]** Confirm the deck has arrived
- [ ] **[AUTO]** *(off today)* Presenter links — **T−60 minutes**

---

## Card 6 — Day of  ·  broadcast day

- [ ] **[YOU]** Post the two **Day of** posts from the sheet (LI/FB, Twitter)
- [ ] **[YOU]** Host the webinar
- [ ] **[AUTO]** *(off today)* Replay emails — **T+4 hours**

---

## Card 7 — Replay  ·  T+1 day

- [ ] **[YOU]** Upload the recording and get its link
- [ ] **[YOU]** `/ops` → **Replay link** → Save
- [ ] **[YOU]** Re-run **Social copy** — every `[REPLAY LINK]` becomes the real
      one
- [ ] **[YOU]** Post the **Replay** copy
- [ ] **[YOU]** Delete the registration page (step 21 of the written process) —
      **keep the last one**, it is the template for the next

---

## Card 8 — Clips  ·  T+2 to T+10 days

- [ ] **[YOU]** `/ops` → Clips → paste the **source** (the recording reference)
- [ ] **[AUTO]** The Mac mini transcribes it and suggests cutdowns, with a
      reason for each ("4 numbers in this passage")
- [ ] **[YOU]** Watch, keep or change the suggested **timecodes**, name each
      clip
- [ ] **[YOU]** **Approve** — nothing is cut until you do
- [ ] **[AUTO]** The Mac mini cuts them and files them into the Box folder
- [ ] **[AUTO]** Social copy picks up each clip and writes a post from the
      **transcript** — a real line the speaker said inside those seconds
- [ ] **[YOU]** **Read every quote before posting.** They come from the
      automatic transcript, which gets names wrong. `/ops` marks them
      *"transcript quote — check it"*
- [ ] **[YOU]** Add the clip posts to the content calendar and schedule them

> **Name clips properly.** "Maverick drilling" becomes the post's headline.
> "Clip 1" is a filing label — the system ignores it and leads with the quote
> instead.

---

## Card 9 — Close out

- [ ] **[YOU]** Content calendar has: 2 Look Ahead, 2 Day of, 1 Replay, 1 per
      clip — each with its asset link
- [ ] **[YOU]** Box folder is named for the **webinar date**, not the submission
      date (the system renames it; check it if the date moved)
- [ ] **[YOU]** Attendee list filed in the Box event folder (the portal imports
      it on the 6:45 cron, keyed off the folder date)

---

## What breaks it

| Symptom | Cause | Fix |
|---|---|---|
| Webinar thumbnail missing | No usable logo on the record | **Logo** action in `/ops` → re-run graphics |
| Logo is a black box | Client's file has a panel baked in | Get a transparent PNG, then the Logo action |
| Graphics say TBC | No date anywhere | Set the broadcast start in `/ops` |
| Posts link to the wrong page | Registration page URL not set | `/ops` → Registration page |
| Clip posts repeat each other | Overlapping clips | They can't — each clip takes a different line. If they do, the transcript is missing |
| Record vanished from `/ops` | Its Box folder was deleted | It's marked retired and hidden. Nothing recreates the folder — resubmit |

---

## Timing at a glance

| When | What | Who |
|---|---|---|
| T−3 weeks | Date set, form sent | You |
| on submit | Folder, sheet, 8 graphics, social copy | Auto |
| T−2 weeks | Registration page live, URL in `/ops` | You |
| T−7 days | Eblast, distribution email | Auto *(off)* |
| T−7 days | Look Ahead posts scheduled | You |
| T−3 days | Tech test | You |
| T−1 day | Day-before email | Auto *(off)* |
| T−60 min | Presenter links | Auto *(off)* |
| Day of | Day of posts, broadcast | You |
| T+4 hours | Replay emails | Auto *(off)* |
| T+1 day | Replay link in `/ops`, replay post | You |
| T+2–10 days | Clips cut, clip posts | Both |
