#!/usr/bin/env bash
#
# Pull and restart if origin/main moved. Run every minute by bible-deploy.timer
# so a push reaches a running co-op server without waiting for a recreate.
# Installed from the repo by provision.sh.
set -euo pipefail

APP_DIR="/var/www/bible-game"
BRANCH="main"
SERVICE="bible-server"

cd "$APP_DIR"

LOCAL="$(sudo -u bible git rev-parse HEAD)"
sudo -u bible git fetch origin "$BRANCH"
REMOTE="$(sudo -u bible git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "$(date -Is) no changes"
  exit 0
fi

echo "$(date -Is) deploying $LOCAL -> $REMOTE"

sudo -u bible git reset --hard "origin/$BRANCH"
sudo -u bible npm ci

# The web build used to be built here and pushed to Hetzner Webhosting with
# `npm run deploy:web:sftp`. Both halves of that are gone: the script no longer
# exists (the site is deployed from a workstation by scripts/deploy.sh, against
# a different account and a different document root), and this box does not
# serve the web app at all any more.
#
# Leaving the call in was actively dangerous, not merely stale: `set -e` meant
# the missing npm script aborted this file BEFORE the restart below, so a timer
# firing every minute would fail every minute and the co-op server would never
# pick up a new commit.

systemctl restart "$SERVICE"
systemctl reload nginx

echo "$(date -Is) deployed $REMOTE"
