import type { ToolContext, ToolDef } from '../harnesses'
import { execSync } from 'node:child_process'

const cwd = process.cwd()

export const shell: ToolDef = {
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
