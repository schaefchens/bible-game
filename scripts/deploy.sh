#!/usr/bin/env bash
#
# Deploy Walk in the Spirit to https://walkinthespirit.games.schaefchens.de
#
# The SFTP account is jailed to the subdomain's document root, so remote "/" is
# the web root and the whole build goes there — the site lives at "/", not
# under a subpath. There is no shell on the far side: no tar, no unzip, no
# atomic swap of a staging tree. Files are put one at a time.
#
# Which is why this uploads INCREMENTALLY. The build is ~70 MB, and all but a
# megabyte of it is game art and music with stable filenames that change maybe
# once a month. Every deploy writes a `.deploy-manifest` of content hashes next
# to the app; the next deploy fetches it, diffs, and uploads only what actually
# changed — cross-checked against the real remote file sizes so a file deleted
# on the server comes back even though the manifest still lists it.
#
# Usage: scripts/deploy.sh [options]
#
#   --skip-build    upload the existing apps/web/dist as-is
#   --force-all     ignore the manifest; re-upload every file
#   --prune         delete remote files this build no longer produces
#   --jobs N        parallel sftp connections (default 4)
#   --dry-run       print the plan; upload nothing
#   --verify-only   run the post-deploy HTTP checks and exit
#   -h, --help      this text
#
# Default: build, upload what changed, then verify.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SITE_URL="https://walkinthespirit.games.schaefchens.de"
DIST="apps/web/dist"
ENV_FILE="sftp.env"
MANIFEST_NAME=".deploy-manifest"

# Uploaded last, after everything they reference is already in place. A client
# that fetches a new index.html mid-deploy would otherwise 404 on its bundle.
ENTRY_FILES=(index.html sw.js registerSW.js)

die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[34m==>\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

# shellcheck source=scripts/lib/sftp.sh
. "$REPO_ROOT/scripts/lib/sftp.sh"

DO_BUILD=1 FORCE_ALL=0 DO_PRUNE=0 DRY_RUN=0 VERIFY_ONLY=0 JOBS=4

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build)  DO_BUILD=0 ;;
    --force-all)   FORCE_ALL=1 ;;
    --prune)       DO_PRUNE=1 ;;
    --jobs)        shift; JOBS="${1:-4}" ;;
    --dry-run)     DRY_RUN=1 ;;
    --verify-only) VERIFY_ONLY=1 ;;
    -h|--help)     sed -n '2,29p' "$0" | sed 's/^#\{1,2\} \{0,1\}//'; exit 0 ;;
    *)             die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

case "$JOBS" in ''|*[!0-9]*) die "--jobs needs a number" ;; esac
[ "$JOBS" -ge 1 ] || die "--jobs must be at least 1"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# --- build -------------------------------------------------------------------

build() {
  info "Building apps/web (base '/')"
  # No VITE_BASE here: the web build defaults to "/" now that the site owns the
  # domain root. Capacitor builds pass VITE_BASE=./ — see `npm run build:app`.
  npm run build --workspace @bible/web
  [ -f "$DIST/index.html" ] || die "build produced no $DIST/index.html"
}

# --- manifests ---------------------------------------------------------------

# "<sha256>  <path>" for every non-dotfile in dist. .DS_Store and friends never
# reach the server.
#
# `shasum -a 256` spelled out rather than wrapped in a helper: xargs execs a
# binary, not a shell function, and macOS ships its own `sha256` whose output
# format ("SHA256 (path) = hash") parses as garbage here.
#
# Sorted whole-line, which is all `comm` requires of both sides — the hash
# prefix makes the order meaningless as a path order, and nothing depends on
# it being one.
build_local_manifest() {
  ( cd "$DIST" && find . -type f ! -name '.*' -print0 | xargs -0 shasum -a 256 ) \
    | sed 's|^\([0-9a-f]\{64\}\)  \./|\1  |' \
    | LC_ALL=C sort
}

# Strip the hash off manifest lines, leaving the paths (which may contain spaces
# — shasum separates the two with exactly two spaces).
manifest_paths() { sed 's|^[0-9a-f]\{64\}  ||' "$@"; }

# "<path>\t<size>" for what is actually on the server right now.
#
# The directory list comes from the build rather than being hardcoded to
# / and /assets: `ls -l` is the only remote inventory there is, one round trip
# per directory, and a build that grows a third one would otherwise lose its
# cross-check without anyone noticing.
build_remote_sizes() {
  local dir
  remote_file_sizes /
  while IFS= read -r dir; do
    dir="${dir#./}"
    remote_file_sizes "/$dir" | sed "s|^|$dir/|"
  done < <(cd "$DIST" && find . -mindepth 1 -type d ! -name '.*' | LC_ALL=C sort)
}

