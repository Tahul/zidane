/**
 * Remote sandbox execution context.
 *
 * Offloads execution to a remote sandbox API (e.g. Rivet, E2B).
 * This is a base implementation — specific providers extend it.
 *
 * The interface is intentionally generic so different sandbox providers
 * can be plugged in by implementing the SandboxProvider interface.
 */

import type { ContextCapabilities, ExecResult, ExecutionContext, ExecutionHandle, SpawnConfig } from './types'

// ---------------------------------------------------------------------------
// Sandbox provider interface
// ---------------------------------------------------------------------------

export interface SandboxProvider {
  name: string
  spawn(config: SpawnConfig): Promise<{ id: string, cwd: string }>
  exec(sandboxId: string, command: string, options?: { cwd?: string, env?: Record<string, string>, timeout?: number }): Promise<ExecResult>
  readFile(sandboxId: string, path: string): Promise<string>
  writeFile(sandboxId: string, path: string, content: string): Promise<void>
  listFiles(sandboxId: string, path: string): Promise<string[]>
  destroy(sandboxId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Sandbox execution context
// ---------------------------------------------------------------------------

export function createSandboxContext(provider: SandboxProvider): ExecutionContext {
  const sandboxes = new Map<string, string>() // handle.id → sandbox.id

  return {
    type: 'sandbox',

    capabilities: {
      shell: true,
      filesystem: true,
      network: true,
      gpu: false,
    } satisfies ContextCapabilities,

    async spawn(config?: SpawnConfig): Promise<ExecutionHandle> {
      const result = await provider.spawn(config ?? {})
      const handle: ExecutionHandle = { id: result.id, type: 'sandbox', cwd: result.cwd }
      sandboxes.set(handle.id, result.id)
      return handle
    },

    async exec(handle: ExecutionHandle, command: string, options?): Promise<ExecResult> {
      const sandboxId = sandboxes.get(handle.id)
      if (!sandboxId) throw new Error(`Sandbox ${handle.id} not found`)
      return provider.exec(sandboxId, command, options)
    },

    async readFile(handle: ExecutionHandle, path: string): Promise<string> {
      const sandboxId = sandboxes.get(handle.id)
      if (!sandboxId) throw new Error(`Sandbox ${handle.id} not found`)
      return provider.readFile(sandboxId, path)
    },

    async writeFile(handle: ExecutionHandle, path: string, content: string): Promise<void> {
      const sandboxId = sandboxes.get(handle.id)
      if (!sandboxId) throw new Error(`Sandbox ${handle.id} not found`)
      return provider.writeFile(sandboxId, path, content)
    },

    async listFiles(handle: ExecutionHandle, path: string): Promise<string[]> {
      const sandboxId = sandboxes.get(handle.id)
      if (!sandboxId) throw new Error(`Sandbox ${handle.id} not found`)
      return provider.listFiles(sandboxId, path)
    },

    async destroy(handle: ExecutionHandle): Promise<void> {
      const sandboxId = sandboxes.get(handle.id)
      if (!sandboxId) return
      await provider.destroy(sandboxId)
      sandboxes.delete(handle.id)
    },
  }
}
