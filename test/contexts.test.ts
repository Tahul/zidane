import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'bun:test'

import { createAgent } from '../src/agent'
import { createProcessContext, createSandboxContext } from '../src/contexts'
import { basic } from '../src/harnesses'
import { createMockContext, createMockSandboxProvider } from './mock-context'
import { createMockProvider } from './mock-provider'

// ---------------------------------------------------------------------------
// ProcessContext
// ---------------------------------------------------------------------------

describe('ProcessContext', () => {
  const ctx = createProcessContext()
  const testDir = join(tmpdir(), `zidane-test-${Date.now()}`)

  afterAll(() => {
    if (existsSync(testDir))
      rmSync(testDir, { recursive: true })
  })

  it('has correct type and capabilities', () => {
    expect(ctx.type).toBe('process')
    expect(ctx.capabilities.shell).toBe(true)
    expect(ctx.capabilities.filesystem).toBe(true)
    expect(ctx.capabilities.network).toBe(true)
    expect(ctx.capabilities.gpu).toBe(false)
  })

  it('spawns a handle with correct cwd', async () => {
    const handle = await ctx.spawn({ cwd: testDir })

    expect(handle.id).toMatch(/^process-/)
    expect(handle.type).toBe('process')
    expect(handle.cwd).toBe(testDir)

    await ctx.destroy(handle)
  })

  it('executes shell commands', async () => {
    const handle = await ctx.spawn({ cwd: testDir })
    const result = await ctx.exec(handle, 'echo hello')

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('hello')

    await ctx.destroy(handle)
  })

  it('captures exit codes on failure', async () => {
    const handle = await ctx.spawn({ cwd: testDir })
    const result = await ctx.exec(handle, 'exit 42')

    expect(result.exitCode).not.toBe(0)

    await ctx.destroy(handle)
  })

  it('passes environment variables', async () => {
    const handle = await ctx.spawn({ cwd: testDir })
    const result = await ctx.exec(handle, 'echo $TEST_VAR', { env: { TEST_VAR: 'zidane' } })

    expect(result.stdout.trim()).toBe('zidane')

    await ctx.destroy(handle)
  })

  it('reads and writes files', async () => {
    const handle = await ctx.spawn({ cwd: testDir })

    await ctx.writeFile(handle, 'test.txt', 'hello zidane')
    const content = await ctx.readFile(handle, 'test.txt')

    expect(content).toBe('hello zidane')

    await ctx.destroy(handle)
  })

  it('creates nested directories on write', async () => {
    const handle = await ctx.spawn({ cwd: testDir })

    await ctx.writeFile(handle, 'deep/nested/file.txt', 'deep content')
    const content = await ctx.readFile(handle, 'deep/nested/file.txt')

    expect(content).toBe('deep content')

    await ctx.destroy(handle)
  })

  it('lists files in a directory', async () => {
    const handle = await ctx.spawn({ cwd: testDir })

    await ctx.writeFile(handle, 'a.txt', 'a')
    await ctx.writeFile(handle, 'b.txt', 'b')
    const files = await ctx.listFiles(handle, '.')

    expect(files).toContain('a.txt')
    expect(files).toContain('b.txt')

    await ctx.destroy(handle)
  })

  it('throws on readFile for non-existent file', async () => {
    const handle = await ctx.spawn({ cwd: testDir })

    await expect(ctx.readFile(handle, 'nonexistent.txt')).rejects.toThrow()

    await ctx.destroy(handle)
  })

  it('destroy removes handle', async () => {
    const handle = await ctx.spawn({ cwd: testDir })
    await ctx.destroy(handle)
    // Destroying again should not throw
    await ctx.destroy(handle)
  })
})

// ---------------------------------------------------------------------------
// MockContext
// ---------------------------------------------------------------------------

