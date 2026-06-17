import { useTranslation } from 'react-i18next'
import { VERBS, type Verb } from '@bible/engine'
import { RadialMenu } from './RadialMenu'

// A radial "verb coin": every action fans out around the click point. The player may try any of
// them — unsupported actions just yield a refusal line (room for harmless, in-character fiddling).
// Renders the shared RadialMenu so the scene verbs and the bag's item actions look + animate alike.

export const VERB_ICON: Record<Verb, string> = {
  observe: '👁️',
  talk: '🗣️',
  take: '✋',
  use: '🔧',
  open: '🗝️',
  close: '🔒',
  push: '👉',
  pull: '👈',
  goTo: '🧭',
  give: '🤲',
}

export function VerbFan({ x, y, onPick }: { x: number; y: number; onPick: (v: Verb) => void }) {
  const { t } = useTranslation()
  const actions = VERBS.map((v) => ({ id: v, label: t(`verb.${v}`), icon: VERB_ICON[v] }))
  return <RadialMenu x={x} y={y} actions={actions} onPick={(id) => onPick(id as Verb)} />
}
