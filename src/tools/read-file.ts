import type { ToolContext, ToolDef } from '../harnesses'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const cwd = process.cwd()

function safePath(p: string): string {
  const resolved = resolve(cwd, p)
  if (!resolved.startsWith(cwd))
    throw new Error(`Path escapes working directory: ${p}`)
  return resolved
}

export const readFile: ToolDef = {
  spec: {
    name: 'read_file',
    description: 'Read the contents of a file at the given path (relative to project root).',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative file path' },
      },
      required: ['path'],
    },
  },
  async execute({ path }, _ctx: ToolContext) {
    const target = safePath(path as string)
    if (!existsSync(target))
      return `File not found: ${path}`
    return readFileSync(target, 'utf-8')
  },
}
