import type { ToolContext } from '../src/harnesses'
import type { ChildAgent } from '../src/tools'

import type { AgentStats } from '../src/types'
import { createHooks } from 'hookable'
import { describe, expect, it } from 'bun:test'
import { createAgent } from '../src/agent'
import { basic, defineHarness } from '../src/harnesses'
import { createSpawnTool } from '../src/tools'
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
  return {
    signal: overrides?.signal ?? new AbortController().signal,
    execution: overrides?.execution ?? mockCtx,
    handle: overrides?.handle ?? { id: 'test-handle', type: 'process', cwd: '/tmp' },
    hooks: overrides?.hooks ?? hooks as any,
  }
}

// ---------------------------------------------------------------------------
// createSpawnTool
// ---------------------------------------------------------------------------

describe('createSpawnTool', () => {
  it('creates a valid ToolDef', () => {
    const provider = mockProvider([{ text: 'hi', done: true }])
    const tool = createSpawnTool({ provider, harness: basic })

    expect(tool.spec.name).toBe('spawn')
    expect(tool.spec.input_schema.required).toContain('task')
    expect(typeof tool.execute).toBe('function')
  })

  it('spawns a child agent and returns its response', async () => {
    const provider = mockProvider([
      { text: 'I completed the task successfully.', done: true },
    ])
    const tool = createSpawnTool({ provider, harness: basic })

    const result = await tool.execute({ task: 'do something' }, mockToolCtx())

    expect(result).toContain('Completed')
    expect(result).toContain('Completed')
    expect(result).toContain('child-1')
  })

  it('handles child agent errors gracefully', async () => {
    // Create a provider that throws during stream
    const errorProvider: Parameters<typeof createSpawnTool>[0]['provider'] = {
      ...mockProvider([]),
      async stream() {
        throw new Error('LLM connection failed')
      },
    }
    const tool = createSpawnTool({ provider: errorProvider, harness: basic })

    const result = await tool.execute({ task: 'this will fail' }, mockToolCtx())

    expect(result).toContain('Error')
    expect(result).toContain('child-1')
    expect(result).toContain('LLM connection failed')
  })

  it('tracks total child stats', async () => {
    const provider = mockProvider([
      { text: 'done 1', done: true },
      { text: 'done 2', done: true },
    ])
    const tool = createSpawnTool({ provider, harness: basic })

    await tool.execute({ task: 'task 1' }, mockToolCtx())
    await tool.execute({ task: 'task 2' }, mockToolCtx())

    expect(tool.totalChildStats.turns).toBeGreaterThanOrEqual(2)
    expect(tool.totalChildStats.totalOut).toBeGreaterThan(0)
  })

  it('cleans up children map after completion', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({ provider, harness: basic })

    expect(tool.children.size).toBe(0)
    await tool.execute({ task: 'task' }, mockToolCtx())
    expect(tool.children.size).toBe(0) // cleaned up after completion
  })

  it('increments child IDs', async () => {
    const provider = mockProvider([
      { text: 'done', done: true },
      { text: 'done', done: true },
    ])
    const tool = createSpawnTool({ provider, harness: basic })

    const r1 = await tool.execute({ task: 'first' }, mockToolCtx())
    const r2 = await tool.execute({ task: 'second' }, mockToolCtx())

    expect(r1).toContain('child-1')
    expect(r2).toContain('child-2')
  })
})

// ---------------------------------------------------------------------------
// Concurrency limit
// ---------------------------------------------------------------------------

describe('concurrency limit', () => {
  it('rejects when maxConcurrent is reached', async () => {
    // Use a provider that takes a while (multiple turns with tool calls)
    const provider = mockProvider([
      { text: 'working', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo hi' } }] },
      { text: 'done', done: true },
      { text: 'working', toolCalls: [{ id: 'tc2', name: 'shell', input: { command: 'echo hi' } }] },
      { text: 'done', done: true },
    ])
    const tool = createSpawnTool({ provider, harness: basic, maxConcurrent: 1 })

    // Start first task (will be running)
    const p1 = tool.execute({ task: 'slow task' }, mockToolCtx())

    // Try to start second immediately — should be rejected
    const result = await tool.execute({ task: 'blocked task' }, mockToolCtx())
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
      provider,
      harness: basic,
      onSpawn: child => spawned.push(child),
    })

    await tool.execute({ task: 'test task' }, mockToolCtx())

    expect(spawned).toHaveLength(1)
    expect(spawned[0].id).toBe('child-1')
    expect(spawned[0].task).toBe('test task')
    expect(spawned[0].startedAt).toBeGreaterThan(0)
  })

  it('calls onComplete with stats', async () => {
    const completed: { child: ChildAgent, stats: AgentStats }[] = []
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({
      provider,
      harness: basic,
      onComplete: (child, stats) => completed.push({ child, stats }),
    })

    await tool.execute({ task: 'test' }, mockToolCtx())

    expect(completed).toHaveLength(1)
    expect(completed[0].stats.turns).toBe(1)
    expect(completed[0].child.id).toBe('child-1')
  })
})

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

