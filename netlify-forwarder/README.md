# Netlify forwarder for the old webinar form address

`redcloud-webinar-form.netlify.app` now only **forwards** to
https://webinars.redcloudfs.com and keeps serving `/art/<token>.png` for email
campaigns sent before the move. Everything else runs on the DigitalOcean server
(repo: `~/webinar-pipeline`). Deploy this folder with
`netlify deploy --prod --dir=public`. Never deploy the old intake folder to this
site — see `~/webinar-pipeline/CUTOVER.md`.
