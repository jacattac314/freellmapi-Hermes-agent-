import type { Register } from 'claude-code'

// Each rule: a pattern on the shell command and the reason shown in the
// confirmation dialog. Kept deliberately narrow so routine work is not nagged.
const RULES: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/, reason: 'recursive or forced delete (rm -r / -f)' },
  { pattern: /\bfind\b.*\s-delete\b/, reason: 'find … -delete removes files in bulk' },
  { pattern: /\bgit\s+push\b.*(--force\b|-f\b|--force-with-lease\b)/, reason: 'force push rewrites remote history' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'git reset --hard discards uncommitted work' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*f/, reason: 'git clean -f deletes untracked files' },
  { pattern: /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, reason: 'discards all working-tree changes' },
  { pattern: /\bgit\s+branch\s+-D\b/, reason: 'force-deletes a branch' },
  { pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, reason: 'destructive SQL' },
  { pattern: /\bDELETE\s+FROM\s+\w+\s*(;|$)/i, reason: 'DELETE without WHERE' },
  { pattern: /\b(mkfs|dd\s+if=|shred)\b/, reason: 'disk-level write' },
  { pattern: /\bchmod\s+-R\s+777\b/, reason: 'recursive world-writable permissions' },
  { pattern: /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, reason: 'pipes a download straight into a shell' },
  { pattern: /\bkubectl\s+delete\b|\bterraform\s+destroy\b/, reason: 'deletes infrastructure' },
  { pattern: /\bnpm\s+publish\b|\bdocker\s+push\b/, reason: 'publishes outside this machine' },
]

export const register: Register = on => {
  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const command = String((e.input as { command?: unknown })?.command ?? '')
    const hit = RULES.find(rule => rule.pattern.test(command))

    if (hit === undefined) {
      return next(e)
    }
    const verdict = await next(e)

    // Only tighten: an existing deny stays a deny.
    if (verdict.decision === 'deny') {
      return verdict
    }
    $.ui.status(`blast-radius: held ${command.slice(0, 40)}`)

    return { decision: 'ask', reason: `Blast radius: ${hit.reason}. Confirm to run.` }
  })
}
