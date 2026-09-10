#!/usr/bin/env bash
#
# Bring the checkout up to origin/main on boot, then start the co-op server.
# Run by bible-boot-update.service. Installed from the repo by provision.sh.
#
# This matters because the VPS is recreated from a snapshot on demand: whatever
# was current when the snapshot was taken is what comes back, so every boot has
# to catch up before players connect.
set -euo pipefail

APP_DIR="/var/www/bible-game"
BRANCH="main"
SERVICE="bible-server"

cd "$APP_DIR"

echo "$(date -Is) boot update started"

sudo -u bible git fetch origin "$BRANCH"
sudo -u bible git reset --hard "origin/$BRANCH"

sudo -u bible npm ci

# No `npm run build` here. That builds the web app, and this box stopped
# serving it when the game moved to the webhosting at the domain root — the
# nginx vhost is the WebSocket and nothing else now. The server runs from
# TypeScript source via tsx, so it needs the install but not the build, and
# skipping it takes ~19s off a boot that players are waiting through.

systemctl restart "$SERVICE"
systemctl reload nginx

echo "$(date -Is) boot update finished: $(sudo -u bible git rev-parse HEAD)"
