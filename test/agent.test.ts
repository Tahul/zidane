import { describe, expect, it } from 'bun:test'
import { createAgent } from '../src/agent'
import { createMockProvider } from './mock-provider'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basicAgent(turns: Parameters<typeof createMockProvider>[0], opts?: { toolExecution?: 'sequential' | 'parallel' }) {
  const provider = createMockProvider(turns)
  return createAgent({ harness: 'basic', provider, ...opts })
}

// ---------------------------------------------------------------------------
// Basic loop
// ---------------------------------------------------------------------------

describe('basic loop', () => {
  it('runs a single text-only turn', async () => {
    const agent = basicAgent([
      { text: 'Hello!', done: true },
    ])

    const stats = await agent.run({ prompt: 'hi' })

    expect(stats.turns).toBe(1)
    expect(stats.totalOut).toBeGreaterThan(0)
  })

  it('runs multiple turns with tool calls', async () => {
    const agent = basicAgent([
      { text: 'Let me check', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo hello' } }] },
      { text: 'Done!', done: true },
    ])

    const stats = await agent.run({ prompt: 'do something' })

    expect(stats.turns).toBe(2)
  })

  it('respects MAX_TURNS limit', async () => {
    // Create 60 turns — should stop at 50
    const turns = Array.from({ length: 60 }, (_, i) => ({
      text: `Turn ${i}`,
      toolCalls: [{ id: `tc${i}`, name: 'shell', input: { command: 'echo hi' } }],
    }))
    const agent = basicAgent(turns)

    const stats = await agent.run({ prompt: 'loop forever' })

    expect(stats.turns).toBe(50)
  })

  it('throws if run() called while already running', async () => {
    const agent = basicAgent([
      { text: 'slow', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'sleep 1' } }] },
      { text: 'done', done: true },
    ])

    const p1 = agent.run({ prompt: 'first' })

    await expect(agent.run({ prompt: 'second' })).rejects.toThrow('already running')

    await p1
  })
})

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

