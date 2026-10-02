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
| Address | `webinars.redcloudfs.com` — **not live yet**, waiting on the DNS record |
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
- the Caddy labels are **not** in `docker-compose.yml` yet. They go in once
  `webinars.redcloudfs.com` resolves to `138.197.139.66` — a domain with no DNS
  makes Caddy fail its certificate and retry;
- straight after adding them, check `docker logs portal-caddy-1` and that the
  portal, HQ and CRM still load.

The labels to add then:

```yaml
    labels:
      caddy: webinars.redcloudfs.com
      caddy.reverse_proxy: "{{upstreams 8300}}"
```

If the portal's compose project is ever taken down, Caddy and `portal_default` go
with it, and the pipeline loses its address (it keeps running). Bring the portal
back and restart the pipeline.

---

## Secrets

All in `/root/webinar-pipeline/.env` on the server, `chmod 600`, **never in git and
never in chat**. `ops/deploy.sh` never overwrites it.

| Variable | Where it comes from |
|---|---|
| `PIPELINE_TOKEN` | generated on the server by the first deploy, never printed. Every route but `/health` needs it as the `x-pipeline-token` header |
| `RIVERSIDE_API_KEY` | Riverside's customer success manager (Business plan; **one key active at a time** — regenerating it breaks every other user of it) |

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
| `GET /health` | public; up or not, and which pieces are on. Says nothing secret |
| `GET /riverside/overview` | token; read-only Riverside workspace + webinars |