# "<path>\t<size>" for the local build. BSD stat (macOS) and GNU stat (Linux/CI)
# spell the same query differently and neither accepts the other's flags, so
# the flavour is settled once at startup rather than guessed per call.
STAT_FLAVOUR=gnu
stat -f '%z' . >/dev/null 2>&1 && STAT_FLAVOUR=bsd

local_sizes() {
  (
    cd "$DIST"
    if [ "$STAT_FLAVOUR" = bsd ]; then
      find . -type f ! -name '.*' -print0 | xargs -0 stat -f '%z %N'
    else
      find . -type f ! -name '.*' -print0 | xargs -0 stat -c '%s %n'
    fi
  ) | awk '{ size = $1; $1 = ""; sub(/^ /, ""); sub(/^\.\//, ""); printf "%s\t%s\n", $0, size }'
}

# --- planning ----------------------------------------------------------------

# Fills $WORK/upload with the dist-relative paths that need to go up.
plan() {
  info "Hashing $DIST"
  build_local_manifest > "$WORK/local.man"
  local total; total=$(wc -l < "$WORK/local.man" | tr -d ' ')
  ok "$total file(s), $(du -sh "$DIST" | cut -f1 | tr -d ' \t') on disk"

  if [ "$FORCE_ALL" -eq 1 ]; then
    info "--force-all: uploading everything"
    manifest_paths "$WORK/local.man" > "$WORK/upload"
    return
  fi

  info "Reading remote state"
  if remote_get "/$MANIFEST_NAME" "$WORK/remote.man"; then
    LC_ALL=C sort "$WORK/remote.man" -o "$WORK/remote.man"
    ok "manifest found ($(wc -l < "$WORK/remote.man" | tr -d ' ') entries)"
  else
    : > "$WORK/remote.man"
    ok "no manifest on the server — treating this as a first deploy"
  fi
  build_remote_sizes > "$WORK/remote.sizes"
  local_sizes | LC_ALL=C sort > "$WORK/local.sizes"
  LC_ALL=C sort "$WORK/remote.sizes" -o "$WORK/remote.sizes"
  ok "$(wc -l < "$WORK/remote.sizes" | tr -d ' ') file(s) currently on the server"

  # (a) content changed, or the path is new: the exact "<hash>  <path>" pair is
  #     in the local manifest but not the remote one.
  LC_ALL=C comm -23 "$WORK/local.man" "$WORK/remote.man" \
    | manifest_paths > "$WORK/changed"

  # (b) the manifest and the server disagree: the file is missing remotely, or
  #     it is there at a different size (a truncated upload from a run that was
  #     interrupted after the manifest went up). Hashes alone would miss both.
  LC_ALL=C comm -23 "$WORK/local.sizes" "$WORK/remote.sizes" \
    | cut -f1 > "$WORK/mismatched"

  cat "$WORK/changed" "$WORK/mismatched" | LC_ALL=C sort -u > "$WORK/upload"
}

# --- upload ------------------------------------------------------------------

# sftp_batch <batch-file> [stdout-log]
#
# stdout carries sftp's per-command chatter ("Uploading …"), which is the only
# progress signal available; it is discarded unless a log is asked for.
sftp_batch() {
  local batch="$1" out="${2:-/dev/null}" err status=0
  err=$(mktemp)
  run_sftp "$batch" > "$out" 2>"$err" || status=$?
  # `-mkdir` on a directory that already exists reports "Failure" and is
  # ignored by sftp — that is the idempotent path, not a problem. Anything
  # else from stderr is worth seeing.
  grep -v 'remote mkdir .*: Failure' "$err" >&2 || true
  rm -f "$err"
  return "$status"
}

make_dirs() {
  local batch="$WORK/mkdir.batch" d
  : > "$batch"
  # find is pre-order, so parents are always created before their children.
  while IFS= read -r d; do
    printf -- '-mkdir /%s\n' "${d#./}" >> "$batch"
  done < <(cd "$DIST" && find . -mindepth 1 -type d ! -name '.*' | LC_ALL=C sort)
  [ -s "$batch" ] || return 0
  sftp_batch "$batch" || die "could not create remote directories"
}

