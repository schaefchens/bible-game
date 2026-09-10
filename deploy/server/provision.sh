#!/usr/bin/env bash
#
# Re-point the co-op VPS at its new hostname. Run ON the box, as root.
#
# The snapshot the server boots from (spirit-game-server-initial) was taken
# while the game lived at komm-folge-mir-nach.de. It comes up serving a vhost
# for game.komm-folge-mir-nach.de, with a Let's Encrypt certificate for that
# name and a `/game/` alias for a static build that is now hosted elsewhere.
# None of those names resolve any more, so the cert cannot even renew.
#
# This script fixes that, and is idempotent — run it again after any snapshot
# refresh. Re-snapshot afterwards, or every recreation starts from the old
# state again.
#
#   scp deploy/server/{provision.sh,nginx-coop.conf} root@<ip>:/root/
#   ssh root@<ip> 'bash /root/provision.sh'
#
# Environment:
#   COOP_HOST   hostname to serve (default: the one in the wake config)
#   LE_EMAIL    only needed if the box has no Let's Encrypt account yet
#   SKIP_CERT=1 install the vhost but do not touch certbot

set -euo pipefail

COOP_HOST="${COOP_HOST:-walkinthespirit-coop.games.schaefchens.de}"
LE_EMAIL="${LE_EMAIL:-}"
SKIP_CERT="${SKIP_CERT:-0}"

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/nginx-coop.conf"
AVAILABLE=/etc/nginx/sites-available
ENABLED=/etc/nginx/sites-enabled
SITE=walkinthespirit-coop

info() { printf '\033[34m==>\033[0m %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -f "$SRC" ] || die "nginx-coop.conf not found next to this script"

# --- DNS must already point here, or certbot cannot validate ------------------

info "Checking DNS for $COOP_HOST"
resolved=$(getent ahostsv4 "$COOP_HOST" | awk '{print $1; exit}' || true)
myip=$(curl -fsS --max-time 10 https://ipv4.icanhazip.com 2>/dev/null | tr -d '[:space:]' || true)
if [ -z "$resolved" ]; then
  die "$COOP_HOST does not resolve — add the A record before running this"
elif [ -n "$myip" ] && [ "$resolved" != "$myip" ]; then
  die "$COOP_HOST resolves to $resolved but this host is $myip"
fi
ok "$COOP_HOST → $resolved"

# --- vhost --------------------------------------------------------------------

info "Installing the $SITE vhost"
mkdir -p /var/www/html
sed "s|COOP_HOST_PLACEHOLDER|$COOP_HOST|g" "$SRC" > "$AVAILABLE/$SITE"
ln -sfn "$AVAILABLE/$SITE" "$ENABLED/$SITE"

# The old site answers for a hostname that no longer exists. Left enabled it is
# also nginx's default server for this IP, so it would catch anything that
# arrives without a matching Host.
for stale in bible-game default; do
  if [ -e "$ENABLED/$stale" ]; then
    rm -f "$ENABLED/$stale"
    ok "disabled stale vhost: $stale"
  fi
done

nginx -t || die "nginx config test failed"
systemctl reload nginx
ok "nginx reloaded"

# --- certificate ----------------------------------------------------------------

if [ "$SKIP_CERT" = "1" ]; then
  info "SKIP_CERT=1 — leaving certbot alone"
else
  info "Issuing a certificate for $COOP_HOST"
  args=(--nginx -d "$COOP_HOST" --non-interactive --agree-tos --redirect)
  # An account already exists if the box ever held a cert; certbot only needs
  # an address the first time.
  if [ -z "$(ls -A /etc/letsencrypt/accounts 2>/dev/null || true)" ]; then
    [ -n "$LE_EMAIL" ] || die "no Let's Encrypt account on this box — set LE_EMAIL"
    args+=(-m "$LE_EMAIL")
  fi
  certbot "${args[@]}"
  ok "certificate installed"

  # The old cert is for a dead name and can never renew again; left in place it
  # makes `certbot renew` (and the boot-time renew unit) fail every single run,
  # which is how a real renewal failure goes unnoticed.
  if certbot certificates 2>/dev/null | grep -q 'game\.komm-folge-mir-nach\.de'; then
    certbot delete --cert-name game.komm-folge-mir-nach.de --non-interactive || true
    ok "removed the dead game.komm-folge-mir-nach.de certificate"
  fi
fi

# --- the service itself -----------------------------------------------------------

info "Checking the co-op server"
systemctl enable --now bible-server >/dev/null 2>&1 || true
systemctl is-active --quiet bible-server && ok "bible-server is running" \
  || printf '  \033[31m✗\033[0m bible-server is NOT running — journalctl -u bible-server\n'

ss -tulpn 2>/dev/null | grep -q ':8787' && ok "listening on 8787" \
  || printf '  \033[31m✗\033[0m nothing is listening on 8787\n'

info "Done. Re-snapshot the server so recreations start from this state."
