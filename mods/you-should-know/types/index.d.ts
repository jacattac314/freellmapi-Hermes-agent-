export type Flag = { turnId: string; items: string[]; at: number }

declare module 'claude-code' {
  interface PluginState {
    'you-should-know': { latest: Flag | null; isDismissed: boolean; isEnabled: boolean }
  }
}
