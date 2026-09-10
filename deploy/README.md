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

The build is ~75 MB, and all but about a megabyte of that is game art and music
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
`wsUrl()` cannot derive `wss://<host>/ws`. Set `VITE_WS_URL` (and
`VITE_WAKE_ENDPOINT`, if the on-demand server comes back) at build time. See
`apps/web/.env.example`.

## Co-op is currently offline

Co-op used to work like this: the browser POSTed
`komm-folge-mir-nach.de/api/fetch-game-server.php`, that PHP script asked the
Hetzner Cloud API whether the game server existed, created it from a snapshot if
not, and answered `{status, websocketUrl}` until the client could connect. The
same endpoint was the heartbeat (every 5 min from the client), and a cron hitting
`?action=destroy-if-idle` destroyed the VPS after an hour of silence — cheap
co-op, paid for by the session rather than the month.

All of it is gone. `komm-folge-mir-nach.de` no longer resolves, which takes out
both the wake endpoint and `game.komm-folge-mir-nach.de`, the `wss://` host it
handed back. `fetch-game-server.php` was never in this repo — only the CORS
snippet in `spirit-game-server-setup-instructions.md` §18 survives. Whether the
Hetzner snapshot, the reserved Primary IPs and the API token still exist is a
question for the Hetzner account, not this repo.

So `VITE_WAKE_ENDPOINT` is unset by default and the client reports
`ui.coop.errNoServer` immediately. Single-player is unaffected.

Three ways back:

1. **Rehost the controller here.** This host runs PHP 8.5 with curl and a
   writable document root — the sibling quiz project already serves a PHP
   backend from the same box — so `/api/fetch-game-server.php` would work the
   way it did before. The script has to be rewritten from the concept doc, and
   it needs a Hetzner API token, a server snapshot, and a WS subdomain with a
   certificate. Point `VITE_WAKE_ENDPOINT` at it.
2. **Drop the wake step.** Run `apps/server` somewhere permanently and set
   `VITE_WS_URL` to it. Simpler, and the only option that works from a Capacitor
   build without a controller; costs a few euros a month instead of per session.
3. **Leave it off.** Nothing else in the game depends on it.

Whichever way: the old CORS allowlist was origin-based on the dead domain, so it
needs the new host — and `capacitor://localhost` if the native apps are to reach
co-op at all.

`spirit-game-server-setup-concept.md` and
`spirit-game-server-setup-instructions.md` in the repo root describe the old
setup. They are kept for the architecture, not the hostnames.
