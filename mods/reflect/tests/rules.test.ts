import { expect, mock, test } from 'claude-code/testing'

test('a saved rule lands in the system prompt', async ($, on) => {
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'reflect' } }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' as const }] }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'reflect', args: 'Always use pnpm' })
  expect(r.text).toContain('Saved rule 1')
  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
  const mine = composed.sections.find(s => s.id === 'reflect:rules')
  expect(mine?.text).toContain('Always use pnpm')
})
