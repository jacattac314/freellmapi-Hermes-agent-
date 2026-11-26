export type EditFrame = {
  id: string
  path: string
  tool: string
  before: string
  after: string
  at: number
  isError: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'replay-theater': { frames: Shaped<EditFrame[]>; index: number }
  }
}
