import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, ModelTally } from '../types'

const PANE = 'savvy-progress'
const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [], { shape: 'agents-1' })
const models = atom({ plugin: 'savvy-progress', key: 'models' } as const, [], { shape: 'models-1' })
const turn = atom({ plugin: 'savvy-progress', key: 'turn' } as const, { startedAt: 0, tools: 0, isRunning: false })
const costUsd = atom({ plugin: 'savvy-progress', key: 'costUsd' } as const, null)

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`)
const bar = (done: number, total: number, width = 20) => {
  const full = total === 0 ? 0 : Math.round((done / total) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

async function refreshCost($: EngineInterface) {
  const usage = await $.session.usage()
  await update($, costUsd, () => usage.cost?.usd ?? null)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress', description: 'Open the subagent, model and cost pane' })

    return next(e)
  })

  on('command.run', { command: 'progress' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Progress' })

    return { text: 'Progress pane opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, turn, () => ({ startedAt: now, tools: 0, isRunning: true }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, turn, t => ({ ...t, tools: t.tools + 1 }))
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const id = spawned.agentId

    if (id !== undefined) {
      const run: AgentRun = {
        id,
        type: e.subagentType,
        description: e.description,
        model: spawned.model,
        status: 'running',
        startedAt: await $.clock.now(),
        tokens: 0,
      }
      await update($, agents, list => [...list, run].slice(-50))
      void $.ui.open({ id: PANE, title: 'Progress' })
    }

    return spawned
  })

  on('agent.report', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, agents, list => list.map(a => (a.id === e.agentId ? { ...a, status: e.status, endedAt: now } : a)))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const u = e.usage

    if (u !== undefined) {
      const used = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      await update($, models, list => {
        const found = list.find(m => m.model === u.model)
        const row: ModelTally = {
          model: u.model,
          input: (found?.input ?? 0) + used,
          output: (found?.output ?? 0) + u.output_tokens,
          turns: (found?.turns ?? 0) + 1,
        }
        return found ? list.map(m => (m.model === u.model ? row : m)) : [...list, row]
      })
      if (e.agentId !== undefined) {
        await update($, agents, list =>
          list.map(a => (a.id === e.agentId ? { ...a, tokens: a.tokens + used + u.output_tokens } : a)),
        )
      }
    }
    if (e.agentId === undefined) {
      await update($, turn, t => ({ ...t, isRunning: false }))
    }
    await refreshCost($)
    const cost = await read($, costUsd)
    if (cost !== null) $.ui.status(`$${cost.toFixed(2)}`)

    return done
  })

  // A band above the prompt while subagents run.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, agents)
    const t = await read($, turn)
    const live = list.filter(a => a.startedAt >= t.startedAt)
    if (e.props.hasSurvey || live.length === 0) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const finished = live.filter(a => a.status !== 'running').length

    return (
      <Box>
        <Text dimColor>
          Subagents {bar(finished, live.length, 12)} {finished}/{live.length}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, agents)
    const tallies = await read($, models)
    const t = await read($, turn)
    const cost = await read($, costUsd)
    const now = await $.clock.now()
    const finished = list.filter(a => a.status !== 'running').length

    return (
      <Box flexDirection="column">
        <Text bold>This turn</Text>
        <Text dimColor>
          {t.isRunning ? `running ${secs(now - t.startedAt)}` : 'idle'} · {t.tools} tool calls
        </Text>
        <Text> </Text>
        <Text bold>
          Subagents {list.length > 0 ? `${bar(finished, list.length)} ${finished}/${list.length}` : ''}
        </Text>
        {list.length === 0 && <Text dimColor>None yet.</Text>}
        {list.slice(-12).map(a => (
          <Text
            color={a.status === 'failed' ? 'error' : a.status === 'running' ? 'warning' : undefined}
            dimColor={a.status === 'completed'}
            wrap="truncate-end"
          >
            {a.status === 'running' ? '◐' : a.status === 'completed' ? '✓' : '✗'} {a.type}: {a.description} ·{' '}
            {secs((a.endedAt ?? now) - a.startedAt)} · {k(a.tokens)} tok
          </Text>
        ))}
        <Text> </Text>
        <Text bold>Models</Text>
        {tallies.length === 0 && <Text dimColor>No usage yet.</Text>}
        {tallies.map(m => (
          <Text dimColor wrap="truncate-end">
            {m.model}: {m.turns} turns · in {k(m.input)} · out {k(m.output)}
          </Text>
        ))}
        <Text> </Text>
        <Text bold>Session cost: {cost === null ? 'n/a' : `$${cost.toFixed(2)} (estimate)`}</Text>
      </Box>
    )
  })
}
