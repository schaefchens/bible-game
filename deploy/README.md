# Deployment

The game is a static build. It lives at the **root** of

> https://walkinthespirit.games.schaefchens.de

on Hetzner shared webhosting (`www99.your-server.de`), reached over SFTP with
an account jailed to the subdomain's document root — so remote `/` *is* the web
root.

There is **no shell** on the far side. No tar, no unzip, no atomic swap of a
staging directory. Every remote operation the deploy performs has to be
expressible as an `sftp` batch command, and files go up one at a time.

## Quick start

```sh
cp sftp.env.example sftp.env    # then fill in the credentials
brew install sshpass            # the only non-standard dependency
npm run deploy
```

## Commands

| command | what it does |
| --- | --- |
| `npm run deploy` | build, upload what changed, verify |
| `npm run deploy:dry` | print the plan; upload nothing |
| `npm run deploy:fast` | upload the existing `apps/web/dist` without rebuilding |
| `npm run deploy:full` | re-upload everything and delete what the build no longer produces |
| `npm run deploy:verify` | run the HTTP checks against the live site only |

`scripts/deploy.sh --help` lists the underlying flags (`--jobs N` sets the
number of parallel SFTP connections, default 4).

## Why it uploads incrementally

The build is ~68 MB, and all but about a megabyte of that is game art and music
copied verbatim from `apps/web/public/assets`. Those filenames are stable —
they change when someone replaces a piece of art, not on every build. Pushing
all of it every time would make a one-line copy fix a fifteen-minute deploy.

So each deploy writes a `.deploy-manifest` of content hashes into the web root.
The next deploy fetches it, diffs it against a fresh hash of `dist`, and uploads
only the difference — cross-checked against the real remote file sizes from
`ls -l`, so a file deleted or truncated on the server comes back even though the
manifest still claims it is fine.

The manifest is uploaded **last**, after everything it describes. A deploy that
dies halfway leaves the old manifest in place, and the next run simply picks up
where it stopped. `.deploy-manifest` is denied over HTTP by the root `.htaccess`.

Two things make the manifest stale rather than wrong, and both are recoverable:
if you ever change files on the server by hand, run `npm run deploy:full` to
resynchronise.

## Upload order

Order matters because clients can load the site mid-deploy:

1. directories (`-mkdir`, pre-order, failures ignored — that is the idempotent path)
2. everything except the entry points, sharded across parallel connections
3. `.htaccess` (root + `/assets`), then `index.html` / `sw.js`, then the manifest

An `index.html` that arrived before its bundle would 404 on every script for
whoever loaded it in that window. Content-hashed assets are safe to upload
early precisely because nothing references them yet.

## Caching

`deploy/htaccess-root` and `deploy/htaccess-assets` are templates in the repo —
**edit them here, never the copies on the server**, or the next deploy silently
reverts your change.

`/assets` holds two kinds of file that need opposite rules:

- `index-<hash>.js` / `.css` — the hash is in the name, so a change is a new
  URL. `immutable`, one year.
- `*.webp`, `*.mp3`, `*.jpg` — stable names. Replacing a piece of art reuses
  its URL, so `immutable` would strand players on the old file forever. One
  week, with the service worker (`CacheFirst`, `wis-images-v1` / `wis-audio-v1`)
  doing the real work for repeat visits and offline.

`index.html`, `sw.js` and `manifest.webmanifest` are always revalidated. A
client holding a stale `index.html` boots asset hashes that no longer exist and
cannot recover.

## Verification

Every deploy ends with HTTP checks against the live site, and
`npm run deploy:verify` runs them on their own. They cover the failures that are
otherwise invisible: the app loading at `/`, `index.html` asking for its assets
at the root base (a build still carrying the old `/game/` base serves a
perfectly good 200 whose every script 404s), the PWA files being present and
correctly typed, the bundle actually arriving gzipped, a `.webp` and an `.mp3`
served with the right content type, the SPA fallback, and `.deploy-manifest`
plus directory listings being denied.

## Capacitor (Android / iOS)

The web build is not the app build. Native shells load `index.html` off the
device filesystem, where an absolute `/assets/...` resolves to the device root:

```sh
npm run build:app     # VITE_BASE=./ VITE_DISABLE_PWA=1
```

