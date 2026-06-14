import type { Story } from '@bible/engine'

// Closing narration when Goliath falls. Original prose (no copyrighted translation). The lesson of
// 1 Sam 17:47 — "not by sword or spear" — said plainly; the giant fell to faith, not iron.
const elahOutro: Story = {
  id: 'elahOutro',
  titleKey: 'story.elahOutro.title',
  bgAsset: 'bg-boss-narrow-gate',
  paragraphs: ['story.elahOutro.p1', 'story.elahOutro.p2', 'story.elahOutro.p3'],
  attributionKey: 'story.elahOutro.attribution',
  onEnd: [{ setFlag: 'fellGoliath', value: true }],
}

export const ELAH_STORIES: Record<string, Story> = { elahOutro }
