// A slim gold XP progress bar (0..100%). By default a CSS transition eases the fill; pass `instant` when a
// caller drives `pct` every animation frame (the reward screen) so the width tracks exactly and a
// level-up boundary can snap 100%→0% without the transition sliding it back.
export function XpBar({ pct, instant }: { pct: number; instant?: boolean }) {
  return (
    <div className="xp-bar">
      <div className="xp-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, transition: instant ? 'none' : undefined }} />
    </div>
  )
}