describe('MockContext', () => {
  it('tracks all operations', async () => {
    const ctx = createMockContext()
    const handle = await ctx.spawn({ cwd: '/test' })

    await ctx.writeFile(handle, 'file.txt', 'content')
    await ctx.readFile(handle, 'file.txt')
    await ctx.exec(handle, 'echo hi')
    await ctx.listFiles(handle, '/')
    await ctx.destroy(handle)

    expect(ctx.operations).toHaveLength(6) // spawn + write + read + exec + list + destroy
    expect(ctx.operations[0].type).toBe('spawn')
    expect(ctx.operations[1].type).toBe('writeFile')
    expect(ctx.operations[2].type).toBe('readFile')
    expect(ctx.operations[3].type).toBe('exec')
    expect(ctx.operations[4].type).toBe('listFiles')
    expect(ctx.operations[5].type).toBe('destroy')
  })

  it('stores and retrieves files', async () => {
    const ctx = createMockContext()
    const handle = await ctx.spawn()

    await ctx.writeFile(handle, 'hello.txt', 'world')
    const content = await ctx.readFile(handle, 'hello.txt')

    expect(content).toBe('world')
    expect(ctx.files.get('hello.txt')).toBe('world')
  })

  it('throws on missing file', async () => {
    const ctx = createMockContext()
    const handle = await ctx.spawn()

    await expect(ctx.readFile(handle, 'missing.txt')).rejects.toThrow('File not found')
  })

  it('uses custom exec handler', async () => {
    const ctx = createMockContext({
      execHandler: cmd => ({
        stdout: `ran: ${cmd}`,
        stderr: '',
        exitCode: 0,
      }),
    })
    const handle = await ctx.spawn()
    const result = await ctx.exec(handle, 'ls -la')

    expect(result.stdout).toBe('ran: ls -la')
  })

  it('overrides capabilities', () => {
    const ctx = createMockContext({ capabilities: { shell: false, gpu: true } })

    expect(ctx.capabilities.shell).toBe(false)
    expect(ctx.capabilities.gpu).toBe(true)
    expect(ctx.capabilities.filesystem).toBe(true) // default
  })
})

// ---------------------------------------------------------------------------
// SandboxContext with mock provider
// ---------------------------------------------------------------------------

describe('SandboxContext', () => {
  it('delegates all operations to the provider', async () => {
    const provider = createMockSandboxProvider()
    const ctx = createSandboxContext(provider)

    const handle = await ctx.spawn({ cwd: '/sandbox-work' })

    expect(handle.type).toBe('sandbox')
    expect(ctx.type).toBe('sandbox')

    provider.files.set('test.txt', 'sandbox content')

    const content = await ctx.readFile(handle, 'test.txt')
    expect(content).toBe('sandbox content')

    await ctx.writeFile(handle, 'out.txt', 'result')
    expect(provider.files.get('out.txt')).toBe('result')

    const result = await ctx.exec(handle, 'echo hello')
    expect(result.exitCode).toBe(0)

    await ctx.destroy(handle)

    // Verify operations were tracked
    const types = provider.operations.map(o => o.type)
    expect(types).toContain('spawn')
    expect(types).toContain('readFile')
    expect(types).toContain('writeFile')
    expect(types).toContain('exec')
    expect(types).toContain('destroy')
  })

  it('uses custom exec handler', async () => {
    const provider = createMockSandboxProvider({
      execHandler: cmd => ({ stdout: `sandbox: ${cmd}`, stderr: '', exitCode: 0 }),
    })
    const ctx = createSandboxContext(provider)
    const handle = await ctx.spawn()

    const result = await ctx.exec(handle, 'whoami')
    expect(result.stdout).toBe('sandbox: whoami')
  })

  it('throws on operations with destroyed handle', async () => {
    const provider = createMockSandboxProvider()
    const ctx = createSandboxContext(provider)
    const handle = await ctx.spawn()

    await ctx.destroy(handle)

    await expect(ctx.exec(handle, 'echo')).rejects.toThrow('not found')
  })
})

// ---------------------------------------------------------------------------
// Agent + Context integration
// ---------------------------------------------------------------------------

