````markdown
# Concept Paper: On-Demand Multiplayer Game Server

## 1. Purpose

The system provides an on-demand online multiplayer backend for the game at:

```txt
https://komm-folge-mir-nach.de/game/
````

The main game can run without a dedicated game server. The Hetzner Cloud VPS is only started when a user accesses online functionality, such as multiplayer. When the online server is no longer used for a configured idle period, it is automatically destroyed to reduce server cost.

## 2. Core Idea

The game is split into two parts:

```txt
Static game frontend:
https://komm-folge-mir-nach.de/game/

Dynamic online backend:
https://game.komm-folge-mir-nach.de/game/
wss://game.komm-folge-mir-nach.de/ws
```

The static frontend is always available through normal web hosting. The multiplayer backend runs on a Hetzner Cloud VPS and can be created or deleted dynamically through the Hetzner Cloud API.

## 3. Main Components

### Static Web Hosting

The public website and PHP control endpoint are hosted on Hetzner Webhosting:

```txt
https://komm-folge-mir-nach.de/
```

This hosting remains online permanently and is responsible for starting the game server when needed.

### PHP Control Endpoint

The control script is available at:

```txt
https://komm-folge-mir-nach.de/api/fetch-game-server.php
```

It has three responsibilities:

```txt
1. Wake or create the Hetzner Cloud game server.
2. Act as a heartbeat endpoint while online mode is active.
3. Destroy the game server when it has been idle long enough.
```

### Hetzner Cloud VPS

The game server is created from a prepared snapshot:

```txt
Server name: spirit-game-server
Snapshot ID: 405851755
Server type: cpx12
Location: Falkenstein
```

It uses reserved Hetzner Primary IPs so DNS does not need to change after deletion and recreation.

### Nginx

Nginx runs on the VPS and routes public traffic:

```txt
/game/   -> static Vite build
/ws      -> Node.js WebSocket server
/api/    -> Node.js API server
```

### Node.js Server

The Node.js server runs the multiplayer/backend functionality on port:

```txt
8787
```

This port is not exposed directly to the public internet. Public access goes through Nginx over HTTPS/WSS.

### GitHub Repository

The application source code is stored in GitHub:

```txt
https://github.com/scharfmedia/bible-game
```

The VPS updates itself from `origin/main` on boot and also checks regularly for Git changes.

## 4. Request Flow

When a user opens the game normally:

```txt
User -> https://komm-folge-mir-nach.de/game/
```

No VPS is required.

When the user enters online mode:

```txt
Browser -> POST https://komm-folge-mir-nach.de/api/fetch-game-server.php
```

The PHP script checks Hetzner Cloud:

```txt
If server is running:
    return websocketUrl

If server exists but is booting:
    return status "starting"

If server does not exist:
    create server from snapshot
    return status "starting"
```

The frontend polls the endpoint until it receives:

```json
{
  "status": "ready",
  "websocketUrl": "wss://game.komm-folge-mir-nach.de/ws"
}
```

Then the browser connects to the WebSocket server.

## 5. Heartbeat and Idle Shutdown

The same PHP endpoint also acts as the heartbeat endpoint.

While online mode is active, the frontend periodically calls:

```txt
POST https://komm-folge-mir-nach.de/api/fetch-game-server.php
```

Each call updates the last activity timestamp.

A scheduled job calls:

```txt
GET https://komm-folge-mir-nach.de/api/fetch-game-server.php?action=destroy-if-idle&key=...
```

If the last activity is older than the configured idle timeout, the PHP script deletes the Hetzner Cloud VPS.

The Primary IPs remain reserved, so the domain continues to point to the same IP for the next server creation.

## 6. Boot-Time Recovery

Because the server is recreated from a snapshot, the snapshot may contain an older Git state or an older SSL certificate.

To handle this, the VPS runs boot-time services:

```txt
bible-boot-update.service
certbot-boot-renew.service
```

On boot:

```txt
1. The server checks and renews SSL certificates if needed.
2. The repository is updated to the latest origin/main.
3. Dependencies are installed.
4. The web app is rebuilt.
5. The Node.js service is restarted.
6. Nginx is reloaded.
```

This ensures that even an old snapshot becomes current shortly after startup.

## 7. Deployment Flow

When the Git repository changes, the VPS deploy script:

```txt
1. Fetches origin/main.
2. Compares local and remote commits.
3. If changed, resets to origin/main.
4. Runs npm ci.
5. Builds the app.
6. Uploads the static build to Hetzner Webhosting via SFTP.
7. Restarts the Node.js service.
8. Reloads Nginx.
```

This keeps both the VPS and the webhosting copy of the frontend updated.

## 8. Security Model

Only these ports are publicly exposed:

```txt
22/tcp   SSH
80/tcp   HTTP / Let's Encrypt
443/tcp  HTTPS / WSS
```

The Node.js backend port is blocked publicly:

```txt
8787/tcp
```

Protection layers:

```txt
Hetzner Cloud Firewall
Ubuntu UFW Firewall
Nginx reverse proxy
HTTPS via Let's Encrypt
API key for admin destroy/status actions
Hetzner API token stored server-side only
```

The Hetzner API token is never exposed to the browser. Browser clients can only call the PHP control endpoint.

## 9. Cost Behavior

The system is designed to reduce Hetzner Cloud server cost.

When nobody uses online mode:

```txt
No VPS needs to exist.
Only webhosting, Primary IPs, and snapshots remain.
```

When online mode is used:

```txt
The VPS is created automatically.
Users connect to the WebSocket backend.
```

After idle timeout:

```txt
The VPS is deleted automatically.
```

This is more cost-efficient than keeping the VPS running permanently, while still allowing online functionality to be started on demand.

## 10. Operational Tradeoffs

Advantages:

```txt
Lower cloud server cost
Static game stays online permanently
Automatic server recreation
Stable DNS through Primary IPs
Automatic Git update on boot
SSL renewal recovery on boot
```

Tradeoffs:

```txt
First online user must wait while the VPS starts
The PHP control script is a critical component
Snapshot must be maintained after infrastructure changes
Hetzner API token must be protected
GitHub/cron idle checks may be delayed
```

## 11. Final Architecture

```txt
User
 |
 | opens static game
 v
https://komm-folge-mir-nach.de/game/
 |
 | user selects online mode
 v
PHP control endpoint
https://komm-folge-mir-nach.de/api/fetch-game-server.php
 |
 | Hetzner Cloud API
 v
Create or check VPS
spirit-game-server
 |
 | once ready
 v
https://game.komm-folge-mir-nach.de/game/
wss://game.komm-folge-mir-nach.de/ws
 |
 | idle cron
 v
destroy VPS if inactive
```

```
```

