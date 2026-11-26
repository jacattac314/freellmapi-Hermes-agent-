import type { EngineInterface, Register } from 'claude-code'

const KEY = 'rules'
const USAGE = [
  '/reflect <rule>       save a standing rule',
  '/reflect list         show saved rules',
  '/reflect forget <n>   remove rule n',
  '/reflect clear        remove every rule',
].join('\n')

async function load($: EngineInterface): Promise<string[]> {
  const raw = await $.store.get(KEY)

  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : []
}

function list(rules: string[]): string {
  return rules.length === 0
    ? 'No saved rules yet.\n\n' + USAGE
    : rules.map((r, i) => `${i + 1}. ${r}`).join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'reflect',
      description: 'Save feedback as a rule Claude follows in every future session',
    })
    const count = (await load($)).length

    if (count > 0) {
      $.ui.status(`reflect: ${count} rule${count === 1 ? '' : 's'}`)
    }

    return next(e)
  })

  on('command.run', { command: 'reflect' }, async ($, e) => {
    const args = e.args.trim()
    const rules = await load($)

    if (args === '' || args === 'list') {
      return { text: list(rules) }
    }
    if (args === 'clear') {
      await $.store.set(KEY, [])
      $.ui.status(undefined)

      return { text: `Cleared ${rules.length} rule(s).` }
    }
    const forget = /^forget\s+(\d+)$/.exec(args)

    if (forget !== null) {
      const n = Number(forget[1])

      if (n < 1 || n > rules.length) {
        return { text: `No rule ${n}.\n\n${list(rules)}` }
      }
      const next = rules.filter((_, i) => i !== n - 1)
      await $.store.set(KEY, next)
      $.ui.status(next.length ? `reflect: ${next.length} rules` : undefined)

      return { text: `Forgot: ${rules[n - 1]}` }
    }
    const saved = [...rules, args].slice(-50)
    await $.store.set(KEY, saved)
    $.ui.status(`reflect: ${saved.length} rules`)

    return { text: `Saved rule ${saved.length}: ${args}\nIt applies from the next request on.` }
  })

  // Add the rules to the system prompt, after the cache boundary.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const rules = await load($)

    if (rules.length === 0) {
      return composed
    }
    const text = [
      '# Standing rules from the user (saved with /reflect)',
      'The user saved these from earlier feedback. Follow them unless the user overrides one in the current conversation.',
      ...rules.map((r, i) => `${i + 1}. ${r}`),
    ].join('\n')

    return {
      sections: [...composed.sections, { id: 'reflect:rules', text, scope: 'session' as const }],
    }
  })
}
