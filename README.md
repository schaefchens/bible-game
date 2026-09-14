# Walk in the Spirit

A biblical roguelike card-battler (Slay-the-Spire-inspired) with an RPG leveling layer,
positional party combat, a free bidirectional node map, Monkey-Island point-and-click node
scenes, **Bible-verse cards** earned by filling gaps in real scripture, and a hidden
**Spirit** stat that decides whether those verses work at all. Raw damage clears the road;
the miracles that break a hopeless fight only fire for a player who walks in the Spirit.

Three adventures, three hero classes, 2–3 player co-op, and an offline-capable PWA.
Bilingual **EN/DE**. Live at <https://walkinthespirit.games.schaefchens.de> — and
`?install=1` on that URL (for QR codes and "install the app" links) opens the browser's
own install dialog; see `apps/web/src/pwa/installPrompt.ts` for why that takes more than
one call to `prompt()`.

## Architecture

A monorepo (npm workspaces) with a hard, CI-enforced boundary: the **engine** is a pure,
deterministic, serializable state machine with **zero** React/DOM/storage imports. The UI only
dispatches `Command`s and renders `GameState` + animates `GameEvent`s. The co-op server runs the
*same* engine on Node — which is why there is no second rules implementation to keep in sync.

```
packages/
  engine/       pure-TS engine: RNG, leveling, combat, spirit, verse, map, scenes, reducer
  content/      the content bundle (cards, encounters, scenes, events, verses, three worlds)
  i18n/         EN/DE message bundles
  persistence/  IndexedDB save store (zod-validated SaveFile + migrations)
  assets/       AssetRef → URL registry (programmatic placeholders otherwise)
apps/
  web/          React + Vite UI (Zustand bridge, i18next, Framer Motion, PWA)
  server/       authoritative co-op WebSocket server (ws + tsx), reusing @bible/engine
```

- **Engine contract:** one public `reduce(state, cmd) => { state, events }`, plus
  `serialize`/`deserialize`. Combat/world/spirit/verse are internal sub-reducers.
- **Determinism:** a seeded `xoshiro128**` PRNG stored in state (JSON-safe number tuple),
  threaded through the reducer; `fork(label)` for independent sub-streams, so adding a roll in
  one domain never shifts another's sequence.
- **Self-contained saves:** a run embeds its immutable `ContentBundle`, so `reduce` stays pure
  and saves don't break on content changes.

## Develop

```bash
npm install
npm test            # vitest (engine, content, persistence, web, server) — 416 tests, 46 files
npm run typecheck   # tsc across all packages
npm run lint        # eslint (incl. the engine-purity boundary rule)
npm run check:engine-no-react   # CI guard: engine imports no React/UI/storage
npm run dev         # Vite dev server for the web app (proxies /ws to :8787)
npm run server      # the co-op server, locally, on :8787
npm run build       # production build (web, served at "/")
npm run build:app   # production build for Capacitor (relative base, no service worker)
```

The headless integration sims (`packages/engine/src/sim`, `packages/content/src/*.integration.test.ts`)
drive whole runs through the reducer with no UI — the fastest way to exercise game logic.

## The game

**Three adventures**, picked on the world-select screen and unlocked in order:

| world | id | shape |
| --- | --- | --- |
| Beside Still Waters | `world-02` | the tutorial — a short, gentle walk that teaches the verbs |
| The Road to Jericho | `world-01` | the Good-Samaritan road: scenes, dialogue, two shops, the Accuser at the Narrow Gate |
| The Valley of Elah | `world-03` | a 26-node combat gauntlet ending at Goliath |

Both full adventures are gated behind the tutorial (`completedWorlds`).

**Heroes** are permanent and created "at the fire" as one of three classes — Zealot (glass
cannon, opens combat with Strength), Shepherd (tank, heals after every win), Merchant (rich,
+50% reward gold). Each brings its own starter deck and a signature card, and each levels to 99,
spending skill points into hp / dmg / defend.

**Combat** is one currency: HP, damage, and block. There is no defense stat and no damage cap —
block from cards is the only mitigation. Level growth is non-linear and split (HP ×100 over 99
levels, damage ×50) and enemies are bracketed a decade behind the hero, so leveling buys a real
but bounded edge. Statuses (poison, weak, vulnerable, strength, dexterity, bound), persistent
powers (the Armor of God), scaling payoffs and per-archetype enemy AI with synergy auras give the
deck its depth.

**Spirit** is the hidden layer. It is never shown as a number; it rises from mercy, prayer and
scripture and collapses when you kill a human who could have been freed. It does exactly one
thing mechanically: it scales the four verse cards. At zero they do nothing. At full they banish
a foe outright (*Not by might* — Zech 4:6), shield (Phil 4:6) or heal (Luke 10:27) the party, or
open your eyes to the demon standing behind a human captive (2 Kings 6:17) so Mercy can free them
instead of killing them. That is the whole thesis: the fight in front of you is not the real one.

You earn one by carrying a **Scripture Fragment** — dropped by a fight, or bought — to a fire and
typing the missing words of the real verse from memory or from an open Bible. Checking is tolerant
of case, punctuation and umlauts in both languages; three wrong answers loses the fragment.

**Deckbuilding** runs the usual loop — card rewards after a win, a shop node, and honing a card
at a fireplace (`+` → `++` → `+++`). The run deck is ephemeral; verse cards and event-granted
cards persist on the hero.

**Co-op** (2–3 players) is server-authoritative: everyone brings their own hero, decks merge
into one shared hand, and the Node server runs the same `reduce` as the client. See
[`deploy/README.md`](deploy/README.md#co-op) — the production server boots on demand and is
reaped when idle.

## Deploy

```bash
cp sftp.env.example sftp.env   # credentials, gitignored
npm run deploy                 # build → upload only what changed → verify
npm run deploy:dry             # show the plan, upload nothing
```

It is a static SFTP deploy that diffs content hashes against a manifest in the
web root, so the ~70 MB of art and music only moves when it actually changes.
See [`deploy/README.md`](deploy/README.md) — including the Capacitor notes and
how the on-demand co-op server is woken and reaped.
