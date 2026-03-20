/**
 * Mock execution context for testing.
 *
 * Simulates an execution context in-memory without spawning real
 * processes, containers, or sandboxes. Tracks all operations for assertions.
 */

import type { ContextCapabilities, ExecResult, ExecutionContext, ExecutionHandle, SpawnConfig } from '../src/contexts'
import type { SandboxProvider } from '../src/contexts/sandbox'

// ---------------------------------------------------------------------------
// Operation log (for assertions)
// ---------------------------------------------------------------------------

export interface ContextOperation {
  type: 'spawn' | 'exec' | 'readFile' | 'writeFile' | 'listFiles' | 'destroy'
  handleId?: string
  args: unknown[]
  result?: unknown
}

// ---------------------------------------------------------------------------
// Mock execution context
// ---------------------------------------------------------------------------

export interface MockContextOptions {
  /** Override capabilities */
  capabilities?: Partial<ContextCapabilities>
  /** Custom exec handler */
  execHandler?: (command: string) => ExecResult | Promise<ExecResult>
}

export function createMockContext(options?: MockContextOptions): ExecutionContext & { operations: ContextOperation[], files: Map<string, string> } {
  let counter = 0
  const handles = new Map<string, ExecutionHandle>()
  const files = new Map<string, string>()
  const operations: ContextOperation[] = []

  const defaultExec: ExecResult = { stdout: '', stderr: '', exitCode: 0 }

  return {
    type: 'process',
    operations,
    files,

    capabilities: {
      shell: options?.capabilities?.shell ?? true,
      filesystem: options?.capabilities?.filesystem ?? true,
      network: options?.capabilities?.network ?? true,
      gpu: options?.capabilities?.gpu ?? false,
    },

    async spawn(config?: SpawnConfig): Promise<ExecutionHandle> {
      const id = `mock-${++counter}`
      const cwd = config?.cwd ?? '/mock-workspace'
      const handle: ExecutionHandle = { id, type: 'process', cwd }
      handles.set(id, handle)
      operations.push({ type: 'spawn', handleId: id, args: [config] })
      return handle
    },

    async exec(handle: ExecutionHandle, command: string, opts?): Promise<ExecResult> {
      const result = options?.execHandler
        ? await options.execHandler(command)
        : defaultExec
      operations.push({ type: 'exec', handleId: handle.id, args: [command, opts], result })
      return result
    },

    async readFile(handle: ExecutionHandle, path: string): Promise<string> {
      const content = files.get(path)
      operations.push({ type: 'readFile', handleId: handle.id, args: [path], result: content })
      if (content === undefined)
        throw new Error(`File not found: ${path}`)
      return content
    },

    async writeFile(handle: ExecutionHandle, path: string, content: string): Promise<void> {
      files.set(path, content)
      operations.push({ type: 'writeFile', handleId: handle.id, args: [path, content] })
    },

    async listFiles(handle: ExecutionHandle, path: string): Promise<string[]> {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const result = [...files.keys()]
        .filter(f => f.startsWith(prefix))
        .map(f => f.slice(prefix.length).split('/')[0])
        .filter((v, i, a) => a.indexOf(v) === i)
      operations.push({ type: 'listFiles', handleId: handle.id, args: [path], result })
      return result
    },

    async destroy(handle: ExecutionHandle): Promise<void> {
      handles.delete(handle.id)
      operations.push({ type: 'destroy', handleId: handle.id, args: [] })
    },
  }
}

// ---------------------------------------------------------------------------
// Mock sandbox provider
// ---------------------------------------------------------------------------

export function createMockSandboxProvider(options?: { execHandler?: (command: string) => ExecResult }): SandboxProvider & { operations: ContextOperation[], files: Map<string, string> } {
  let counter = 0
  const files = new Map<string, string>()
  const operations: ContextOperation[] = []
  const defaultExec: ExecResult = { stdout: '', stderr: '', exitCode: 0 }

  return {
    name: 'mock-sandbox',
    operations,
    files,

    async spawn(config: SpawnConfig) {
      const id = `sandbox-${++counter}`
      operations.push({ type: 'spawn', args: [config] })
      return { id, cwd: config.cwd ?? '/sandbox' }
    },

    async exec(sandboxId: string, command: string, opts?) {
      const result = options?.execHandler
        ? options.execHandler(command)
        : defaultExec
      operations.push({ type: 'exec', handleId: sandboxId, args: [command, opts], result })
      return result
    },

    async readFile(sandboxId: string, path: string) {
      const content = files.get(path)
      operations.push({ type: 'readFile', handleId: sandboxId, args: [path] })
      if (content === undefined)
        throw new Error(`File not found: ${path}`)
      return content
    },

    async writeFile(sandboxId: string, path: string, content: string) {
      files.set(path, content)
      operations.push({ type: 'writeFile', handleId: sandboxId, args: [path, content] })
    },

    async listFiles(sandboxId: string, path: string) {
      const prefix = path.endsWith('/') ? path : `${path}/`
      const result = [...files.keys()]
        .filter(f => f.startsWith(prefix))
        .map(f => f.slice(prefix.length).split('/')[0])
        .filter((v, i, a) => a.indexOf(v) === i)
      operations.push({ type: 'listFiles', handleId: sandboxId, args: [path] })
      return result
    },

    async destroy(sandboxId: string) {
      operations.push({ type: 'destroy', handleId: sandboxId, args: [] })
    },
  }
}
