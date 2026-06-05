# Walk in the Spirit

A biblical roguelike card-battler (Slay-the-Spire-inspired) with an RPG leveling layer,
FF7-style positional/party combat, a free bidirectional node map, Monkey-Island point-and-click
node scenes, **Bible-verse cards** earned by filling gaps in real scripture, and a hidden
**flesh-vs-spirit** system that is the real win condition — raw power alone cannot beat the late
game; only walking in the Spirit (grace mechanics, moral choices, scripture) can.

**Milestone 1** delivers a fully unit-tested game engine plus a playable end-to-end vertical
slice. Bilingual **EN/DE**.

## Architecture

A monorepo (npm workspaces) with a hard, CI-enforced boundary: the **engine** is a pure,
deterministic, serializable state machine with **zero** React/DOM/storage imports. The UI only
dispatches `Command`s and renders `GameState` + animates `GameEvent`s.

```
packages/
  engine/       pure-TS engine: RNG, leveling, combat, spirit, verse, map, scenes, reducer
  content/      the real M1 content bundle (cards, encounters, scenes, events, verses, world)
  i18n/         EN/DE message bundles
  persistence/  IndexedDB save store (zod-validated SaveFile + migrations)
  assets/       AssetRef → URL registry (programmatic placeholders otherwise)
apps/
  web/          React + Vite UI (Zustand bridge, i18next, Framer Motion)
```

- **Engine contract:** one public `reduce(state, cmd) => { state, events }`, plus
  `serialize`/`deserialize`. Combat/world/spirit/verse are internal sub-reducers.
- **Determinism:** a seeded `xoshiro128**` PRNG stored in state (JSON-safe number tuple),
  threaded through the reducer; `fork(label)` for independent sub-streams.
- **Self-contained saves:** a run embeds its immutable `ContentBundle`, so `reduce` stays pure
  and saves don't break on content changes.

## Develop

```bash
npm install
npm test            # vitest (engine + content + persistence) — ~126 tests
npm run typecheck   # tsc across all packages
npm run lint        # eslint (incl. the engine-purity boundary rule)
npm run check:engine-no-react   # CI guard: engine imports no React/UI/storage
npm run dev         # Vite dev server for the web app
npm run build       # production build
```

The headless integration sims (`packages/engine/src/sim`, `packages/content/src/*.integration.test.ts`)
drive the entire slice through the reducer with no UI — the fastest way to exercise game logic.

## The vertical slice

Start → create a permanent hero → the Forest Road map → a point-and-click house (take a key) →
a beast fight → a fireplace (rest / pray / **study a verse** via gap-fill) → a key-gated edge →
the **thief mini-boss**: use **Sight** to reveal the demon behind the captive and destroy it with
spiritual damage (the human is freed — a peaceful, righteous victory), **or** brute-force the
human (a heavy Spirit penalty, no righteous loot). Spiritual cards **fizzle at low Spirit**. Runs
save and resume.
