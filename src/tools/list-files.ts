import type { ToolContext, ToolDef } from '../harnesses'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const cwd = process.cwd()

function safePath(p: string): string {
  const resolved = resolve(cwd, p)
  if (!resolved.startsWith(cwd))
    throw new Error(`Path escapes working directory: ${p}`)
  return resolved
}

export const listFiles: ToolDef = {
  spec: {
    name: 'list_files',
    description: 'List files and directories at the given path (relative to project root).',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative directory path (default: ".")' },
      },
      required: [],
    },
  },
  async execute({ path }, _ctx: ToolContext) {
    const target = safePath((path as string) || '.')
    if (!existsSync(target))
      return `Directory not found: ${path}`
    const entries = readdirSync(target)
    return entries
      .map((name) => {
        const full = resolve(target, name)
        const isDir = statSync(full).isDirectory()
        return `${isDir ? '📁' : '📄'} ${name}`
      })
      .join('\n')
  },
}
