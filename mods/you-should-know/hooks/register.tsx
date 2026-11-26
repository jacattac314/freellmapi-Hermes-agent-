import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Flag } from '../types'

const latest = atom({ plugin: 'you-should-know', key: 'latest' } as const, null)
const isDismissed = atom({ plugin: 'you-should-know', key: 'isDismissed' } as const, false)
const isEnabled = atom({ plugin: 'you-should-know', key: 'isEnabled' } as const, true)

const MODEL = 'haiku'
const MIN_CHARS = 300

const SYSTEM = `You review an AI coding assistant's final message to its user and surface ONLY critical things the user could easily miss.
Critical means: a step the assistant could not complete or skipped, a failing test or error it mentions in passing, a security or data-loss risk, an action the user must take themselves (credentials, manual config, a restart, a decision), a destructive change, or an assumption that might be wrong.
Do NOT restate the summary, praise, or list ordinary completed work.
Reply with at most 3 lines, each starting with "- " and under 120 characters. If nothing is critical, reply with exactly: NONE`

async function review($: EngineInterface, turnId: string, answer: string) {
  const r = await $.model.complete({
    model: MODEL,
    system: SYSTEM,
    prompt: `<assistant_message>\n${answer.slice(0, 24_000)}\n</assistant_message>`,
    maxTokens: 300,
  })
  if (!r.isAnswered) {
    return
  }
  const items = r.text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2).trim())
    .slice(0, 3)

  if (items.length === 0 || /^NONE\b/.test(r.text.trim())) {
    await update($, latest, () => null)
    return
  }
  const flag: Flag = { turnId, items, at: await $.clock.now() }
  await update($, latest, () => flag)
  await update($, isDismissed, () => false)
  $.ui.toast(`You should know: ${items[0]}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ysk',
      description: 'You Should Know: on | off | show',
    })
    return next(e)
  })

  on('command.run', { command: 'ysk' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off' || arg === 'on') {
      await update($, isEnabled, () => arg === 'on')
      return { text: `You Should Know is ${arg}.` }
    }
    const flag = await read($, latest)
    await update($, isDismissed, () => false)
    return { text: flag ? flag.items.map(i => `- ${i}`).join('\n') : 'Nothing flagged for the last answer.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, latest, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const isMainAnswer = e.agentId === undefined && e.reason === 'answer'

    if (isMainAnswer && e.answer.length >= MIN_CHARS && (await read($, isEnabled))) {
      const { turnId, answer } = e
      // Run after this dispatch so the turn is never held up by the review.
      $.clock.after(0, () => void review($, turnId, answer))
    }
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const flag = await read($, latest)
    if (e.props.hasSurvey || flag === null || (await read($, isDismissed))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color="warning">
            ⚠ You should know{' '}
          </Text>
          <Button key="dismiss" label="Dismiss" onPress={() => update($, isDismissed, () => true)} />
        </Box>
        {flag.items.map(item => (
          <Text color="warning">  • {item}</Text>
        ))}
      </Box>
    )
  })
}