# Splits the upload list across $JOBS sftp connections. One connection tops out
# well below the link; the art directory is 70 MB of small-to-medium files and
# four streams cut a cold deploy from ~20 minutes to ~5.
upload_bulk() {
  local count; count=$(wc -l < "$WORK/upload.bulk" | tr -d ' ')
  [ "$count" -gt 0 ] || return 0

  local jobs="$JOBS"
  [ "$jobs" -gt "$count" ] && jobs="$count"

  local i n=0 path
  for i in $(seq 1 "$jobs"); do : > "$WORK/shard.$i.batch"; done
  while IFS= read -r path; do
    n=$(( n + 1 ))
    i=$(( (n - 1) % jobs + 1 ))
    printf 'put %s /%s\n' "$REPO_ROOT/$DIST/$path" "$path" >> "$WORK/shard.$i.batch"
  done < "$WORK/upload.bulk"

  info "Uploading $count file(s) over $jobs connection(s)"
  local pids=() failed=0 watcher=""
  for i in $(seq 1 "$jobs"); do
    sftp_batch "$WORK/shard.$i.batch" "$WORK/shard.$i.log" 2>"$WORK/shard.$i.err" &
    pids+=("$!")
  done

  # Only draw progress on a terminal; in CI or a pipe it would be a wall of
  # half-overwritten lines.
  if [ -t 1 ]; then progress_watch "$count" & watcher=$!; fi
  for i in "${!pids[@]}"; do
    wait "${pids[$i]}" || failed=$(( failed + 1 ))
  done
  if [ -n "$watcher" ]; then
    kill "$watcher" 2>/dev/null || true
    wait "$watcher" 2>/dev/null || true
    printf '\r\033[K'
  fi

  if [ "$failed" -gt 0 ]; then
    cat "$WORK"/shard.*.err >&2
    die "$failed of $jobs upload connection(s) failed — rerun to resume (the manifest was not updated)"
  fi
  ok "$count file(s) uploaded"
}

# sftp -b echoes one "Uploading …" line per put; counting them across the shard
# logs is the only progress signal available.
progress_watch() {
  local total="$1" done_n
  while :; do
    sleep 2
    done_n=$(cat "$WORK"/shard.*.log 2>/dev/null | grep -c '^Uploading' || true)
    printf '\r\033[K    %s/%s files' "${done_n:-0}" "$total"
  done
}

# Entry points and the config files, in dependency order, on one connection.
upload_tail() {
  local batch="$WORK/tail.batch" f
  : > "$batch"

  printf 'put %s /.htaccess\n' "$REPO_ROOT/deploy/htaccess-root" >> "$batch"
  [ -d "$DIST/assets" ] && \
    printf 'put %s /assets/.htaccess\n' "$REPO_ROOT/deploy/htaccess-assets" >> "$batch"

  for f in "${ENTRY_FILES[@]}"; do
    [ -f "$DIST/$f" ] && printf 'put %s /%s\n' "$REPO_ROOT/$DIST/$f" "$f" >> "$batch"
  done

  # The manifest goes up last and only last: it is this deploy's claim about
  # what the server holds, and it must not be believed until it is true.
  cp "$WORK/local.man" "$WORK/$MANIFEST_NAME"
  printf 'put %s /%s\n' "$WORK/$MANIFEST_NAME" "$MANIFEST_NAME" >> "$batch"

  sftp_batch "$batch" || die "entry-point upload failed"
  ok "entry points, .htaccess and manifest written"
}

# --- prune -------------------------------------------------------------------

prune() {
  info "Pruning files this build does not produce"

  cut -f1 "$WORK/remote.sizes" 2>/dev/null | LC_ALL=C sort > "$WORK/remote.paths" || : > "$WORK/remote.paths"
  manifest_paths "$WORK/local.man" | LC_ALL=C sort > "$WORK/local.paths"

  LC_ALL=C comm -23 "$WORK/remote.paths" "$WORK/local.paths" > "$WORK/stale"
  local n; n=$(wc -l < "$WORK/stale" | tr -d ' ')

  if [ "$n" -eq 0 ]; then ok "nothing stale"; return; fi
  sed 's|^|  - |' "$WORK/stale"

  if [ "$DRY_RUN" -eq 1 ]; then ok "would remove $n file(s)"; return; fi
  sed 's|^|rm /|' "$WORK/stale" > "$WORK/prune.batch"
  sftp_batch "$WORK/prune.batch" || die "prune failed"
  ok "removed $n file(s)"
}

# --- verify ------------------------------------------------------------------

