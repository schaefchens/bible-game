// A one-line key for co-op card ownership: each player's identity SHAPE (tinted in their color) + name,
// once. Shown at the top of the Deck viewer + the sharpen/cast-off pick modal so cards need only their
// shape + color border, not a name.
export function OwnerLegend({ owners }: { owners: { name: string; color: string; symbol: string }[] }) {
  if (owners.length < 2) return null
  return (
    <div className="owner-legend">
      {owners.map((o) => (
        <span key={o.name + o.color} className="owner-legend-item" style={{ color: o.color }}>
          <span className="owner-symbol">{o.symbol}</span>
          {o.name}
        </span>
      ))}
    </div>
  )
}
