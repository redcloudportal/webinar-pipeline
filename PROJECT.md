# Red Cloud webinar pipeline

The automation layer for Red Cloud's webinars: one large automated process, built
**one piece at a time**. Started 2 October 2026.

**Every piece starts manual.** Nothing here runs on a timer, reacts to a webhook or
fires on anything until Cliff decides that piece is ready to be wired in. A piece
being "on" in `/health` means it *can* be called — never that it runs by itself.

This repo, on this Mac (`~/webinar-pipeline`), is the source of truth.

---

## Where it runs, and how it stays separate

| | |
|---|---|
| Server | the DigitalOcean droplet `138.197.139.66` (1 vCPU / 2 GB), shared with the portal, Headquarters and Pitch CRM |
| Folder | `/root/webinar-pipeline` — **its own**, not under `/root/portal` |
| Compose project | `webinar-pipeline` — its own, so a portal deploy cannot rebuild, stop or overwrite it |
| Container | `pipeline`, port 8300 inside the network, capped at 256 MB |
| Address | **https://webinars.redcloudfs.com** — internal, behind a password. Live 2 Oct 2026 (GoDaddy A record → 138.197.139.66; Let's Encrypt certificate via the shared Caddy, renews itself) |
| Repo | `redcloudportal/webinar-pipeline` — waiting to be created on GitHub |

Why the same server and not its own: it has plenty of room (load ~0.1, ~1.3 GB
free memory), and the pipeline is light — heavy video work stays on the Mac Mini.
What it shares is the machine and the **HTTPS front door**.

### The one thing it shares, and why it is handled carefully

HTTPS for every site on the box is done by a Caddy container (`portal-caddy-1`)
that lives in the **portal's** setup and builds one config from labels on every
container on the `portal_default` network. That is how Pitch CRM
(`crm.weareexisting.com`) and Headquarters (`hq.` / `pm.redcloudfs.com`) get their
addresses — and note those two are *not* separate: they are part of the portal's
compose project in `/root/portal`.

Because Caddy builds a single config, **one bad label on any container can break
HTTPS for every site, the portal included.** So:

- the pipeline joins `portal_default` (as an external network) only so Caddy can
  reach it;
- the Caddy labels went in on 2 Oct 2026, only once `webinars.redcloudfs.com`
  resolved to `138.197.139.66` — a domain with no DNS makes Caddy fail its
  certificate and retry. The portal, HQ, PM and CRM were checked before and after;
- after **any** change to the labels, check `docker logs portal-caddy-1` and that
  the portal, HQ, PM and CRM still load.

The labels:

```yaml
    labels:
      caddy: webinars.redcloudfs.com
      caddy.reverse_proxy: "{{upstreams 8300}}"
```

If the portal's compose project is ever taken down, Caddy and `portal_default` go
with it, and the pipeline loses its address (it keeps running). Bring the portal
back and restart the pipeline.

---

## Signing in — it is internal

Everything is behind a sign-in except `GET /health`, which answers only
`{"ok":true}`. An address that doesn't exist redirects to the sign-in page rather
than saying so.

- **One shared password**, stored only as an scrypt hash in the data volume
  (`/data/auth.json`) — not in the repo, not in `.env`, not in chat.
- **Set and reset with a one-time link**, made on the server:
  `docker compose exec -T pipeline node src/admin.mjs setup-link`. It works once
  and expires in 24 hours; making a new one cancels the old.
- **30-day sessions**: a signed `HttpOnly; Secure; SameSite=Lax` cookie. The
  signature includes a fingerprint of the password hash, so changing the password
  signs everyone out.
- **8 wrong tries in 15 minutes** locks that address out for 15 minutes.
- Every response is `no-store`, `noindex`, can't be framed, and sends no Referer
  (the setup link carries its token in the URL).
- Machines can still call the API with the `x-pipeline-token` header.

**When webhooks arrive (Riverside pieces 3 and 4)**, their endpoint will be the
one deliberate exception: Riverside can't sign in, so `/hooks/riverside` will be
open to Riverside alone, proven by its HMAC signature on every request.

---

## Secrets

All in `/root/webinar-pipeline/.env` on the server, `chmod 600`, **never in git and
never in chat**. `ops/deploy.sh` never overwrites it.

| Variable | Where it comes from |
|---|---|
| `PIPELINE_TOKEN` | generated on the server by the first deploy, never printed. Every route but `/health` needs it as the `x-pipeline-token` header |
| `SESSION_SECRET` | generated on the server by deploy.sh, never printed; signs the sign-in cookie |
| `RIVERSIDE_API_KEY` | Riverside → Settings → Team → API → Generate, once Riverside has switched API access on (pending as of 2 Oct 2026); ask the customer success manager if the option isn't there (Business plan; **one key active at a time** — regenerating it breaks every other user of it) |

---

## The pieces

| # | Piece | State |
|---|---|---|
| R1 | Riverside connection — `src/riverside.mjs`, `GET /riverside/overview` (read-only: workspace, webinars upcoming / ended in the last 30 days) | **built**, waiting on `RIVERSIDE_API_KEY` |
| R2 | Recording → clips: the recording and Riverside's own transcript into the clips job (the video itself stays on the Mac Mini) | next |
| R3 | Attendee lists: registrants / attended / no-show → the Box event folder the portal already imports | |
| R4 | Registration into Riverside, and syncing a Riverside webinar's time into /ops | |

The Netlify intake site (form, /ops, graphics, Box filing, social copy, Mailchimp
drafts) is **not** part of this repo and keeps working where it is. Pieces may move
here later, one at a time, deliberately.

### Riverside facts

v3 at `https://platform.riverside.com/api/v3`, `Authorization: Bearer <key>`,
**one request per second** (`src/riverside.mjs` spaces its calls). Webhooks —
`webinar.created/started/ended`, `registrant.created`, `attendee.joined`,
`registrant.did_not_attend` — are set up in Riverside → account settings →
Integrations, HMAC-signed, secret shown once; endpoints must be HTTPS and redirects
are not followed. Docs: https://docs.riverside.fm

---

## Deploying

```bash
ops/deploy.sh
```

rsyncs this folder to `/root/webinar-pipeline` (leaving `.env` alone), rebuilds
**only** the pipeline container, and prints `/health` from inside it. Pushes to
GitHub as well once `origin` exists.

## Routes

| | |
|---|---|
| `GET /health` | public; `{"ok":true}` and nothing else |
| `GET /login`, `POST /login`, `POST /logout` | the sign-in |
| `GET /setup?t=`, `POST /setup` | the one-time password link |
| `GET /` | home: which pieces are connected |
| `GET /riverside/overview` | signed in, or the token; read-only Riverside workspace + webinars |
