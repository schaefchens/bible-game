# Spirit Game Server Setup

This document describes the complete setup for the `spirit-game-server` deployment.

The system consists of:

- a Hetzner Cloud VPS for the Node.js WebSocket/API server
- Nginx as reverse proxy
- a Vite web app served under `/game/`
- automatic Git deployment
- optional SFTP deployment of the static web build to Hetzner Webhosting
- SSL via Let’s Encrypt / Certbot
- automatic server recreation via PHP + Hetzner Cloud API
- idle destruction of the VPS when online mode is no longer used

---

# 1. Server Overview

## Server

```txt
Provider: Hetzner Cloud
Server name: spirit-game-server
IPv4: 167.233.229.238
Location: Falkenstein
Server type: cpx12
OS: Ubuntu 24.04 LTS
```

## Domains

```txt
Static/PHP site:
https://komm-folge-mir-nach.de/game/

Game VPS:
https://game.komm-folge-mir-nach.de/game/

WebSocket:
wss://game.komm-folge-mir-nach.de/ws

API:
https://game.komm-folge-mir-nach.de/api/
```

## Primary IPs

```txt
IPv4 Primary IP:
primary_ip-139525751-spirit-game-server

IPv6 Primary IP:
primary_ip-139525752-spirit-game-server
```

## Snapshot

```txt
Snapshot name: spirit-game-server-initial
Snapshot ID: 405851755
```

## Firewall

```txt
Hetzner Firewall:
firewall-spirit-game-server
```

Allowed ports:

```txt
22/tcp   SSH
80/tcp   HTTP / Certbot
443/tcp  HTTPS / WSS
```

Do not expose:

```txt
8787/tcp
```

The Node server listens on port `8787`, but it is intended to be accessed only through Nginx.

---

# 2. DNS Setup

Create DNS records for the game VPS domain.

```txt
Type: A
Name: game
Value: 167.233.229.238
```

If IPv6 is used:

```txt
Type: AAAA
Name: game
Value: <Primary IPv6 address>
```

Final result:

```txt
game.komm-folge-mir-nach.de -> 167.233.229.238
```

---

# 3. Initial Server Packages

SSH into the server as root:

```bash
ssh root@167.233.229.238
```

Install base packages:

```bash
apt update
apt upgrade -y

apt install -y git curl nginx ufw ca-certificates
```

Install Node.js 22 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

node -v
npm -v
```

Install additional deployment tools:

```bash
apt install -y sshpass
```

---

# 4. Create App User

Create a dedicated Linux user for the app:

```bash
adduser --disabled-password --gecos "" bible
mkdir -p /var/www
chown bible:bible /var/www
```

---

# 5. Clone Git Repository

Clone the public repository:

```bash
sudo -u bible git clone https://github.com/scharfmedia/bible-game.git /var/www/bible-game
cd /var/www/bible-game
sudo -u bible npm ci
```

Build the web app:

```bash
sudo -u bible npm run build
```

Expected build output:

```txt
/var/www/bible-game/apps/web/dist
```

Check it:

```bash
ls -la /var/www/bible-game/apps/web/dist
```

---

# 6. Package Scripts

The root `package.json` should contain:

```json
{
  "name": "bible-game",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "lint": "eslint .",
    "check:engine-no-react": "node scripts/check-engine-no-react.mjs",
    "build": "npm run build --workspace @bible/web",
    "dev": "npm run dev --workspace @bible/web",
    "server": "npm run dev --workspace @bible/server",
    "server:start": "npm run start --workspace @bible/server",
    "verses:import": "node packages/i18n/scripts/importVerses.mjs",
    "deploy:web:sftp": "npm run build && cd apps/web/dist && printf '%s\n' '-rm *' '-rm assets/*' 'mput *' 'mput assets/* assets/' 'bye' | sshpass -e sftp -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/home/bible/.ssh/known_hosts schaeff_2@www99.your-server.de"
  }
}
```

The important scripts are:

```txt
npm run build
npm run server:start
npm run deploy:web:sftp
```

---

# 7. Node Server systemd Service

The WebSocket/API server runs on port `8787`.

Create:

```bash
cat > /etc/systemd/system/bible-server.service <<'EOF'
[Unit]
Description=Bible Game WebSocket Server
After=network.target

