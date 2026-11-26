import { expect, test } from 'claude-code/testing'

test('risky commands ask, safe ones pass through', async ($, on) => {
  on('tool.check', () => ({ decision: 'allow' as const }))
  const risky = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })
  expect(risky.decision).toBe('ask')
  const push = await $.tool.check({ tool: 'Bash', input: { command: 'git push --force origin main' } })
  expect(push.decision).toBe('ask')
  const safe = await $.tool.check({ tool: 'Bash', input: { command: 'ls -la' } })
  expect(safe.decision).toBe('allow')
})
