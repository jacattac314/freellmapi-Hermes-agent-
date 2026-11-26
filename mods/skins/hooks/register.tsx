import type { EngineInterface, Register, ThemeColors } from 'claude-code'

import { makeColors } from './make-colors.js'
import { SKINS } from './skins'

const KEY = 'skin'
const NAMES = Object.keys(SKINS)
const BUILT: Record<string, ThemeColors> = {}
for (const name of NAMES) BUILT[name] = makeColors(SKINS[name]!).theme

async function apply($: EngineInterface, name: string): Promise<string> {
  if (name === 'default') {
    await $.theme.clear()
    return 'Back to the app’s own look.'
  }
  const colors = BUILT[name]
  if (colors === undefined) {
    return `No skin "${name}". Try: ${NAMES.join(', ')}, default.`
  }
  const set = await $.theme.set({ colors })
  return set.isDrawn ? `Skin: ${SKINS[name]!.label}.` : `Saved ${SKINS[name]!.label}, but this surface draws no theme (${set.reason}). It shows in the desktop and mobile apps.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'skin', description: `Switch theme: ${NAMES.join(' | ')} | default` })
    const saved = await $.store.get(KEY)
    if (typeof saved === 'string' && saved in BUILT) {
      await apply($, saved)
    }
    return next(e)
  })

  on('command.run', { command: 'skin' }, async ($, e) => {
    const name = e.args.trim().toLowerCase()
    if (name === '') {
      const saved = await $.store.get(KEY)
      return { text: `Current: ${typeof saved === 'string' ? saved : 'default'}\nAvailable: ${NAMES.join(', ')}, default\nUsage: /skin <name>` }
    }
    const text = await apply($, name)
    if (name === 'default') await $.store.delete(KEY)
    else if (name in BUILT) await $.store.set(KEY, name)
    return { text }
  })
}
