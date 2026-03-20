/**
 * Execution context types.
 *
 * An execution context defines *where* and *how* an agent's tools run.
 * The agent loop and tools interact through this interface without knowing
 * whether they're running in-process, in a Docker container, or in a
 * remote sandbox.
 */

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface ContextCapabilities {
  /** Can execute shell commands */
  shell: boolean
  /** Can read/write files in a workspace */
  filesystem: boolean
  /** Can make outbound network requests */
  network: boolean
  /** Has GPU access */
  gpu: boolean
}

// ---------------------------------------------------------------------------
// Execution handle
// ---------------------------------------------------------------------------

/** Opaque handle to a running execution context instance */
export interface ExecutionHandle {
  id: string
  type: ContextType
  /** Working directory within the context */
  cwd: string
}

// ---------------------------------------------------------------------------
// Exec result
// ---------------------------------------------------------------------------

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

// ---------------------------------------------------------------------------
// Spawn config
// ---------------------------------------------------------------------------

export interface SpawnConfig {
  /** Working directory (created if it doesn't exist) */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Docker image (only for 'docker' context) */
  image?: string
  /** Resource limits */
  limits?: {
    /** Memory limit in MB */
    memory?: number
    /** CPU limit (e.g. '1.0' = 1 core) */
    cpu?: string
    /** Timeout in seconds for the entire context lifetime */
    timeout?: number
  }
  /** Sandbox provider config (only for 'sandbox' context) */
  sandbox?: {
    provider: string
    apiKey?: string
    [key: string]: unknown
  }
}

// ---------------------------------------------------------------------------
// Execution context interface
// ---------------------------------------------------------------------------

export type ContextType = 'process' | 'docker' | 'sandbox'

export interface ExecutionContext {
  /** Context type identifier */
  readonly type: ContextType

  /** What this context supports */
  readonly capabilities: ContextCapabilities

  /** Spawn a new execution environment */
  spawn(config?: SpawnConfig): Promise<ExecutionHandle>

  /** Execute a shell command in the context */
  exec(handle: ExecutionHandle, command: string, options?: { cwd?: string, env?: Record<string, string>, timeout?: number }): Promise<ExecResult>

  /** Read a file from the context's filesystem */
  readFile(handle: ExecutionHandle, path: string): Promise<string>

  /** Write a file to the context's filesystem */
  writeFile(handle: ExecutionHandle, path: string, content: string): Promise<void>

  /** List files in a directory */
  listFiles(handle: ExecutionHandle, path: string): Promise<string[]>

  /** Destroy the execution environment and clean up resources */
  destroy(handle: ExecutionHandle): Promise<void>
}
