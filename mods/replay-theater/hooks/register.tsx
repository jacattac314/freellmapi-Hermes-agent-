import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { EditFrame } from '../types'

const PANE = 'replay-theater'
const frames = atom({ plugin: 'replay-theater', key: 'frames' } as const, [], { shape: 'frames-1' })
// -1 follows the latest edit; otherwise the frame being shown.
const index = atom({ plugin: 'replay-theater', key: 'index' } as const, -1)

const MAX_TEXT = 20_000
const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '\n… (clipped)' : s)

/** A small line diff: common head and tail kept as context, the middle shown as -/+. */
function diff(before: string, after: string, context = 3): { sign: ' ' | '-' | '+'; text: string }[] {
  const a = before.split('\n')
  const b = after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const out: { sign: ' ' | '-' | '+'; text: string }[] = []
  for (const t of a.slice(Math.max(0, head - context), head)) out.push({ sign: ' ', text: t })
  for (const t of a.slice(head, a.length - tail)) out.push({ sign: '-', text: t })
  for (const t of b.slice(head, b.length - tail)) out.push({ sign: '+', text: t })
  for (const t of a.slice(a.length - tail, a.length - tail + context)) out.push({ sign: ' ', text: t })
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'replay', description: 'Step through the file edits Claude made' })
    return next(e)
  })

  on('command.run', { command: 'replay' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Replay theater' })
    const n = (await read($, frames)).length
    return { text: `Replay theater opened: ${n} edit${n === 1 ? '' : 's'} recorded.` }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool !== 'Edit' && tool !== 'Write') {
      return next(e)
    }
    const input = e as unknown as { file_path: string; old_string?: string; new_string?: string; content?: string }
    let before = ''
    let after = ''

    if (tool === 'Edit') {
      before = input.old_string ?? ''
      after = input.new_string ?? ''
    } else {
      // A Write replaces the file: keep what it held, if anything.
      before = (await $.fs.exists(input.file_path)) ? await $.fs.read(input.file_path).catch(() => '') : ''
      after = input.content ?? ''
    }
    const ran = await next(e)

    if (ran.deny !== undefined) {
      return ran
    }
    const frame: EditFrame = {
      id: e.tool_use_id,
      path: input.file_path,
      tool,
      before: clip(before),
      after: clip(after),
      at: await $.clock.now(),
      isError: ran.isError === true,
    }
    await update($, frames, list => [...list, frame].slice(-200))

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, frames)
    const at = await read($, index)

    if (list.length === 0) {
      return <Text dimColor>No edits yet. Edits and writes appear here as Claude makes them.</Text>
    }
    const i = at < 0 || at >= list.length ? list.length - 1 : at
    const f = list[i]!
    const go = (n: number) => update($, index, () => Math.max(0, Math.min(list.length - 1, n)))
    const lines = diff(f.before, f.after)

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="first" label="⏮" onPress={() => go(0)} />
          <Button key="prev" label="◀ Prev" onPress={() => go(i - 1)} />
          <Text bold>
            {' '}
            {i + 1}/{list.length}{' '}
          </Text>
          <Button key="next" label="Next ▶" onPress={() => go(i + 1)} />
          <Button key="live" label="⏭ Latest" onPress={() => update($, index, () => -1)} />
        </Box>
        <Text bold wrap="truncate-end">
          {f.tool} {f.path}
          {f.isError ? '  (failed)' : ''}
        </Text>
        {f.tool === 'Write' && f.before === '' && <Text dimColor>New file.</Text>}
        {lines.slice(0, 400).map(l => (
          <Text mono color={l.sign === '-' ? 'error' : l.sign === '+' ? 'success' : undefined} dimColor={l.sign === ' '}>
            {l.sign} {l.text}
          </Text>
        ))}
        {lines.length > 400 && <Text dimColor>… {lines.length - 400} more lines</Text>}
      </Box>
    )
  })
}
