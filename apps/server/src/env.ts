// Server configuration from the environment. The build hash is the compatibility anchor: every client
// must present the SAME hash the server was built from (see handlers) so the server's card math matches
// the content each client re-attaches. In dev the hash is unset ('dev') and the gate is lenient.

export const PORT = Number(process.env.PORT ?? 8787)

/** The authoritative build fingerprint. In prod, deploy the server + web from the same commit's VITE_GIT_SHA. */
export const SERVER_BUILD_HASH = process.env.VITE_GIT_SHA ?? process.env.BUILD_HASH ?? 'dev'

/** Drop rooms with no connected players after this idle window. */
export const ROOM_TTL_MS = 30 * 60 * 1000
