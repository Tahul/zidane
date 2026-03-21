import type { ToolContext, ToolDef } from '.'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineHarness } from '.'

const cwd = process.cwd()

function safePath(p: string): string {
  const resolved = resolve(cwd, p)
  if (!resolved.startsWith(cwd))
    throw new Error(`Path escapes working directory: ${p}`)
  return resolved
}

const shell: ToolDef = {
  spec: {
    name: 'shell',
    description: 'Execute a shell command and return stdout+stderr. Runs in the project root.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
      },
      required: ['command'],
    },
  },
  async execute({ command }, _ctx: ToolContext) {
    try {
      const out = execSync(command as string, {
        cwd,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return out || '(no output)'
    }
    catch (err: any) {
      const stderr = err.stderr?.toString() ?? ''
      const stdout = err.stdout?.toString() ?? ''
      return `Exit code ${err.status ?? 1}\n${stdout}\n${stderr}`.trim()
    }
  },
}

const readFile: ToolDef = {
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

const writeFile: ToolDef = {
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

const listFiles: ToolDef = {
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

/** Core tools available in every basic harness (without spawn) */
export const basicTools = { shell, readFile, writeFile, listFiles }

// Lazy-loaded spawn to break circular dependency:
// basic → tools/spawn → agent → harnesses → basic
let _spawn: ToolDef | undefined
function getSpawn(): ToolDef {
  if (!_spawn) {
    // eslint-disable-next-line ts/no-require-imports
    _spawn = require('../tools/spawn').spawn as ToolDef
  }
  return _spawn
}

const spawnProxy: ToolDef = {
  get spec() { return getSpawn().spec },
  execute(input, ctx) { return getSpawn().execute(input, ctx) },
}

export default defineHarness({
  name: 'basic',
  system: 'You are a helpful assistant with access to shell, file reading, file writing, directory listing, and sub-agent spawning tools. Use them to accomplish tasks in the project directory.',
  tools: { ...basicTools, spawn: spawnProxy },
})
