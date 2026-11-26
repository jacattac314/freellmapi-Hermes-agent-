export type FileTouch = {
  path: string
  reads: number
  writes: number
  /** Is a call on this file running right now? */
  isActive: boolean
  lastAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'file-tree': { files: Shaped<FileTouch[]>; root: string }
  }
}
