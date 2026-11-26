export type CacheTurn = {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  model: string
  /** Was a large prefix rewritten instead of read (a cache miss)? */
  isMiss: boolean
}
export type CacheTotals = { input: number; cacheRead: number; cacheWrite: number; turns: number; misses: number }

declare module 'claude-code' {
  interface PluginState {
    'cache-tax': { last: CacheTurn | null; totals: CacheTotals; isHidden: boolean }
  }
}