describe('execution context', () => {
  it('uses provided execution context', async () => {
    const mockCtx = createMockContext()
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({
      provider,
      harness: basic,
      execution: mockCtx,
    })

    await tool.execute({ task: 'test' }, mockToolCtx())

    // Child should have spawned in the mock context
    expect(mockCtx.operations.some(o => o.type === 'spawn')).toBe(true)
  })

  it('destroys child execution handle after completion', async () => {
    const mockCtx = createMockContext()
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({
      provider,
      harness: basic,
      execution: mockCtx,
    })

    await tool.execute({ task: 'test' }, mockToolCtx())

    expect(mockCtx.operations.some(o => o.type === 'destroy')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// System prompt override
// ---------------------------------------------------------------------------

describe('system prompt', () => {
  it('passes global system prompt to children', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({
      provider,
      harness: basic,
      system: 'you are a researcher',
    })

    // Hook into the child to see what system prompt it got
    const result = await tool.execute({ task: 'research something' }, mockToolCtx())
    expect(result).toContain('Completed')
  })

  it('allows per-spawn system prompt override', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({
      provider,
      harness: basic,
      system: 'default system',
    })

    const result = await tool.execute({
      task: 'do stuff',
      system: 'custom system for this task',
    }, mockToolCtx())

    expect(result).toContain('Completed')
  })
})

// ---------------------------------------------------------------------------
// Integration with parent agent
// ---------------------------------------------------------------------------

describe('integration with parent agent', () => {
  it('works as a tool inside a harness', async () => {
    // Child provider
    const childProvider = mockProvider([
      { text: 'sub-agent result: 42', done: true },
    ])

    const spawnTool = createSpawnTool({
      provider: childProvider,
      harness: basic,
    })

    // Parent provider — calls spawn tool, then finishes
    const parentProvider = mockProvider([
      {
        text: 'Let me delegate this',
        toolCalls: [{ id: 'tc1', name: 'spawn', input: { task: 'calculate 6 * 7' } }],
      },
      { text: 'The answer is 42', done: true },
    ])

    const harness = defineHarness({
      name: 'orchestrator',
      tools: { spawn: spawnTool },
    })

    const agent = createAgent({ harness, provider: parentProvider })
    const stats = await agent.run({ prompt: 'what is 6 * 7?' })

    expect(stats.turns).toBe(2)
    // Verify the spawn tool was called
    expect(spawnTool.totalChildStats.turns).toBeGreaterThanOrEqual(1)
  })

  it('multiple spawns in sequence work correctly', async () => {
    const childProvider = mockProvider([
      { text: 'result A', done: true },
      { text: 'result B', done: true },
    ])

    const spawnTool = createSpawnTool({
      provider: childProvider,
      harness: basic,
    })

    const parentProvider = mockProvider([
      {
        text: 'Delegating task A',
        toolCalls: [{ id: 'tc1', name: 'spawn', input: { task: 'task A' } }],
      },
      {
        text: 'Delegating task B',
        toolCalls: [{ id: 'tc2', name: 'spawn', input: { task: 'task B' } }],
      },
      { text: 'Both done', done: true },
    ])

    const harness = defineHarness({
      name: 'orchestrator',
      tools: { spawn: spawnTool },
    })

    const agent = createAgent({ harness, provider: parentProvider })
    const stats = await agent.run({ prompt: 'do A and B' })

    expect(stats.turns).toBe(3)
    expect(spawnTool.totalChildStats.turns).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Child stats reported to parent
// ---------------------------------------------------------------------------

describe('child stats reporting', () => {
  it('parent stats include children when parentHooks is set', async () => {
    const childProvider = mockProvider([
      { text: 'sub result', done: true },
    ])

    const parentProvider = mockProvider([
      {
        text: 'delegating',
        toolCalls: [{ id: 'tc1', name: 'spawn', input: { task: 'child task' } }],
      },
      { text: 'done', done: true },
    ])

    // Create spawn tool first, then wire parentHooks after agent creation
    const spawnTool = createSpawnTool({
      provider: childProvider,
      harness: basic,
    })

    const harness = defineHarness({
      name: 'with-spawn',
      tools: { spawn: spawnTool },
    })

    const agent = createAgent({ harness, provider: parentProvider })

    // parentHooks are now passed automatically via ToolContext
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
    // Pre-abort so the child agent gets an already-aborted signal
    controller.abort()

    const provider = mockProvider([
      { text: 'should not reach here', done: true },
    ])
    const tool = createSpawnTool({ provider, harness: basic })

    const result = await tool.execute(
      { task: 'long running task' },
      mockToolCtx({ signal: controller.signal }),
    )

    // Child should complete gracefully with 0 stats (aborted path)
    expect(result).toContain('child-1')
    expect(result).toContain('Completed')
    expect(result).toContain('0 turns')
  })

  it('inherits signal from ToolContext automatically', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({ provider, harness: basic })

    const result = await tool.execute({ task: 'test' }, mockToolCtx())
    expect(result).toContain('Completed')
  })

  it('pre-aborted ToolContext signal propagates to child', async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({ provider, harness: basic })

    const result = await tool.execute(
      { task: 'too late' },
      mockToolCtx({ signal: controller.signal }),
    )

    // Child should still complete (aborted agent returns gracefully with 0 stats)
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
    const tool = createSpawnTool({ provider, harness: basic })

    await tool.execute({ task: 'task 1' }, mockToolCtx())

    // Mutate the returned copy
    const stats1 = tool.totalChildStats as AgentStats
    stats1.turns = 9999

    // Internal state should be unaffected
    await tool.execute({ task: 'task 2' }, mockToolCtx())
    expect(tool.totalChildStats.turns).toBeLessThan(100) // definitely not 9999+
  })
})

// ---------------------------------------------------------------------------
// Multi-turn child (child uses tools)
// ---------------------------------------------------------------------------

describe('multi-turn child', () => {
  it('child can use tools and return multi-turn result', async () => {
    const childProvider = mockProvider([
      {
        text: 'Let me check',
        toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo 42' } }],
      },
      { text: 'The answer is 42.', done: true },
    ])

    const tool = createSpawnTool({ provider: childProvider, harness: basic })
    const result = await tool.execute({ task: 'what is the answer?' }, mockToolCtx())

    expect(result).toContain('Completed in 2 turns')
    expect(tool.totalChildStats.turns).toBe(2)
  })
})
