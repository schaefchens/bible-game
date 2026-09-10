// Server configuration from the environment.
//
// The compatibility anchor is the CONTENT hash, not this build hash — see `SERVER_CONTENT_HASH`
// below and @bible/content's hash.ts for why. The git sha is kept because it is what a human needs
// in order to act on a mismatch ("the site is three commits behind the server"), and it is worth
// having in the startup log either way.

import { execSync } from 'node:child_process'
import { createContent, contentHash } from '@bible/content'

export const PORT = Number(process.env.PORT ?? 8787)

/**
 * This checkout's revision, for logs and mismatch messages. Prefer the environment (CI, or a
 * systemd unit that sets it); otherwise derive it from the working copy, exactly as the web build
 * does in vite.config.ts, so the two report the same thing in the same format.
 *
 * The production box runs from a git checkout that `deploy-bible-game.sh` resets to origin/main
 * every minute, so this is accurate there without any unit configuration. It falls back to 'dev'
 * rather than throwing: git may be absent, or refuse the directory as dubiously owned when the
 * service user differs from the checkout's owner, and neither is a reason to refuse to start.
 */
export const SERVER_BUILD_HASH =
  process.env.VITE_GIT_SHA ??
  process.env.BUILD_HASH ??
  (() => {
    try {
      const git = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      const sha = git('git rev-parse --short HEAD')
      if (!sha) return 'dev'
      return git('git status --porcelain') === '' ? sha : `${sha}-dirty`
    } catch {
      return 'dev'
    }
  })()

/**
 * The real gate: a fingerprint of the content bundle this server will run the rules from. A client
 * whose bundle hashes the same renders the broadcast state identically, whatever commit built it.
 */
export const SERVER_CONTENT_HASH = contentHash(createContent())

/** Drop rooms with no connected players after this idle window. */
export const ROOM_TTL_MS = 30 * 60 * 1000
