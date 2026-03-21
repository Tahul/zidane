import type { ToolContext } from '../src/harnesses'
import type { ChildAgent } from '../src/tools'

import type { AgentStats } from '../src/types'
import { describe, expect, it } from 'bun:test'
import { createHooks } from 'hookable'
import { createAgent } from '../src/agent'
import { basic, defineHarness } from '../src/harnesses'
import { createSpawnTool, spawn } from '../src/tools'
import { createMockContext } from './mock-context'
import { createMockProvider } from './mock-provider'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockProvider(turns: Parameters<typeof createMockProvider>[0]) {
  return createMockProvider(turns)
}

/** Create a minimal ToolContext for direct tool.execute() calls in tests */
function mockToolCtx(overrides?: Partial<ToolContext>): ToolContext {
  const mockCtx = createMockContext()
  const hooks = createHooks()
  const defaultProvider = mockProvider([{ text: 'ctx-default', done: true }])
  return {
    provider: overrides?.provider ?? defaultProvider,
    signal: overrides?.signal ?? new AbortController().signal,
    execution: overrides?.execution ?? mockCtx,
    handle: overrides?.handle ?? { id: 'test-handle', type: 'process', cwd: '/tmp' },
    hooks: overrides?.hooks ?? hooks as any,
    harness: overrides?.harness ?? basic,
  }
}

// ---------------------------------------------------------------------------
// Static spawn tool
// ---------------------------------------------------------------------------

describe('spawn (static tool)', () => {
  it('has correct spec', () => {
    expect(spawn.spec.name).toBe('spawn')
    expect(spawn.spec.input_schema.required).toContain('task')
    expect(typeof spawn.execute).toBe('function')
  })

  it('is included in basic harness', () => {
    expect(basic.tools.spawn).toBeDefined()
    expect(basic.tools.spawn.spec.name).toBe('spawn')
  })
})

// ---------------------------------------------------------------------------
// createSpawnTool (configurable factory)
// ---------------------------------------------------------------------------

describe('createSpawnTool', () => {
  it('creates a valid ToolDef with defaults', () => {
    const tool = createSpawnTool()

    expect(tool.spec.name).toBe('spawn')
    expect(tool.spec.input_schema.required).toContain('task')
    expect(typeof tool.execute).toBe('function')
  })

  it('spawns a child agent and returns its response', async () => {
    const provider = mockProvider([
      { text: 'I completed the task successfully.', done: true },
    ])
    const tool = createSpawnTool()

    const result = await tool.execute({ task: 'do something' }, mockToolCtx({ provider }))

    expect(result).toContain('Completed')
    expect(result).toContain('child-1')
  })

  it('handles child agent errors gracefully', async () => {
    const errorProvider = {
      ...mockProvider([]),
      async stream() {
        throw new Error('LLM connection failed')
      },
    }
    const tool = createSpawnTool()

    const result = await tool.execute(
      { task: 'this will fail' },
      mockToolCtx({ provider: errorProvider as any }),
    )

    expect(result).toContain('Error')
    expect(result).toContain('child-1')
    expect(result).toContain('LLM connection failed')
  })

  it('tracks total child stats', async () => {
    const provider = mockProvider([
      { text: 'done 1', done: true },
      { text: 'done 2', done: true },
    ])
    const tool = createSpawnTool()
    const ctx = mockToolCtx({ provider })

    await tool.execute({ task: 'task 1' }, ctx)
    await tool.execute({ task: 'task 2' }, ctx)

    expect(tool.totalChildStats.turns).toBeGreaterThanOrEqual(2)
    expect(tool.totalChildStats.totalOut).toBeGreaterThan(0)
  })

  it('cleans up children map after completion', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool()

    expect(tool.children.size).toBe(0)
    await tool.execute({ task: 'task' }, mockToolCtx({ provider }))
    expect(tool.children.size).toBe(0)
  })

  it('increments child IDs', async () => {
    const provider = mockProvider([
      { text: 'done', done: true },
      { text: 'done', done: true },
    ])
    const tool = createSpawnTool()
    const ctx = mockToolCtx({ provider })

    const r1 = await tool.execute({ task: 'first' }, ctx)
    const r2 = await tool.execute({ task: 'second' }, ctx)

    expect(r1).toContain('child-1')
    expect(r2).toContain('child-2')
  })
})

// ---------------------------------------------------------------------------
// Concurrency limit
// ---------------------------------------------------------------------------