That is `apps/web/dist` ready to be a Capacitor `webDir`. Two differences:

- **Relative base.** Everything already routes through `import.meta.env.BASE_URL`
  (`src/asset.ts`, `setAssetBase` in `main.tsx`, `packages/assets`), so `./` is
  the only change needed. Nothing hardcodes an absolute path — keep it that way.
- **No service worker.** The native shell already serves the bundle locally; a
  second cache layer inside the webview only invents staleness bugs. The PWA
  plugin is disabled rather than removed, so `virtual:pwa-register` still
  resolves and no app code needs conditional imports.

Co-op needs one more thing: a Capacitor build has no same-origin server, so
`wsUrl()` cannot derive `wss://<host>/ws`. Set `VITE_WS_URL` and
`VITE_WAKE_ENDPOINT` at build time — the web build gets the latter from
`.env.production`, which a native build does not inherit usefully. See
`apps/web/.env.example`.

## Co-op

Co-op is **live**. The browser POSTs `/api/fetch-game-server.php`, that PHP
script asks the Hetzner Cloud API whether the game server exists, creates it
from a snapshot if not, and answers `{status, websocketUrl}` until the client
can connect. The same endpoint is the heartbeat, and the VPS is destroyed after
an hour of silence — co-op paid for by the session rather than the month.

The pieces, and where they live:

| piece | where |
| --- | --- |
| wake controller / heartbeat / reaper | [`deploy/api/`](api/README.md), shipped to `/api` by the deploy |
| its secrets (Hetzner token, admin key) | `deploy/api/config.php` — gitignored, never client-side |
| the VPS's own config (nginx, boot, timers) | [`deploy/server/`](server/) via `provision.sh` |
| the client's on-switch | `VITE_WAKE_ENDPOINT` in `apps/web/.env.production` |

The WebSocket host is **walkinthespirit-coop.games.schaefchens.de**, dual-stack,
with its own certificate. `VITE_WS_URL` is deliberately left unset for the web:
the client probes the same-origin `/ws` first and otherwise connects to whatever
`websocketUrl` the wake endpoint hands back, so the host is configured in one
place instead of two that can disagree. Only Capacitor must set it, having no
same-origin server to probe.

A cold wake takes about **40 seconds** from the POST to a joinable room, most of
it the VPS booting from the snapshot. The client shows the queue modal for the
duration.

### Operating it

The endpoint doubles as the admin surface; every action is audit-logged and
needs the admin key from `config.php`:

```sh
curl 'https://walkinthespirit.games.schaefchens.de/api/fetch-game-server.php?action=status&key=...'
```

`action=destroy-now` kills the server immediately; `destroy-if-idle` is what the
hourly webhosting cron calls, and the GitHub workflow is only a spare in case
that cron stops firing. A bare `GET` with no key answers 403, which is the
correct response and not a symptom.

If co-op breaks, the order to check is: does the wake endpoint answer at all
(config present? token still valid?), does the snapshot id still exist (a stale
one fails when a player clicks Play Co-op, never at deploy time), does DNS still
point at the reserved IPv4, and is `allowed_origins` current — it needs the game
origin, plus `https://localhost` / `capacitor://localhost` for the native apps.

### Why a version mismatch is about content, not commits

The VPS resets itself to `origin/main` every minute (`deploy-bible-game.sh`),
while the web bundle only moves when someone runs `npm run deploy`. The server is
therefore *routinely* a few commits ahead of the deployed client, and that is
normal — nothing is wrong with it.

So the compatibility gate every client passes at join compares a **hash of the
content bundle** (`contentHash` in `@bible/content`), not a git sha. Same cards,
same rules, whatever commit built them. The git sha still rides along so a real
mismatch can be reported as two concrete builds, and the server logs its own at
startup. A gate on the sha would have refused co-op after every docs commit;
until this was fixed it had the opposite fault, being switched off entirely, so
a genuinely stale tab could join and quietly render a different game.

Rebalance a card and the hash moves: deploy the web app and the server in the
same session, or players on the old bundle are turned away — correctly, but
they will have to reload to find that out.

`spirit-game-server-setup-concept.md` and
`spirit-game-server-setup-instructions.md` in the repo root describe the old
VPS-side setup (nginx, certbot, git deploy). They are kept for the
architecture, not the hostnames.
