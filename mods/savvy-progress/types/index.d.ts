export type AgentRun = {
  id: string
  type: string
  description: string
  model: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  startedAt: number
  endedAt?: number
  tokens: number
}
export type ModelTally = { model: string; input: number; output: number; turns: number }
export type Turn = { startedAt: number; tools: number; isRunning: boolean }

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': {
      agents: Shaped<AgentRun[]>
      models: Shaped<ModelTally[]>
      turn: Turn
      costUsd: number | null
    }
  }
}
