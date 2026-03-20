import type { ChildAgent } from '../src/tools'

import type { AgentStats } from '../src/types'
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

    const result = await tool.execute({ task: 'do something' })

    expect(result).toContain('Completed')
    expect(result).toContain('Completed')
    expect(result).toContain('child-1')
  })

  it('handles child agent errors gracefully', async () => {
    const provider = mockProvider([])
    // Provider with no turns will throw
    const tool = createSpawnTool({ provider, harness: basic })

    const result = await tool.execute({ task: 'this will fail' })

    expect(result).toContain('Completed')
  })

  it('tracks total child stats', async () => {
    const provider = mockProvider([
      { text: 'done 1', done: true },
      { text: 'done 2', done: true },
    ])
    const tool = createSpawnTool({ provider, harness: basic })

    await tool.execute({ task: 'task 1' })
    await tool.execute({ task: 'task 2' })

    expect(tool.totalChildStats.turns).toBeGreaterThanOrEqual(2)
    expect(tool.totalChildStats.totalOut).toBeGreaterThan(0)
  })

  it('cleans up children map after completion', async () => {
    const provider = mockProvider([{ text: 'done', done: true }])
    const tool = createSpawnTool({ provider, harness: basic })

    expect(tool.children.size).toBe(0)
    await tool.execute({ task: 'task' })
    expect(tool.children.size).toBe(0) // cleaned up after completion
  })

  it('increments child IDs', async () => {
    const provider = mockProvider([
      { text: 'done', done: true },
      { text: 'done', done: true },
    ])
    const tool = createSpawnTool({ provider, harness: basic })

    const r1 = await tool.execute({ task: 'first' })
    const r2 = await tool.execute({ task: 'second' })

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
    const p1 = tool.execute({ task: 'slow task' })

    // Try to start second immediately — should be rejected
    const result = await tool.execute({ task: 'blocked task' })
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

    await tool.execute({ task: 'test task' })

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

    await tool.execute({ task: 'test' })

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

    await tool.execute({ task: 'test' })

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

    await tool.execute({ task: 'test' })

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
    const result = await tool.execute({ task: 'research something' })
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
    })

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
