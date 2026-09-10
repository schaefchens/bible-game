#!/usr/bin/env bash
# Shared SFTP plumbing for scripts/deploy.sh.
#
# The target (www99.your-server.de) runs ProFTPD mod_sftp with password auth and
# NO shell access — every remote operation has to be expressible as an sftp
# batch command. There is no tar, no unzip, no atomic `mv` of a staging tree,
# and no way to hash a file remotely.

# --- credentials -------------------------------------------------------------

# Parsed rather than sourced on purpose: the password legitimately contains
# shell metacharacters (`/`, `?` and `.` in the current one), so `. sftp.env`
# would either break or silently mangle it.
load_credentials() {
  local env_file="$1"

  [ -f "$env_file" ] || die "missing $env_file (copy sftp.env.example and fill it in)"

  SFTP_SERVER=$(read_env_value "$env_file" SFTP_SERVER)
  SFTP_PASSWD=$(read_env_value "$env_file" SFTP_PASSWD)

  [ -n "$SFTP_SERVER" ] || die "SFTP_SERVER not set in $env_file"
  [ -n "$SFTP_PASSWD" ] || die "SFTP_PASSWD not set in $env_file"
}

read_env_value() {
  local file="$1" key="$2" value
  value=$(sed -n "s/^[[:space:]]*${key}[[:space:]]*=//p" "$file" | head -n1)
  # Tolerate an optionally quoted value.
  value="${value#\"}"; value="${value%\"}"
  value="${value#\'}"; value="${value%\'}"
  printf '%s' "$value"
}

# --- running batches ---------------------------------------------------------

# Two non-obvious requirements, both learned the hard way:
#
#   * The batch must be a FILE, not `-b -`. sftp reading commands from stdin
#     competes with sshpass for the same stream and auth silently fails.
#   * `-o BatchMode=no` is mandatory. `sftp -b` implies BatchMode=yes, which
#     disables password prompts outright, and ssh then reports
#     "Permission denied" without ever having tried the password.
#
# The password goes through the environment (sshpass -e), so it never appears
# in the process list.
run_sftp() {
  local batch="$1"
  SSHPASS="$SFTP_PASSWD" sshpass -e sftp \
      -o StrictHostKeyChecking=accept-new \
      -o PubkeyAuthentication=no \
      -o PreferredAuthentications=password \
      -o BatchMode=no \
      -o ConnectTimeout=20 \
      -o ServerAliveInterval=30 \
      -b "$batch" "$SFTP_SERVER"
}

# --- remote inspection -------------------------------------------------------

# Echo "<name>\t<size>" for every regular file in a remote directory.
#
# `ls -l` output is the only inventory available (no stat, no find), and it
# omits dotfiles — which is what we want: it keeps .htaccess and the deploy
# manifest out of the prune candidates for free.
remote_file_sizes() {
  local dir="$1" batch out
  batch=$(mktemp)
  printf 'ls -l %s\n' "$dir" > "$batch"
  out=$(run_sftp "$batch" 2>/dev/null) || out=""
  rm -f "$batch"
  # ProFTPD long format: perms links owner group size mon day time name
  printf '%s\n' "$out" \
    | awk '/^-/ && NF >= 9 { name = $9; sub(/.*\//, "", name); printf "%s\t%s\n", name, $5 }'
}

# Download a remote file to a local path. Returns nonzero (quietly) if it does
# not exist — a missing manifest just means "first deploy", not an error.
remote_get() {
  local remote="$1" local_path="$2" batch status=0
  batch=$(mktemp)
  printf 'get %s %s\n' "$remote" "$local_path" > "$batch"
  run_sftp "$batch" >/dev/null 2>&1 || status=$?
  rm -f "$batch"
  [ "$status" -eq 0 ] && [ -f "$local_path" ]
}

require_tools() {
  local t missing=()
  for t in "$@"; do command -v "$t" >/dev/null 2>&1 || missing+=("$t"); done
  if [ ${#missing[@]} -gt 0 ]; then
    die "missing required tool(s): ${missing[*]}
  install with: brew install ${missing[*]}"
  fi
}