describe('concurrency limit', () => {
  it('rejects when maxConcurrent is reached', async () => {
    const provider = mockProvider([
      { text: 'working', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo hi' } }] },
      { text: 'done', done: true },
      { text: 'working', toolCalls: [{ id: 'tc2', name: 'shell', input: { command: 'echo hi' } }] },
      { text: 'done', done: true },
    ])
    const tool = createSpawnTool({ maxConcurrent: 1 })
    const ctx = mockToolCtx({ provider })

    // Start first task (will be running)
    const p1 = tool.execute({ task: 'slow task' }, ctx)

    // Try to start second immediately — should be rejected
    const result = await tool.execute({ task: 'blocked task' }, ctx)
    expect(result).toContain('Cannot spawn')
    expect(result).toContain('1/1')

    await p1
  })
})

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe('callbacks', () => {
  it('calls onSpawn when child starts', async () => {
    const spawned: ChildAgent[] = []
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({
      onSpawn: child => spawned.push(child),
    })

    await tool.execute({ task: 'test task' }, mockToolCtx({ provider }))

    expect(spawned).toHaveLength(1)
    expect(spawned[0].id).toBe('child-1')
    expect(spawned[0].task).toBe('test task')
    expect(spawned[0].startedAt).toBeGreaterThan(0)
  })

  it('calls onComplete with stats', async () => {
    const completed: { child: ChildAgent, stats: AgentStats }[] = []
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({
      onComplete: (child, stats) => completed.push({ child, stats }),
    })

    await tool.execute({ task: 'test' }, mockToolCtx({ provider }))

    expect(completed).toHaveLength(1)
    expect(completed[0].stats.turns).toBe(1)
    expect(completed[0].child.id).toBe('child-1')
  })
})

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

describe('execution context', () => {
  it('child uses execution context from ToolContext', async () => {
    const mockCtx = createMockContext()
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool()

    await tool.execute({ task: 'test' }, mockToolCtx({ provider, execution: mockCtx }))

    expect(mockCtx.operations.some(o => o.type === 'spawn')).toBe(true)
  })

  it('destroys child execution handle after completion', async () => {
    const mockCtx = createMockContext()
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool()

    await tool.execute({ task: 'test' }, mockToolCtx({ provider, execution: mockCtx }))

    expect(mockCtx.operations.some(o => o.type === 'destroy')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// System prompt override
// ---------------------------------------------------------------------------

describe('system prompt', () => {
  it('passes global system prompt to children', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({ system: 'you are a researcher' })

    const result = await tool.execute({ task: 'research something' }, mockToolCtx({ provider }))
    expect(result).toContain('Completed')
  })

  it('allows per-spawn system prompt override', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({ system: 'default system' })

    const result = await tool.execute({
      task: 'do stuff',
      system: 'custom system for this task',
    }, mockToolCtx({ provider }))

    expect(result).toContain('Completed')
  })
})

// ---------------------------------------------------------------------------
// Integration with parent agent
// ---------------------------------------------------------------------------

describe('integration with parent agent', () => {
  it('works as a tool inside a harness', async () => {
    // Provider handles both parent and child turns
    const provider = mockProvider([
      // Parent turn 1: calls spawn
      {
        text: 'Let me delegate this',
        toolCalls: [{ id: 'tc1', name: 'spawn', input: { task: 'calculate 6 * 7' } }],
      },
      // Child turn 1: responds
      { text: 'sub-agent result: 42', done: true },
      // Parent turn 2: final response
      { text: 'The answer is 42', done: true },
    ])

    const spawnTool = createSpawnTool()

    const harness = defineHarness({
      name: 'orchestrator',
      tools: { spawn: spawnTool },
    })

    const agent = createAgent({ harness, provider })
    const stats = await agent.run({ prompt: 'what is 6 * 7?' })

    expect(stats.turns).toBe(2)
    expect(spawnTool.totalChildStats.turns).toBeGreaterThanOrEqual(1)
  })

  it('multiple spawns in sequence work correctly', async () => {
    const provider = mockProvider([
      {
        text: 'Delegating task A',
        toolCalls: [{ id: 'tc1', name: 'spawn', input: { task: 'task A' } }],
      },
      { text: 'result A', done: true },
      {
        text: 'Delegating task B',
        toolCalls: [{ id: 'tc2', name: 'spawn', input: { task: 'task B' } }],
      },
      { text: 'result B', done: true },
      { text: 'Both done', done: true },
    ])

    const spawnTool = createSpawnTool()

    const harness = defineHarness({
      name: 'orchestrator',
      tools: { spawn: spawnTool },
    })

    const agent = createAgent({ harness, provider })
    const stats = await agent.run({ prompt: 'do A and B' })

    expect(stats.turns).toBe(3)
    expect(spawnTool.totalChildStats.turns).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Child stats reported to parent
// ---------------------------------------------------------------------------

describe('child stats reporting', () => {
  it('parent stats include children automatically via ToolContext', async () => {
    const provider = mockProvider([
      {
        text: 'delegating',
        toolCalls: [{ id: 'tc1', name: 'spawn', input: { task: 'child task' } }],
      },
      { text: 'sub result', done: true },
      { text: 'done', done: true },
    ])

    const spawnTool = createSpawnTool()

    const harness = defineHarness({
      name: 'with-spawn',
      tools: { spawn: spawnTool },
    })

    const agent = createAgent({ harness, provider })
    const stats = await agent.run({ prompt: 'delegate' })

    expect(stats.children).toBeDefined()
    expect(stats.children).toHaveLength(1)
    expect(stats.children![0].id).toBe('child-1')
    expect(stats.children![0].task).toBe('child task')
    expect(stats.children![0].stats.turns).toBeGreaterThanOrEqual(1)
  })

  it('parent stats have no children field when no spawns occur', async () => {
    const provider = mockProvider([{ text: 'no spawning', done: true }])
    const agent = createAgent({ harness: basic, provider })
    const stats = await agent.run({ prompt: 'hello' })

    expect(stats.children).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Abort propagation
// ---------------------------------------------------------------------------

describe('abort propagation', () => {
  it('aborts child agents when ToolContext signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const provider = mockProvider([
      { text: 'should not reach here', done: true },
    ])
    const tool = createSpawnTool()

    const result = await tool.execute(
      { task: 'long running task' },
      mockToolCtx({ signal: controller.signal, provider }),
    )

    expect(result).toContain('child-1')
    expect(result).toContain('Completed')
    expect(result).toContain('0 turns')
  })

  it('inherits signal from ToolContext automatically', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool()

    const result = await tool.execute({ task: 'test' }, mockToolCtx({ provider }))
    expect(result).toContain('Completed')
  })

  it('pre-aborted ToolContext signal propagates to child', async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool()

    const result = await tool.execute(
      { task: 'too late' },
      mockToolCtx({ signal: controller.signal, provider }),
    )

    expect(result).toContain('child-1')
  })
})

// ---------------------------------------------------------------------------
// totalChildStats immutability
// ---------------------------------------------------------------------------

describe('totalChildStats immutability', () => {
  it('returns a copy — mutations do not affect internal state', async () => {
    const provider = mockProvider([
      { text: 'done', done: true },
      { text: 'done', done: true },
    ])
    const tool = createSpawnTool()
    const ctx = mockToolCtx({ provider })

    await tool.execute({ task: 'task 1' }, ctx)

    const stats1 = tool.totalChildStats as AgentStats
    stats1.turns = 9999

    await tool.execute({ task: 'task 2' }, ctx)
    expect(tool.totalChildStats.turns).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// Multi-turn child (child uses tools)
// ---------------------------------------------------------------------------

describe('multi-turn child', () => {
  it('child can use tools and return multi-turn result', async () => {
    const provider = mockProvider([
      {
        text: 'Let me check',
        toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo 42' } }],
      },
      { text: 'The answer is 42.', done: true },
    ])

    const tool = createSpawnTool()
    const result = await tool.execute({ task: 'what is the answer?' }, mockToolCtx({ provider }))

    expect(result).toContain('Completed in 2 turns')
    expect(tool.totalChildStats.turns).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Harness override
// ---------------------------------------------------------------------------

describe('harness override', () => {
  it('uses custom harness for children when specified', async () => {
    const customHarness = defineHarness({
      name: 'minimal',
      tools: {},
    })

    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({ harness: customHarness })

    const result = await tool.execute({ task: 'test' }, mockToolCtx({ provider }))
    expect(result).toContain('Completed')
  })

  it('defaults to parent harness from ToolContext', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool()

    const result = await tool.execute({ task: 'test' }, mockToolCtx({ provider }))
    expect(result).toContain('Completed')
  })
})
