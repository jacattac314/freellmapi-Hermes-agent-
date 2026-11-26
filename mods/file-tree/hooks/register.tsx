import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { FileTouch } from '../types'

const PANE = 'file-tree'
const files = atom({ plugin: 'file-tree', key: 'files' } as const, [], { shape: 'files-1' })
const root = atom({ plugin: 'file-tree', key: 'root' } as const, '')

const READS = new Set(['Read', 'NotebookRead'])
const WRITES = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

type Node = { name: string; children: Map<string, Node>; file?: FileTouch }

function build(list: readonly FileTouch[], base: string): Node {
  const top: Node = { name: '', children: new Map() }
  for (const f of list) {
    const rel = base && f.path.startsWith(base + '/') ? f.path.slice(base.length + 1) : f.path
    const parts = rel.split('/').filter(Boolean)
    let node = top
    parts.forEach((part, i) => {
      let child = node.children.get(part)
      if (!child) {
        child = { name: part, children: new Map() }
        node.children.set(part, child)
      }
      if (i === parts.length - 1) child.file = f
      node = child
    })
  }
  return top
}

/** Flattens the tree to indented rows, folding single-child folders (a/b/c/). */
function rows(node: Node, depth: number, out: { depth: number; label: string; file?: FileTouch }[]) {
  const kids = [...node.children.values()].sort((a, b) =>
    a.file && !b.file ? 1 : !a.file && b.file ? -1 : a.name.localeCompare(b.name),
  )
  for (let kid of kids) {
    let label = kid.name
    while (!kid.file && kid.children.size === 1) {
      const only = [...kid.children.values()][0]!
      if (only.file) break
      kid = only
      label += '/' + kid.name
    }
    out.push({ depth, label: kid.file ? label : label + '/', file: kid.file })
    if (!kid.file) rows(kid, depth + 1, out)
  }
  return out
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, root, () => e.cwd)
    await $.command.register({ name: 'files', description: 'Open the pane of files Claude has touched' })
    void $.ui.open({ id: PANE, title: 'Files touched' })

    return next(e)
  })

  on('command.run', { command: 'files' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Files touched' })
    return { text: 'Files pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const isRead = READS.has(tool)
    const isWrite = WRITES.has(tool)
    const input = e as unknown as { file_path?: unknown; notebook_path?: unknown }
    const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : undefined

    if ((!isRead && !isWrite) || path === undefined) {
      return next(e)
    }
    const now = await $.clock.now()
    await update($, files, list => {
      const found = list.find(f => f.path === path)
      const row: FileTouch = {
        path,
        reads: (found?.reads ?? 0) + (isRead ? 1 : 0),
        writes: (found?.writes ?? 0) + (isWrite ? 1 : 0),
        isActive: true,
        lastAt: now,
      }
      return found ? list.map(f => (f.path === path ? row : f)) : [...list, row].slice(-500)
    })
    try {
      return await next(e)
    } finally {
      await update($, files, list => list.map(f => (f.path === path ? { ...f, isActive: false } : f)))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, files)
    const base = await read($, root)
    const latest = list.reduce((m, f) => Math.max(m, f.lastAt), 0)

    if (list.length === 0) {
      return <Text dimColor>No files touched yet.</Text>
    }
    const written = list.filter(f => f.writes > 0).length

    return (
      <Box flexDirection="column">
        <Text dimColor>
          {list.length} files · {written} changed · legend: ● active  ✎ edited  · read
        </Text>
        {rows(build(list, base), 0, []).map(r => {
          const f = r.file
          const mark = !f ? '' : f.isActive ? '● ' : f.writes > 0 ? '✎ ' : '· '
          const counts = !f ? '' : ` ${f.reads ? `r${f.reads}` : ''}${f.reads && f.writes ? ' ' : ''}${f.writes ? `w${f.writes}` : ''}`
          return (
            <Text
              wrap="truncate-end"
              bold={f?.isActive || f?.lastAt === latest}
              color={f?.isActive ? 'warning' : f && f.writes > 0 ? 'success' : undefined}
              dimColor={f !== undefined && f.writes === 0 && !f.isActive}
            >
              {'  '.repeat(r.depth)}
              {mark}
              {r.label}
              {counts}
            </Text>
          )
        })}
      </Box>
    )
  })
}