describe('hooks', () => {
  it('fires system:before when system prompt is provided', async () => {
    const agent = basicAgent([{ text: 'ok', done: true }])
    let systemText = ''

    agent.hooks.hook('system:before', (ctx) => {
      systemText = ctx.system
    })

    await agent.run({ prompt: 'hi', system: 'be nice' })

    expect(systemText).toBe('be nice')
  })

  it('fires turn:before and turn:after', async () => {
    const agent = basicAgent([{ text: 'hello', done: true }])
    const turnsBefore: number[] = []
    const turnsAfter: number[] = []

    agent.hooks.hook('turn:before', (ctx) => {
      turnsBefore.push(ctx.turn)
    })
    agent.hooks.hook('turn:after', (ctx) => {
      turnsAfter.push(ctx.turn)
    })

    await agent.run({ prompt: 'hi' })

    expect(turnsBefore).toEqual([0])
    expect(turnsAfter).toEqual([0])
  })

  it('fires stream:text with deltas and stream:end', async () => {
    const agent = basicAgent([{ text: 'Hi!', done: true }])
    const deltas: string[] = []
    let endText = ''

    agent.hooks.hook('stream:text', (ctx) => {
      deltas.push(ctx.delta)
    })
    agent.hooks.hook('stream:end', (ctx) => {
      endText = ctx.text
    })

    await agent.run({ prompt: 'hi' })

    expect(deltas).toEqual(['H', 'i', '!'])
    expect(endText).toBe('Hi!')
  })

  it('fires tool:before and tool:after', async () => {
    const agent = basicAgent([
      { text: 'running', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo test' } }] },
      { text: 'done', done: true },
    ])
    const toolNames: string[] = []
    const toolResults: string[] = []

    agent.hooks.hook('tool:before', (ctx) => {
      toolNames.push(ctx.name)
    })
    agent.hooks.hook('tool:after', (ctx) => {
      toolResults.push(ctx.result)
    })

    await agent.run({ prompt: 'do it' })

    expect(toolNames).toEqual(['shell'])
    expect(toolResults.length).toBe(1)
  })

  it('fires tool:error for unknown tools', async () => {
    const agent = basicAgent([
      { text: 'using', toolCalls: [{ id: 'tc1', name: 'nonexistent', input: {} }] },
      { text: 'done', done: true },
    ])
    const errors: string[] = []

    agent.hooks.hook('tool:error', (ctx) => {
      errors.push(ctx.error.message)
    })

    await agent.run({ prompt: 'do it' })

    expect(errors).toEqual(['Unknown tool: nonexistent'])
  })

  it('fires agent:done with stats', async () => {
    const agent = basicAgent([{ text: 'bye', done: true }])
    let stats: any = null

    agent.hooks.hook('agent:done', (ctx) => {
      stats = ctx
    })

    await agent.run({ prompt: 'hi' })

    expect(stats).not.toBeNull()
    expect(stats.totalIn).toBeGreaterThan(0)
    expect(stats.totalOut).toBeGreaterThan(0)
    expect(stats.turns).toBe(1)
    expect(stats.elapsed).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe('abort', () => {
  it('stops the loop when abort() is called', async () => {
    const agent = basicAgent([
      { text: 'step 1', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo 1' } }] },
      { text: 'step 2', toolCalls: [{ id: 'tc2', name: 'shell', input: { command: 'echo 2' } }] },
      { text: 'step 3', done: true },
    ])
    let aborted = false

    agent.hooks.hook('agent:abort', () => {
      aborted = true
    })
    agent.hooks.hook('turn:after', () => {
      agent.abort()
    })

    await agent.run({ prompt: 'go' })

    expect(aborted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

describe('steering', () => {
  it('injects steering message between tool calls', async () => {
    const agent = basicAgent([
      { text: 'working', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo a' } }] },
      { text: 'redirected', done: true },
    ])
    let injected = ''

    agent.hooks.hook('steer:inject', (ctx) => {
      injected = ctx.message
    })
    agent.hooks.hook('tool:after', () => {
      agent.steer('focus on tests only')
    })

    await agent.run({ prompt: 'do everything' })

    expect(injected).toBe('focus on tests only')
  })
})

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

describe('follow-up', () => {
  it('continues loop with follow-up messages after agent finishes', async () => {
    let turnCount = 0
    const agent = basicAgent([
      { text: 'first done', done: true },
      { text: 'follow-up done', done: true },
    ])

    agent.hooks.hook('turn:before', () => {
      turnCount++
    })

    // Queue a follow-up before running
    agent.followUp('now do this too')

    await agent.run({ prompt: 'start' })

    expect(turnCount).toBe(2) // original turn + follow-up turn
  })
})

// ---------------------------------------------------------------------------
// tool:gate
// ---------------------------------------------------------------------------

describe('tool:gate', () => {
  it('blocks tool execution when ctx.block is set', async () => {
    const agent = basicAgent([
      { text: 'running rm', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'rm -rf /' } }] },
      { text: 'ok', done: true },
    ])
    const toolResults: string[] = []

    agent.hooks.hook('tool:gate', (ctx) => {
      if (ctx.name === 'shell' && String(ctx.input.command).includes('rm -rf')) {
        ctx.block = true
        ctx.reason = 'dangerous command'
      }
    })
    agent.hooks.hook('tool:after', (ctx) => {
      toolResults.push(ctx.result)
    })

    await agent.run({ prompt: 'delete everything' })

    // tool:after should NOT fire for blocked tools
    expect(toolResults.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// tool:transform
// ---------------------------------------------------------------------------

describe('tool:transform', () => {
  it('modifies tool output via hook', async () => {
    const agent = basicAgent([
      { text: 'running', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo hello' } }] },
      { text: 'done', done: true },
    ])
    const finalResults: string[] = []

    agent.hooks.hook('tool:transform', (ctx) => {
      ctx.result = `[REDACTED] ${ctx.result.length} chars`
    })
    agent.hooks.hook('tool:after', (ctx) => {
      finalResults.push(ctx.result)
    })

    await agent.run({ prompt: 'go' })

    expect(finalResults[0]).toMatch(/\[REDACTED\]/)
  })
})

// ---------------------------------------------------------------------------
// context:transform
// ---------------------------------------------------------------------------

describe('context:transform', () => {
  it('allows modifying messages before LLM call', async () => {
    const agent = basicAgent([
      { text: 'first', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo 1' } }] },
      { text: 'second', done: true },
    ])
    let messageCountAtTransform = 0

    agent.hooks.hook('context:transform', (ctx) => {
      messageCountAtTransform = ctx.messages.length
    })

    await agent.run({ prompt: 'go' })

    expect(messageCountAtTransform).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Parallel tool execution
// ---------------------------------------------------------------------------

describe('parallel tool execution', () => {
  it('executes multiple tool calls concurrently', async () => {
    const agent = basicAgent([
      {
        text: 'running both',
        toolCalls: [
          { id: 'tc1', name: 'shell', input: { command: 'echo a' } },
          { id: 'tc2', name: 'shell', input: { command: 'echo b' } },
        ],
      },
      { text: 'done', done: true },
    ], { toolExecution: 'parallel' })

    const toolNames: string[] = []
    agent.hooks.hook('tool:before', (ctx) => {
      toolNames.push(ctx.name)
    })

    const stats = await agent.run({ prompt: 'go' })

    expect(toolNames).toEqual(['shell', 'shell'])
    expect(stats.turns).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Tool validation
// ---------------------------------------------------------------------------

describe('tool validation', () => {
  it('returns error for missing required fields', async () => {
    const agent = basicAgent([
      { text: 'reading', toolCalls: [{ id: 'tc1', name: 'read_file', input: {} }] }, // missing 'path'
      { text: 'done', done: true },
    ])

    const stats = await agent.run({ prompt: 'read a file' })

    // Should still complete — validation error is returned as tool result
    expect(stats.turns).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

describe('state management', () => {
  it('isRunning reflects current state', async () => {
    const agent = basicAgent([{ text: 'hi', done: true }])

    expect(agent.isRunning).toBe(false)

    let wasRunning = false
    agent.hooks.hook('turn:before', () => {
      wasRunning = agent.isRunning
    })

    await agent.run({ prompt: 'go' })

    expect(wasRunning).toBe(true)
    expect(agent.isRunning).toBe(false)
  })

  it('messages contains conversation history after run', async () => {
    const agent = basicAgent([{ text: 'hello', done: true }])

    await agent.run({ prompt: 'hi' })

    expect(agent.messages.length).toBeGreaterThan(0)
  })

  it('reset() clears state', async () => {
    const agent = basicAgent([{ text: 'hello', done: true }])

    await agent.run({ prompt: 'hi' })
    expect(agent.messages.length).toBeGreaterThan(0)

    agent.reset()
    expect(agent.messages.length).toBe(0)
  })

  it('waitForIdle() resolves after run completes', async () => {
    const agent = basicAgent([
      { text: 'working', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo hi' } }] },
      { text: 'done', done: true },
    ])

    const runPromise = agent.run({ prompt: 'go' })

    await agent.waitForIdle()
    await runPromise

    expect(agent.isRunning).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Thinking
// ---------------------------------------------------------------------------

describe('thinking', () => {
  it('passes thinking level through to provider via StreamOptions', async () => {
    const agent = basicAgent([{ text: 'thought about it', done: true }])
    let receivedThinking: string | undefined

    agent.hooks.hook('turn:before', (ctx) => {
      receivedThinking = (ctx.options as any).thinking
    })

    await agent.run({ prompt: 'think hard', thinking: 'high' })

    expect(receivedThinking).toBe('high')
  })
})
