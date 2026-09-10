# The co-op wake controller

`fetch-game-server.php` boots the co-op server on demand and destroys it again
when nobody is playing, so multiplayer costs a session rather than a month.

It came from the `come-follow-me-website` repo, where it lived at
`public/api/fetch-game-server.php` and served `komm-folge-mir-nach.de`. The game
owns it now.

## Status: not deployed

The deploy skips `/api` entirely unless `deploy/api/config.php` exists. It does
not, and three things have to be true before it should:

1. **A fresh Hetzner Cloud API token.** The one in the old file is committed to
   a public GitHub repository and must be treated as compromised — rotate it in
   the Hetzner console rather than reusing it. This port has no fallback token
   in source, and refuses to run unconfigured rather than guessing.
2. **A real admin key.** The old default was the literal string `s3cr3t`, and it
   was never changed. It guards `destroy-now`. `openssl rand -hex 32`.
3. **A WebSocket host.** `wss://game.komm-folge-mir-nach.de/ws` is gone with its
   domain. A new subdomain needs a DNS record pointing at the reserved primary
   IPv4, and a certificate.

Also worth checking before trusting the carried-over ids in
`config.php.example`: whether the snapshot (`image`), the reserved primary IPs
and the firewall still exist in the Hetzner project. A stale snapshot id fails
at server-creation time, which is to say the first time a player clicks Play
Co-op, not at deploy time.

## How it works

```
browser                        this file                     Hetzner Cloud
   │  POST /api/fetch-game-server.php │                             │
   ├─────────────────────────────────►│  write heartbeat            │
   │                                  ├────── GET /servers ────────►│
   │                                  │                             │
   │        {status:"starting"}       │◄──── POST /servers ────────►│  create
   │◄─────────────────────────────────┤        (from snapshot)      │  from
   │                                  │                             │  snapshot
   │  … poll every 3s …               │                             │
   │                                  │                             │
   │  {status:"ready",                │                             │
   │   websocketUrl:"wss://…/ws"}     │                             │
   │◄─────────────────────────────────┤                             │
   │                                                                │
   └──────────────── wss:// ─────────────────────────────► the game server
```

The same POST is the heartbeat — the client repeats it every 5 minutes while
co-op is open (`apps/web/src/net/client.ts`). A cron calls
`?action=destroy-if-idle` every 10 minutes, and once the last heartbeat is older
than `idle_destroy_after_seconds` (1 h) the VPS is deleted. The primary IPs stay
reserved, so the DNS record keeps pointing at the right address next time.

`flock` around the whole request is what stops two players clicking Play Co-op
at the same moment from creating two servers.

## The client half

`apps/web/src/net/serverResolve.ts`. It probes the same-origin `/ws` first (that
is the dev path, where `npm run server` answers directly) and only falls back to
this endpoint. Switch it on with:

```
VITE_WAKE_ENDPOINT=https://walkinthespirit.games.schaefchens.de/api/fetch-game-server.php
```

Unset — the current state — `wake()` returns null without a request and the
client reports `ui.coop.errNoServer` immediately.

Native builds need it too, plus `VITE_WS_URL`: a Capacitor webview has no
same-origin `/ws` to probe. It also sends `Origin: https://localhost` (Android)
or `capacitor://localhost` (iOS), so those belong in `allowed_origins` or the
CORS check drops the response.

## Endpoints

`POST /api/fetch-game-server.php` — wake + heartbeat. No key; CORS-guarded.

```json
{ "status": "ready",
  "serverStatus": "running",
  "gameUrl": "https://walkinthespirit.games.schaefchens.de/",
  "websocketUrl": "wss://…/ws",
  "heartbeat": { "lastActivity": 1783438200, "ageSeconds": 0 } }
```

`status` is `ready` (connect now), `starting` (poll again), or `error`.

The GET actions all require `&key=<admin_key>`:

| action | what it does |
| --- | --- |
| `?action=status` | does the server exist, what state, how old is the heartbeat |
| `?action=destroy-if-idle` | delete it **only** if idle past the timeout — the cron's call |
| `?action=destroy-now` | delete it regardless. Manual, admin-side |

Replies: `ok`, `not-destroyed`, `destroying`, `already-destroyed`, `error`.

## Files on the server

`deploy/htaccess-api` denies everything in `/api` except the endpoint itself, so
`config.php` (the token), `spirit-game-last-activity.txt` (the heartbeat) and
`spirit-game-server.lock` are not readable over HTTP. The old deployment had no
`.htaccess` in that directory at all. The deploy uploads the `.htaccess` before
`config.php` for the same reason.

The two runtime files are written by PHP next to the script and are gitignored.

## Idle cron

A **Hetzner Webhosting cron** calls this hourly and is the live reaper:

```
https://walkinthespirit.games.schaefchens.de/api/fetch-game-server.php?action=destroy-if-idle&key=<admin_key>
```

Hourly is the shortest interval that panel offers, and with a one-hour idle
window that means an abandoned server lives up to two hours (~1.5 average).
At €0.0219/h for a cpx12 that is about three cents a session, so the window is
deliberately left at an hour rather than tightened: the client heartbeats every
five minutes, browsers freeze timers in hidden tabs after about five, and rooms
are in-memory, so a mistimed destroy loses everyone's run to save half a cent.

`.github/workflows/destroy-idle-game-server.yml` is the same call as a spare,
manual-only. Its schedule is commented out so it does not duplicate the cron.

Verify either of them from `admin-audit.log` (see below) — a reaper calling
with a stale key returns 403 forever while looking perfectly healthy from the
outside.

## Audit log

`admin-audit.log`, next to the script, denied over HTTP and read over SFTP.
One tab-separated line per server creation, per destroy attempt with its
outcome, and per refused admin call: time, method, event, detail, caller IP.

The caller IP is what makes it usable. The deploy's own verification does a
keyless GET to assert the endpoint refuses unauthenticated access, so every
deploy leaves an `admin-denied` line from the workstation; the cron's lines
come from the host.
