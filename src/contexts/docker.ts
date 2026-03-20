/**
 * Docker execution context.
 *
 * Runs tools inside a Docker container via dockerode.
 * Full isolation with configurable resource limits.
 *
 * Requires `dockerode` as an optional peer dependency.
 */

import type { ContextCapabilities, ExecResult, ExecutionContext, ExecutionHandle, SpawnConfig } from './types'

const SINGLE_QUOTE_RE = /'/g

interface ContainerRef {
  handle: ExecutionHandle
  container: any
  docker: any
}

export function createDockerContext(config?: SpawnConfig): ExecutionContext {
  let counter = 0
  const containers = new Map<string, ContainerRef>()
  const defaultImage = config?.image ?? 'oven/bun:latest'
  const defaultCwd = config?.cwd ?? '/workspace'
  const defaultEnv = config?.env
  const defaultLimits = config?.limits

  async function getDockerode() {
    try {
      const Dockerode = (await import('dockerode')).default
      return new Dockerode()
    }
    catch {
      throw new Error('dockerode is required for Docker execution context. Install it with: bun add dockerode')
    }
  }

  const ctx: ExecutionContext = {
    type: 'docker',

    capabilities: {
      shell: true,
      filesystem: true,
      network: true,
      gpu: false,
    } satisfies ContextCapabilities,

    async spawn(overrides?: SpawnConfig): Promise<ExecutionHandle> {
      const docker = await getDockerode()
      const id = `docker-${++counter}`
      const image = overrides?.image ?? defaultImage
      const cwd = overrides?.cwd ?? defaultCwd

      // Pull image if not available
      try {
        await docker.getImage(image).inspect()
      }
      catch {
        await new Promise<void>((resolve, reject) => {
          docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
            if (err)
              return reject(err)
            docker.modem.followProgress(stream, (err2: Error | null) => {
              err2 ? reject(err2) : resolve()
            })
          })
        })
      }

      const limits = { ...defaultLimits, ...overrides?.limits }
      const hostConfig: Record<string, unknown> = {}

      if (limits?.memory) {
        hostConfig.Memory = limits.memory * 1024 * 1024
      }
      if (limits?.cpu) {
        hostConfig.NanoCpus = Number.parseFloat(limits.cpu) * 1e9
      }

      const env = { ...defaultEnv, ...overrides?.env }

      const container = await docker.createContainer({
        Image: image,
        Cmd: ['sleep', 'infinity'],
        WorkingDir: cwd,
        Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
        HostConfig: hostConfig,
      })

      await container.start()

      const handle: ExecutionHandle = { id, type: 'docker', cwd }
      containers.set(id, { handle, container, docker })
      return handle
    },

    async exec(handle: ExecutionHandle, command: string, options?: { cwd?: string, env?: Record<string, string>, timeout?: number }): Promise<ExecResult> {
      const ref = containers.get(handle.id)
      if (!ref)
        throw new Error(`Container ${handle.id} not found`)

      const execCwd = options?.cwd ?? handle.cwd
      const env = options?.env
        ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`)
        : []

      const exec = await ref.container.exec({
        Cmd: ['sh', '-c', command],
        WorkingDir: execCwd,
        Env: env,
        AttachStdout: true,
        AttachStderr: true,
      })

      const stream = await exec.start({ Detach: false })

      return new Promise<ExecResult>((resolve) => {
        let stdout = ''
        const stderr = ''

        const timeout = options?.timeout ?? defaultLimits?.timeout ?? 30
        const timer = setTimeout(() => {
          resolve({ stdout, stderr: `${stderr}\n[timeout]`, exitCode: 124 })
        }, timeout * 1000)

        stream.on('data', (chunk: { toString: (enc: string) => string }) => {
          stdout += chunk.toString('utf-8')
        })

        stream.on('end', async () => {
          clearTimeout(timer)
          const inspect = await exec.inspect()
          resolve({ stdout, stderr, exitCode: inspect.ExitCode ?? 0 })
        })
      })
    },

    async readFile(handle: ExecutionHandle, path: string): Promise<string> {
      const result = await ctx.exec(handle, `cat ${JSON.stringify(path)}`)
      if (result.exitCode !== 0)
        throw new Error(`Failed to read file: ${result.stderr}`)
      return result.stdout
    },

    async writeFile(handle: ExecutionHandle, path: string, content: string): Promise<void> {
      const escaped = content.replace(SINGLE_QUOTE_RE, String.raw`'\''`)
      const result = await ctx.exec(handle, `mkdir -p "$(dirname ${JSON.stringify(path)})" && printf '%s' '${escaped}' > ${JSON.stringify(path)}`)
      if (result.exitCode !== 0)
        throw new Error(`Failed to write file: ${result.stderr}`)
    },

    async listFiles(handle: ExecutionHandle, path: string): Promise<string[]> {
      const result = await ctx.exec(handle, `ls -1 ${JSON.stringify(path)}`)
      if (result.exitCode !== 0)
        return []
      return result.stdout.trim().split('\n').filter(Boolean)
    },

    async destroy(handle: ExecutionHandle): Promise<void> {
      const ref = containers.get(handle.id)
      if (!ref)
        return

      try {
        await ref.container.stop({ t: 5 })
        await ref.container.remove({ force: true })
      }
      catch {
        // Container may already be stopped
      }

      containers.delete(handle.id)
    },
  }

  return ctx
}
