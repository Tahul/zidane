/**
 * In-process execution context.
 *
 * Runs everything in the current Node/Bun process.
 * No isolation — fastest, used as the default.
 */

import { exec as execCb } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ContextCapabilities, ExecResult, ExecutionContext, ExecutionHandle, SpawnConfig } from './types'

const execAsync = promisify(execCb)

let counter = 0

export function createProcessContext(): ExecutionContext {
  const handles = new Map<string, ExecutionHandle>()

  return {
    type: 'process',

    capabilities: {
      shell: true,
      filesystem: true,
      network: true,
      gpu: false,
    } satisfies ContextCapabilities,

    async spawn(config?: SpawnConfig): Promise<ExecutionHandle> {
      const id = `process-${++counter}`
      const cwd = config?.cwd ?? process.cwd()

      await mkdir(cwd, { recursive: true })

      const handle: ExecutionHandle = { id, type: 'process', cwd }
      handles.set(id, handle)
      return handle
    },

    async exec(handle: ExecutionHandle, command: string, options?: { cwd?: string, env?: Record<string, string>, timeout?: number }): Promise<ExecResult> {
      const cwd = options?.cwd ? resolve(handle.cwd, options.cwd) : handle.cwd

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          env: options?.env ? { ...process.env, ...options.env } : process.env,
          timeout: (options?.timeout ?? 30) * 1000,
          maxBuffer: 10 * 1024 * 1024,
        })
        return { stdout, stderr, exitCode: 0 }
      }
      catch (err: any) {
        return {
          stdout: err.stdout ?? '',
          stderr: err.stderr ?? err.message,
          exitCode: err.code ?? 1,
        }
      }
    },

    async readFile(handle: ExecutionHandle, path: string): Promise<string> {
      return readFile(resolve(handle.cwd, path), 'utf-8')
    },

    async writeFile(handle: ExecutionHandle, path: string, content: string): Promise<void> {
      const fullPath = resolve(handle.cwd, path)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content, 'utf-8')
    },

    async listFiles(handle: ExecutionHandle, path: string): Promise<string[]> {
      return readdir(resolve(handle.cwd, path))
    },

    async destroy(handle: ExecutionHandle): Promise<void> {
      handles.delete(handle.id)
    },
  }
}