# Checks what the deploy is supposed to guarantee: the app loads at the root,
# it is asking for its assets at the root (not the old /game/ base), the PWA
# pieces are intact, the bundle arrives compressed, and bookkeeping is hidden.
verify() {
  info "Verifying $SITE_URL"
  local failed=0

  check_status() {
    local path="$1" want="$2" label="$3" got
    # No -f: a 403 is a pass for the denied paths, and -f would make curl exit
    # nonzero and report the status twice.
    got=$(curl -sS -o /dev/null -w '%{http_code}' "$SITE_URL$path" 2>/dev/null || echo 000)
    if [ "$got" = "$want" ]; then ok "$label ($path → $got)"
    else bad "$label ($path → $got, expected $want)"; failed=$(( failed + 1 )); fi
  }

  check_status /                    200 "app loads"
  check_status /sw.js               200 "service worker"
  check_status /manifest.webmanifest 200 "PWA manifest"
  check_status /pwa-512.png         200 "install icon"
  check_status "/$MANIFEST_NAME"    403 "deploy manifest hidden"
  check_status /assets/             403 "no directory listing"

  local html; html=$(curl -fsS "$SITE_URL/" 2>/dev/null || true)

  # The failure this catches is the one that actually happened: a build still
  # carrying base "/game/" serves a 200 index.html whose every script 404s.
  if printf '%s' "$html" | grep -q 'src="/assets/'; then
    ok "index.html references assets at the root base"
  else
    bad "index.html does not reference /assets/ — stale VITE_BASE?"
    printf '%s' "$html" | grep -o 'src="[^"]*"' | sed 's/^/      /'
    failed=$(( failed + 1 ))
  fi
  printf '%s' "$html" | grep -q '/game/' && { bad "index.html still contains /game/"; failed=$(( failed + 1 )); }

  # The main bundle must arrive gzipped. This broke on the sibling project
  # because the host sends .js as text/javascript while the deflate filter only
  # listed application/javascript — a 3x payload with no visible symptom.
  local js_path wire
  js_path=$(printf '%s' "$html" | grep -o '/assets/[^"]*\.js' | head -n1)
  if [ -n "$js_path" ]; then
    if curl -sS -H 'Accept-Encoding: gzip' -D - -o /dev/null "$SITE_URL$js_path" 2>/dev/null \
         | grep -qi 'content-encoding: gzip'; then
      wire=$(curl -sS -H 'Accept-Encoding: gzip' --output - "$SITE_URL$js_path" 2>/dev/null | wc -c | tr -d ' ')
      ok "bundle served gzipped (${wire} bytes on the wire)"
    else
      bad "bundle is NOT compressed ($js_path) — check the deflate types"
      failed=$(( failed + 1 ))
    fi
  fi

  # One art file and one music file, end to end: right status, right type. The
  # 70 MB of media is the bulk of the deploy and the part a partial upload
  # would quietly break.
  check_asset() {
    local path="$1" want_type="$2" label="$3" hdr
    hdr=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$SITE_URL$path" 2>/dev/null || echo "000 -")
    case "$hdr" in
      "200 $want_type"*) ok "$label ($path → $hdr)" ;;
      *) bad "$label ($path → $hdr, expected 200 $want_type)"; failed=$(( failed + 1 )) ;;
    esac
  }

  local a_webp a_mp3
  a_webp=$(cd "$DIST/assets" 2>/dev/null && ls *.webp 2>/dev/null | head -n1) || true
  a_mp3=$(cd "$DIST/assets" 2>/dev/null && ls *.mp3 2>/dev/null | head -n1) || true
  [ -n "${a_webp:-}" ] && check_asset "/assets/$a_webp" "image/webp" "art served"
  [ -n "${a_mp3:-}"  ] && check_asset "/assets/$a_mp3"  "audio/mpeg" "music served"

  # A deep path must fall through to the app shell, not 404 — that is what the
  # rewrite in htaccess-root is for, and it is invisible until someone links
  # into the game.
  check_status /some/deep/path 200 "SPA fallback"

  [ "$failed" -eq 0 ] || die "$failed check(s) failed"
  info "All checks passed"
}

# --- main --------------------------------------------------------------------

require_tools sshpass sftp curl shasum
load_credentials "$ENV_FILE"

if [ "$VERIFY_ONLY" -eq 1 ]; then verify; exit 0; fi

[ "$DO_BUILD" -eq 1 ] && build
[ -d "$DIST" ] || die "$DIST not found — run without --skip-build"

plan

TOTAL=$(wc -l < "$WORK/upload" | tr -d ' ')

if [ "$DRY_RUN" -eq 1 ]; then
  info "Dry run — $TOTAL file(s) would be uploaded to $SFTP_SERVER"
  sed 's|^|  |' "$WORK/upload"
  info "plus .htaccess (root + assets) and $MANIFEST_NAME"
  [ "$DO_PRUNE" -eq 1 ] && prune
  info "Dry run complete; nothing was uploaded"
  exit 0
fi

if [ "$TOTAL" -eq 0 ]; then
  ok "no content changed since the last deploy"
else
  info "$TOTAL file(s) to upload"
fi

# Entry points are held back to the tail pass; everything else goes in bulk.
grep -v -x -F -f <(printf '%s\n' "${ENTRY_FILES[@]}") "$WORK/upload" > "$WORK/upload.bulk" || : > "$WORK/upload.bulk"

make_dirs
upload_bulk
upload_tail

[ "$DO_PRUNE" -eq 1 ] && prune

verify
