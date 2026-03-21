import type { ToolContext, ToolDef } from '../harnesses'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const cwd = process.cwd()

function safePath(p: string): string {
  const resolved = resolve(cwd, p)
  if (!resolved.startsWith(cwd))
    throw new Error(`Path escapes working directory: ${p}`)
  return resolved
}

export const writeFile: ToolDef = {
  spec: {
    name: 'write_file',
    description: 'Write content to a file. Creates parent directories if needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  async execute({ path, content }, _ctx: ToolContext) {
    const target = safePath(path as string)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content as string)
    return `Wrote ${(content as string).length} bytes to ${path}`
  },
}
