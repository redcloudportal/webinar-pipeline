#!/usr/bin/env bash
# Deploy the pipeline to its own folder on the DigitalOcean server and rebuild
# ONLY its container. Never touches /root/portal. The server's .env is left as it is.
set -euo pipefail
HOST=root@138.197.139.66
DIR=/root/webinar-pipeline
cd "$(dirname "$0")/.."

rsync -az --delete --exclude .git --exclude .env --exclude node_modules --exclude .DS_Store ./ "$HOST:$DIR/"
ssh "$HOST" "set -e; cd $DIR
  # first deploy only: a token generated ON the server, never printed
  if [ ! -f .env ]; then umask 077; printf 'PIPELINE_TOKEN=%s\nRIVERSIDE_API_KEY=\n' \"\$(openssl rand -hex 24)\" > .env; fi
  # signs the 30-day sign-in cookies; generated once on the server, never printed
  grep -q '^SESSION_SECRET=' .env || { umask 077; printf 'SESSION_SECRET=%s\n' \"\$(openssl rand -hex 32)\" >> .env; }
  chmod 600 .env
  docker compose up -d --build
  sleep 3
  docker compose exec -T pipeline wget -qO- http://127.0.0.1:8300/health"

# keep the GitHub copy in step, once the repo exists
if git remote get-url origin >/dev/null 2>&1; then git push -q origin HEAD:main && echo "pushed to $(git remote get-url origin)"; fi