[Service]
Type=simple
User=bible
Group=bible
WorkingDirectory=/var/www/bible-game
Environment=NODE_ENV=production
Environment=PORT=8787
ExecStart=/usr/bin/npm run server:start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable bible-server
systemctl start bible-server
```

Check status:

```bash
systemctl status bible-server --no-pager
journalctl -u bible-server -f
```

Check listening port:

```bash
ss -tulpn | grep 8787
```

---

# 8. Nginx Configuration

Create the Nginx site config:

```bash
cat > /etc/nginx/sites-available/bible-game <<'EOF'
server {
    listen 80;
    server_name game.komm-folge-mir-nach.de;

    location = /game {
        return 301 /game/;
    }

    location /game/ {
        alias /var/www/bible-game/apps/web/dist/;
        index index.html;
        try_files $uri $uri/ /game/index.html;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /game/ws {
        proxy_pass http://127.0.0.1:8787/ws;
        proxy_http_version 1.1;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
```

Enable the site:

```bash
ln -s /etc/nginx/sites-available/bible-game /etc/nginx/sites-enabled/bible-game
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx
```

Expected routes:

```txt
/game/     -> static Vite app
/ws        -> WebSocket server on 127.0.0.1:8787
/game/ws   -> compatibility WebSocket route
/api/      -> Node API server on 127.0.0.1:8787
```

---

# 9. Firewall Setup

## UFW

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw deny 8787/tcp
ufw --force enable
ufw status verbose
```

Expected:

```txt
22/tcp allowed
80/tcp allowed
443/tcp allowed
8787/tcp not allowed publicly
```

## Hetzner Cloud Firewall

Configure Hetzner Cloud Firewall with inbound rules:

```txt
TCP 22   Source: your IP address if possible, otherwise 0.0.0.0/0
TCP 80   Source: 0.0.0.0/0, ::/0
TCP 443  Source: 0.0.0.0/0, ::/0
```

Do not add port `8787`.

ICMP is optional. It was removed in this setup.

---

# 10. SSL Setup with Certbot

Install Certbot:

```bash
apt update
apt install -y certbot python3-certbot-nginx
```

Request certificate:

```bash
certbot --nginx -d game.komm-folge-mir-nach.de
```

Choose HTTP to HTTPS redirect when prompted.

Check certificate:

```bash
certbot certificates
```

Check renewal timer:

```bash
systemctl status certbot.timer --no-pager
```

Test renewal:

```bash
certbot renew --dry-run
```

---

# 11. Certbot Renew on Boot

Because this server may be deleted and recreated from a snapshot, normal renewal windows may be missed.

Create a boot-time renew service:

```bash
cat > /etc/systemd/system/certbot-boot-renew.service <<'EOF'
[Unit]
Description=Renew Let's Encrypt certificates on boot
Wants=network-online.target
After=network-online.target nginx.service

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"

[Install]
WantedBy=multi-user.target
EOF
```

Enable it:

```bash
systemctl daemon-reload
systemctl enable certbot-boot-renew.service
systemctl enable --now certbot.timer
```

Test:

```bash
systemctl start certbot-boot-renew.service
systemctl status certbot-boot-renew.service --no-pager
journalctl -u certbot-boot-renew.service -n 100 --no-pager
```

---

# 12. Automatic Git Deploy

The server checks GitHub regularly and deploys when `origin/main` changes.

Create deploy script:

```bash
cat > /usr/local/bin/deploy-bible-game.sh <<'EOF'
#!/usr/bin/env bash
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

sudo -u bible npm run build

# Upload built web app to Hetzner webhosting via SFTP.
sudo -u bible env SSHPASS="$SSHPASS" npm run deploy:web:sftp

systemctl restart "$SERVICE"
systemctl reload nginx

echo "$(date -Is) deployed $REMOTE"
EOF

chmod +x /usr/local/bin/deploy-bible-game.sh
```

---

# 13. SFTP Password Environment

The SFTP password must not be stored in Git.

Create:

```bash
cat > /etc/bible-deploy.env <<'EOF'
SSHPASS=YOUR_SFTP_PASSWORD_HERE
EOF

chmod 600 /etc/bible-deploy.env
```

The password was exposed during setup and should be rotated.

---

# 14. SFTP Known Hosts for User `bible`

The SFTP command runs as user `bible`, so the SSH host key must be known for that user.

```bash
sudo -u bible mkdir -p /home/bible/.ssh

ssh-keyscan -H www99.your-server.de | sudo -u bible tee -a /home/bible/.ssh/known_hosts >/dev/null

chown -R bible:bible /home/bible/.ssh
chmod 700 /home/bible/.ssh
chmod 600 /home/bible/.ssh/known_hosts
```

Test SFTP as `bible`:

```bash
cd /var/www/bible-game
sudo -u bible env SSHPASS='YOUR_SFTP_PASSWORD_HERE' npm run deploy:web:sftp
echo $?
```

Expected exit code:

```txt
0
```

---

# 15. systemd Deploy Service

Create:

```bash
cat > /etc/systemd/system/bible-deploy.service <<'EOF'
[Unit]
Description=Deploy Bible Game from GitHub if changed
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/bible-deploy.env
ExecStart=/usr/local/bin/deploy-bible-game.sh
EOF
```

Create timer:

```bash
cat > /etc/systemd/system/bible-deploy.timer <<'EOF'
[Unit]
Description=Check Bible Game GitHub repo for changes

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s
Unit=bible-deploy.service

[Install]
WantedBy=timers.target
EOF
```

Enable:

```bash
systemctl daemon-reload
systemctl enable --now bible-deploy.timer
```

Manual deploy test:

```bash
systemctl start bible-deploy.service
journalctl -u bible-deploy.service -n 150 --no-pager
```

Check timer:

```bash
systemctl status bible-deploy.timer --no-pager
systemctl list-timers --all | grep bible
```

---

# 16. Update from Git on Boot

When the VPS is recreated from a snapshot, the Git state is the old snapshot state.

To make sure the server gets the latest `main` on boot, create:

```bash
cat > /usr/local/bin/boot-update-bible-game.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/bible-game"
BRANCH="main"
SERVICE="bible-server"

cd "$APP_DIR"

echo "$(date -Is) boot update started"

sudo -u bible git fetch origin "$BRANCH"
sudo -u bible git reset --hard "origin/$BRANCH"

sudo -u bible npm ci
sudo -u bible npm run build

# Optional SFTP upload on boot.
# Uncomment if the webhosting static files should also be refreshed on every boot.
# source /etc/bible-deploy.env
# sudo -u bible env SSHPASS="$SSHPASS" npm run deploy:web:sftp

systemctl restart "$SERVICE"
systemctl reload nginx

echo "$(date -Is) boot update finished: $(sudo -u bible git rev-parse HEAD)"
EOF

chmod +x /usr/local/bin/boot-update-bible-game.sh
```

Create systemd service:

```bash
cat > /etc/systemd/system/bible-boot-update.service <<'EOF'
[Unit]
Description=Update Bible Game from GitHub on boot
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/boot-update-bible-game.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
```

Enable:

```bash
systemctl daemon-reload
systemctl enable bible-boot-update.service
```

Test:

```bash
systemctl start bible-boot-update.service
systemctl status bible-boot-update.service --no-pager
journalctl -u bible-boot-update.service -n 100 --no-pager
```

---

# 17. PHP Wake / Destroy Controller

The PHP webhosting controls server creation/destruction through the Hetzner Cloud API.

Endpoint:

```txt
https://komm-folge-mir-nach.de/api/fetch-game-server.php
```

## Wake / heartbeat

```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: https://komm-folge-mir-nach.de" \
  https://komm-folge-mir-nach.de/api/fetch-game-server.php | jq
```

This does:

```txt
- updates heartbeat timestamp
- checks if spirit-game-server exists
- creates server from snapshot if missing
- returns WebSocket URL when ready
```

## Status

```bash
curl -s \
  "https://komm-folge-mir-nach.de/api/fetch-game-server.php?action=status&key=s3cr3t" | jq
```

## Destroy if idle

```bash
curl -s \
  "https://komm-folge-mir-nach.de/api/fetch-game-server.php?action=destroy-if-idle&key=s3cr3t" | jq
```

## Force destroy

```bash
curl -s \
  "https://komm-folge-mir-nach.de/api/fetch-game-server.php?action=destroy-now&key=s3cr3t" | jq
```

---

# 18. PHP CORS Setup

The PHP endpoint allows origins under:

```txt
komm-folge-mir-nach.de
*.komm-folge-mir-nach.de
```

Recommended dynamic CORS logic:

```php
header('Content-Type: application/json');

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedBaseDomain = 'komm-folge-mir-nach.de';

if ($origin !== '') {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $originScheme = parse_url($origin, PHP_URL_SCHEME);

    $isAllowedScheme = $originScheme === 'https';

    $isAllowedHost =
        $originHost === $allowedBaseDomain ||
        str_ends_with($originHost, '.' . $allowedBaseDomain);

    if ($isAllowedScheme && $isAllowedHost) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
}

header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}
```

For PHP 7, replace `str_ends_with()` with:

```php
$isAllowedHost =
    $originHost === $allowedBaseDomain ||
    substr($originHost, -strlen('.' . $allowedBaseDomain)) === '.' . $allowedBaseDomain;
```

---

# 19. GitHub Actions Idle Cron

If Hetzner Webhosting cron is not available, GitHub Actions can call the idle destroy URL.

Create:

```txt
.github/workflows/destroy-idle-game-server.yml
```

Content:

```yaml
name: Destroy idle game server

on:
  schedule:
    - cron: "7,17,27,37,47,57 * * * *"
  workflow_dispatch:

jobs:
  destroy-if-idle:
    runs-on: ubuntu-latest

    steps:
      - name: Call idle destroy endpoint
        run: |
          echo "Running at $(date -u)"
          curl -fsS "https://komm-folge-mir-nach.de/api/fetch-game-server.php?action=destroy-if-idle&key=${{ secrets.GAME_SERVER_CRON_KEY }}"
          echo
          echo "Done at $(date -u)"
```

Store secret:

```txt
Repo -> Settings -> Secrets and variables -> Actions -> New repository secret

Name:
GAME_SERVER_CRON_KEY

Value:
s3cr3t
```

Manual run:

```txt
GitHub -> Actions -> Destroy idle game server -> Run workflow
```

Notes:

```txt
- scheduled workflows only run on the default branch
- GitHub cron can be delayed
- manual execution should work immediately
```

---

# 20. Frontend Online Flow

The static game should not start the VPS on normal page load.

Only when the user accesses online functionality:

```js
const endpoint = "https://komm-folge-mir-nach.de/api/fetch-game-server.php";

async function fetchGameServer() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();

  if (data.status === "ready") {
    return data.websocketUrl;
  }

  if (data.status === "starting") {
    return null;
  }

  throw new Error(data.error || "Could not fetch game server");
}

async function waitForGameServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const websocketUrl = await fetchGameServer();

    if (websocketUrl) {
      return websocketUrl;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error("Game server did not become ready in time");
}
```

WebSocket connection:

```js
const websocketUrl = await waitForGameServer();
const socket = new WebSocket(websocketUrl);
```

While online mode is active, continue calling the same endpoint every 30–60 seconds as heartbeat.

Do not call it during offline/single-player use.

---

# 21. Health Checks

## Server status

```bash
systemctl status bible-server --no-pager
systemctl status bible-deploy.timer --no-pager
systemctl status certbot.timer --no-pager
systemctl status certbot-boot-renew.service --no-pager
systemctl status bible-boot-update.service --no-pager
```

## Nginx

```bash
nginx -t
systemctl status nginx --no-pager
```

## Logs

```bash
journalctl -u bible-server -f
journalctl -u bible-deploy.service -n 150 --no-pager
journalctl -u bible-boot-update.service -n 100 --no-pager
journalctl -u certbot-boot-renew.service -n 100 --no-pager
journalctl -u nginx -n 100 --no-pager
```

## Git version

```bash
cd /var/www/bible-game
git log -1 --oneline
git status
```

## Web

```bash
curl -I https://game.komm-folge-mir-nach.de/game/
curl -I https://game.komm-folge-mir-nach.de/api/
```

## Ports

```bash
ss -tulpn
ufw status verbose
```

Expected public ports:

```txt
22
80
443
```

Port `8787` may listen on `*`, but is blocked by Hetzner Firewall and UFW. Safer long-term is binding Node to `127.0.0.1`.

---

# 22. Snapshot Procedure

After all services work, create a new Hetzner snapshot.

Important: The snapshot must include:

```txt
- updated Git repo
- Node/npm installation
- Nginx config
- Certbot config
- bible-server.service
- bible-deploy.service
- bible-deploy.timer
- bible-boot-update.service
- certbot-boot-renew.service
- /etc/bible-deploy.env
- /home/bible/.ssh/known_hosts
```

Before creating snapshot:

```bash
systemctl status bible-server --no-pager
systemctl status bible-deploy.timer --no-pager
systemctl status bible-boot-update.service --no-pager
systemctl status certbot.timer --no-pager
systemctl status certbot-boot-renew.service --no-pager
nginx -t
certbot certificates
```

Then in Hetzner Cloud Console:

```txt
Server -> Snapshots -> Create snapshot
```

Or via CLI:

```bash
hcloud server create-image spirit-game-server --type snapshot --description "spirit-game-server-updated"
```

---

# 23. Security Notes

Rotate these secrets if they were exposed:

```txt
- Hetzner Cloud API token
- SFTP password
- PHP admin key
```

Recommended:

```txt
- store Hetzner API token outside web root
- store SFTP password only in /etc/bible-deploy.env
- chmod 600 /etc/bible-deploy.env
- restrict SSH to your IP if possible
- keep port 8787 closed publicly
- keep automatic security updates enabled
```

Check unattended upgrades:

```bash
cat /etc/apt/apt.conf.d/20auto-upgrades
systemctl status unattended-upgrades --no-pager
```

Expected:

```txt
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

Check reboot requirement:

```bash
cat /var/run/reboot-required 2>/dev/null || echo "No reboot required"
```

---

# 24. Final Architecture

```txt
User opens:
https://komm-folge-mir-nach.de/game/

Offline game works without VPS.

When online mode is requested:
Browser POSTs:
https://komm-folge-mir-nach.de/api/fetch-game-server.php

PHP checks Hetzner Cloud:
- if server missing: create from snapshot
- if starting: return starting
- if running: return websocketUrl

Browser connects:
wss://game.komm-folge-mir-nach.de/ws

VPS handles:
Nginx -> Node on 127.0.0.1:8787

Idle cron:
GitHub Actions or cron calls:
https://komm-folge-mir-nach.de/api/fetch-game-server.php?action=destroy-if-idle&key=s3cr3t

If idle too long:
PHP deletes the Hetzner VPS.

Primary IPs remain reserved.
DNS remains unchanged.
Next online access recreates the server from snapshot.
```
