# Cut-over: the webinar system moved to webinars.redcloudfs.com

**Done Friday 2 October 2026, ~15:40 ET.** The whole webinar system now runs on
the DigitalOcean server from this repo. Netlify only forwards.

## What changed

| | Before | Now |
|---|---|---|
| Client form | `redcloud-webinar-form.netlify.app/` (Netlify Forms) | **https://webinars.redcloudfs.com/** (handled by `src/host.mjs`, files on the data volume) |
| /ops, clips view | Netlify, ops token | **webinars.redcloudfs.com/ops**, `/clips` — behind the sign-in |
| Connectors, graphics, Box, social copy, Mailchimp drafts, registration page builder | Netlify Functions | this server, the same code (`app/netlify/…`) run by `src/host.mjs` |
| 15-minute timer | Netlify scheduled function | this server (`SCHEDULER_ENABLED=1`) |
| Records, email images, clip previews | Netlify Blobs | files on the data volume (`app/netlify/shared/blobs.mjs`) |
| Clients' uploaded files | Netlify's file CDN | copied to this server (`/uploads/<token>/…`) |
| Keys | Netlify environment variables | `.env` on the server + the **Keys page** (`/settings/keys`) |
| Mac Mini clips worker | `RC_SITE_URL=https://clips--redcloud-webinar-form.netlify.app` | `RC_SITE_URL=https://webinars.redcloudfs.com` (`~/rc-clips/.env`) |

**Netlify** now runs only `~/webinar-netlify-forwarder`: every old address
(form links already sent to clients, `/ops` bookmarks, the API) **301s to the same
path on webinars.redcloudfs.com, query string included**, and `/art/<token>.png`
is still served — email campaigns sent before the move load their images from
there. No other function exists on Netlify, so its timer, form handler and
connectors cannot run.

## How it was checked

- 25 records, 17 email images, 23 clip previews copied; counts match Netlify.
- The record list through the new /ops API is identical to Netlify's.
- All 17 email images byte-identical on both sites.
- The clips list identical on both sites.
- Graphics and social-copy self-checks pass on the server (Linux).
- **A real submission through the live form** ("ZZ Cutover Test Mining Ltd.")
  filed to Box, drew all 8 graphics, wrote the social copy — then was discarded
  (Box folder in the Box trash, record retired).
- The portal, HQ, PM and CRM checked unchanged after every deploy.
- The clips worker polls the new site and re-matched Skyharbour's folder.

## Found and fixed on the way

- **The clips worker had stopped matching renamed Box folders.** Folders have been
  named by the *webinar* date since 1 Oct; the worker matched on the *submission*
  date in the record id, so clients with several records (Skyharbour) stopped
  matching. `/api/clips` now carries `boxFolder`, `webinarDate`, `retired`, and the
  worker matches the folder id first (`~/rc-clips/bin/rcworker.py`; the original is
  `rcworker.py.bak-2026-10-02`).
- **Changing clips was open to anyone with the address** on Netlify. It now needs a
  signed-in person; reading stays open for the worker.

## Still to do (Monday)

1. **Set the sign-in password** with the one-time link (sent in chat; lasts until
   Tuesday). Ask for a new one any time:
   `docker compose exec -T pipeline node src/admin.mjs setup-link --hours 24`.
2. **Paste two keys on the Keys page** (`/settings/keys`) — Netlify never gives a
   secret back, so these could not be copied:
   - **Mailchimp API key** — until then, new submissions get no invite draft;
     press *Retry* on the Mailchimp step afterwards for any that came in.
   - **Anthropic API key** — until then the client form's title suggestions and
     company profile don't work (the form itself still submits).
3. **Decide on submission notifications.** Netlify Forms emailed someone on each
   submission; that stopped with the move. Options: an email per submission once
   an email-sending key (Resend) is set, or a Teams/Telegram ping.
4. The old Netlify environment variables can be removed once everything is
   confirmed working.

## Rolling back

Everything is reversible:

1. **Stop the new server acting**: set `PAUSED: "1"` and `SCHEDULER_ENABLED: "0"`
   in `docker-compose.yml`, run `ops/deploy.sh`. Nothing outward runs.
2. **Bring Netlify back**: Netlify → *redcloud-webinar-form* → Deploys →
   **`6abfcb03d6b7dc486278e6a1`** (2 Oct 15:17) → *Publish deploy*.
3. **Point the clips worker back**: in `~/rc-clips/.env`, set
   `RC_SITE_URL=https://clips--redcloud-webinar-form.netlify.app`, then
   `launchctl kickstart -k gui/$(id -u)/com.redcloud.rcworker`.

Records created on the new server after the cut-over would need copying back
(the reverse of `ops/migrate-from-netlify.py`).

## Never

**Never deploy the old intake folder** (`~/Desktop/Claude /red-cloud-webinar-intake`)
to Netlify. It would put the connectors, the timer and the form handler back on
Netlify, running alongside this server: every draft, Box filing and email twice.
Its `MOVED.md` says the same.
