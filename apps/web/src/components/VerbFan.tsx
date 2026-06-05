import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { VERBS, type Verb } from '@bible/engine'

// A radial "verb coin": every action fans out around the click point. The player may try any of
// them — unsupported actions just yield a refusal line (room for harmless, in-character fiddling).

const ICON: Record<Verb, string> = {
  observe: '👁️',
  talk: '🗣️',
  take: '✋',
  use: '🔧',
  open: '🗝️',
  close: '🔒',
  push: '👉',
  pull: '👈',
}

export function VerbFan({ x, y, onPick }: { x: number; y: number; onPick: (v: Verb) => void }) {
  const { t } = useTranslation()
  const r = 82
  return (
    <div className="verb-fan" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {VERBS.map((v, i) => {
        const a = (i / VERBS.length) * Math.PI * 2 - Math.PI / 2
        return (
          <motion.button
            key={v}
            className="verb-coin"
            title={t(`verb.${v}`)}
            style={{ left: Math.cos(a) * r, top: Math.sin(a) * r }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.025, type: 'spring', stiffness: 420, damping: 24 }}
            onClick={(e) => {
              e.stopPropagation()
              onPick(v)
            }}
          >
            <span className="verb-icon">{ICON[v]}</span>
            <span className="verb-text">{t(`verb.${v}`)}</span>
          </motion.button>
        )
      })}
    </div>
  )
}