describe('Agent with execution context', () => {
  it('defaults to ProcessContext when no context is provided', async () => {
    const provider = createMockProvider([{ text: 'hello', done: true }])
    const agent = createAgent({ harness: basic, provider })

    expect(agent.context.type).toBe('process')
  })

  it('uses provided context', async () => {
    const mockCtx = createMockContext()
    const provider = createMockProvider([{ text: 'hello', done: true }])
    const agent = createAgent({ harness: basic, provider, context: mockCtx })

    expect(agent.context.type).toBe('process')
    expect(agent.context).toBe(mockCtx)
  })

  it('spawns context handle on first run', async () => {
    const mockCtx = createMockContext()
    const provider = createMockProvider([{ text: 'hello', done: true }])
    const agent = createAgent({ harness: basic, provider, context: mockCtx })

    expect(agent.handle).toBeNull()

    await agent.run({ prompt: 'hi' })

    expect(agent.handle).not.toBeNull()
    expect(agent.handle!.type).toBe('process')
    expect(mockCtx.operations[0].type).toBe('spawn')
  })

  it('reuses handle across multiple runs', async () => {
    const mockCtx = createMockContext()
    const provider = createMockProvider([
      { text: 'first', done: true },
      { text: 'second', done: true },
    ])
    const agent = createAgent({ harness: basic, provider, context: mockCtx })

    await agent.run({ prompt: 'first' })
    const firstHandle = agent.handle

    await agent.run({ prompt: 'second' })
    const secondHandle = agent.handle

    expect(firstHandle!.id).toBe(secondHandle!.id)
    // Only one spawn
    expect(mockCtx.operations.filter(o => o.type === 'spawn')).toHaveLength(1)
  })

  it('exposes context on agent for tool access', async () => {
    const mockCtx = createMockContext({
      execHandler: () => ({ stdout: 'mock output', stderr: '', exitCode: 0 }),
    })
    const provider = createMockProvider([{ text: 'done', done: true }])
    const agent = createAgent({ harness: basic, provider, context: mockCtx })

    await agent.run({ prompt: 'hi' })

    // Tools could access agent.context and agent.handle
    const result = await agent.context.exec(agent.handle!, 'test command')
    expect(result.stdout).toBe('mock output')
  })
})

// ---------------------------------------------------------------------------
// Agent destroy
// ---------------------------------------------------------------------------

describe('Agent destroy', () => {
  it('destroys the execution context handle', async () => {
    const mockCtx = createMockContext()
    const provider = createMockProvider([{ text: 'hello', done: true }])
    const agent = createAgent({ harness: basic, provider, context: mockCtx })

    await agent.run({ prompt: 'hi' })
    expect(agent.handle).not.toBeNull()

    await agent.destroy()
    expect(agent.handle).toBeNull()
    expect(mockCtx.operations.filter(o => o.type === 'destroy')).toHaveLength(1)
  })

  it('is safe to call destroy without a handle', async () => {
    const mockCtx = createMockContext()
    const provider = createMockProvider([{ text: 'hello', done: true }])
    const agent = createAgent({ harness: basic, provider, context: mockCtx })

    // Never called run, so no handle
    await agent.destroy()
    expect(mockCtx.operations.filter(o => o.type === 'destroy')).toHaveLength(0)
  })

  it('allows re-spawn after destroy', async () => {
    const mockCtx = createMockContext()
    const provider = createMockProvider([
      { text: 'first', done: true },
      { text: 'second', done: true },
    ])
    const agent = createAgent({ harness: basic, provider, context: mockCtx })

    await agent.run({ prompt: 'first' })
    const firstId = agent.handle!.id
    await agent.destroy()

    await agent.run({ prompt: 'second' })
    const secondId = agent.handle!.id

    // New handle after destroy + re-run
    expect(firstId).not.toBe(secondId)
    expect(mockCtx.operations.filter(o => o.type === 'spawn')).toHaveLength(2)
  })
})
