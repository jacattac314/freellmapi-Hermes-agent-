import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CacheTotals, CacheTurn } from '../types'

const ZERO: CacheTotals = { input: 0, cacheRead: 0, cacheWrite: 0, turns: 0, misses: 0 }
const last = atom({ plugin: 'cache-tax', key: 'last' } as const, null)
const totals = atom({ plugin: 'cache-tax', key: 'totals' } as const, ZERO)
const isHidden = atom({ plugin: 'cache-tax', key: 'isHidden' } as const, false)

// Prices relative to one uncached input token (Anthropic's published ratios):
// a 5-minute cache write costs 1.25x, a cache read 0.1x.
const WRITE = 1.25
const READ = 0.1
const MISS_TOKENS = 20_000

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))
const pct = (n: number) => `${Math.round(n * 100)}%`

/** Share of the cost an uncached prompt would have had that the cache saved. */
function saved(t: { input: number; cacheRead: number; cacheWrite: number }): number {
  const raw = t.input + t.cacheRead + t.cacheWrite
  if (raw === 0) return 0
  const paid = t.input + t.cacheWrite * WRITE + t.cacheRead * READ

  return 1 - paid / raw
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cache-tax', description: 'Show prompt-cache stats for this session' })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const u = e.usage

    // Main loop only: subagents have their own caches.
    if (u === undefined || e.agentId !== undefined) {
      return done
    }
    const before = await read($, totals)
    const turn: CacheTurn = {
      input: u.input_tokens,
      cacheRead: u.cache_read_input_tokens,
      cacheWrite: u.cache_creation_input_tokens,
      output: u.output_tokens,
      model: u.model,
      isMiss: before.turns > 0 && u.cache_creation_input_tokens > MISS_TOKENS && u.cache_read_input_tokens < u.cache_creation_input_tokens,
    }
    await update($, last, () => turn)
    await update($, totals, t => ({
      input: t.input + turn.input,
      cacheRead: t.cacheRead + turn.cacheRead,
      cacheWrite: t.cacheWrite + turn.cacheWrite,
      turns: t.turns + 1,
      misses: t.misses + (turn.isMiss ? 1 : 0),
    }))
    if (turn.isMiss) {
      $.ui.toast(`Cache tax: ${k(turn.cacheWrite)} tokens rewritten to cache (prefix changed or cache expired).`)
    }
    const all = await read($, totals)
    $.ui.status(`cache ${pct(saved(all))} saved`)

    return done
  })

  on('command.run', { command: 'cache-tax' }, async $ => {
    const t = await read($, totals)
    const usage = await $.session.usage()
    const cost = usage.cost ? `$${usage.cost.usd.toFixed(2)}${usage.cost.hasUnknownPrice ? ' (partial)' : ''}` : 'n/a'

    return {
      text: [
        `Turns: ${t.turns}   cache misses: ${t.misses}`,
        `Uncached input: ${k(t.input)}   cache reads: ${k(t.cacheRead)}   cache writes: ${k(t.cacheWrite)}`,
        `Input cost saved by caching: ${pct(saved(t))}`,
        `Session cost so far: ${cost}`,
        '',
        'Tips: a cache entry lives ~5 min; pausing longer, switching models, or editing',
        'CLAUDE.md / tools mid-session rewrites the whole prefix.',
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const turn = await read($, last)
    if (e.props.hasSurvey || turn === null || (await read($, isHidden))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const hit = turn.cacheRead + turn.cacheWrite + turn.input
    const rate = hit === 0 ? 0 : turn.cacheRead / hit

    return (
      <Box>
        <Text color={turn.isMiss ? 'warning' : rate > 0.8 ? 'success' : undefined} dimColor={!turn.isMiss}>
          Cache: {pct(rate)} hit · read {k(turn.cacheRead)} · wrote {k(turn.cacheWrite)} · new {k(turn.input)}
          {turn.isMiss ? ' · MISS' : ''}{' '}
        </Text>
        <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
