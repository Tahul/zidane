/**
 * Agent creation and state management.
 */

import type { Hookable } from 'hookable'

import type { ExecutionContext, ExecutionHandle } from './contexts'
import type { HarnessConfig } from './harnesses'
import type { Message, Provider, StreamOptions, ToolSpec } from './providers'
import type { AgentRunOptions, AgentStats, ChildRunStats, ToolExecutionMode } from './types'
import { createHooks } from 'hookable'
import { createProcessContext } from './contexts'
import { runLoop } from './loop'

// ---------------------------------------------------------------------------
// Hook definitions
// ---------------------------------------------------------------------------

export interface AgentHooks {
  'system:before': (ctx: { system: string }) => void
  'turn:before': (ctx: { turn: number, options: StreamOptions }) => void
  'turn:after': (ctx: { turn: number, usage: { input: number, output: number } }) => void
  'stream:text': (ctx: { delta: string, text: string }) => void
  'stream:end': (ctx: { text: string }) => void
  'tool:before': (ctx: { name: string, input: Record<string, unknown> }) => void
  'tool:after': (ctx: { name: string, input: Record<string, unknown>, result: string }) => void
  'tool:error': (ctx: { name: string, input: Record<string, unknown>, error: Error }) => void
  'tool:gate': (ctx: { name: string, input: Record<string, unknown>, block: boolean, reason: string }) => void
  'tool:transform': (ctx: { name: string, input: Record<string, unknown>, result: string, isError: boolean }) => void
  'context:transform': (ctx: { messages: Message[] }) => void
  'steer:inject': (ctx: { message: string }) => void
  'spawn:complete': (ctx: ChildRunStats) => void
  'agent:abort': (ctx: object) => void
  'agent:done': (ctx: AgentStats) => void
}

// ---------------------------------------------------------------------------
// Agent interface
// ---------------------------------------------------------------------------

export interface AgentOptions {
  harness: HarnessConfig
  provider: Provider
  /** Tool execution mode: 'sequential' (default) or 'parallel' */
  toolExecution?: ToolExecutionMode
  /** Execution context: where tools run. Defaults to in-process. */
  execution?: ExecutionContext
}

export interface Agent {
  hooks: Hookable<AgentHooks>
  run: (options: AgentRunOptions) => Promise<AgentStats>
  abort: () => void
  steer: (message: string) => void
  followUp: (message: string) => void
  waitForIdle: () => Promise<void>
  reset: () => void
  /** Destroy the execution context and clean up resources */
  destroy: () => Promise<void>
  readonly isRunning: boolean
  readonly messages: Message[]
  readonly execution: ExecutionContext
  readonly handle: ExecutionHandle | null
  meta: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// createAgent
// ---------------------------------------------------------------------------

export function createAgent({ harness, provider, toolExecution = 'sequential', execution }: AgentOptions): Agent {
  const hooks = createHooks<AgentHooks>()
  const executionContext = execution ?? createProcessContext()

  let abortController: AbortController | undefined
  let running = false
  let idleResolve: (() => void) | undefined
  let idlePromise: Promise<void> | undefined
  let executionHandle: ExecutionHandle | null = null
  const steeringQueue: string[] = []
  const followUpQueue: string[] = []
  let conversationMessages: Message[] = []

  async function run(options: AgentRunOptions): Promise<AgentStats> {
    if (running) {
      throw new Error('Agent is already running. Use steer() or followUp() to queue messages, or waitForIdle().')
    }

    running = true
    abortController = new AbortController()
    idlePromise = new Promise<void>((resolve) => {
      idleResolve = resolve
    })

    // Collect child agent stats reported via spawn:complete hook
    const childrenStats: ChildRunStats[] = []
    const unregisterSpawnHook = hooks.hook('spawn:complete', (ctx) => {
      childrenStats.push(ctx)
    })

    // Spawn execution context
    if (!executionHandle) {
      executionHandle = await executionContext.spawn()
    }

    const thinking = options.thinking ?? 'off'
    const model = options.model ?? provider.meta.defaultModel

    // System prompt: run-time option > harness default > fallback
    const system = options.system || harness.system || 'You are a helpful assistant.'

    const tools = harness.tools
    const toolSpecs: ToolSpec[] = Object.values(tools).map(
      t => ({
        name: t.spec.name,
        description: t.spec.description || '',
        input_schema: t.spec.input_schema as Record<string, unknown>,
      }),
    )
    const formattedTools = provider.formatTools(toolSpecs)

    // Build initial messages
    const messages: Message[] = []

    if (options.system) {
      await hooks.callHook('system:before', { system: options.system })
      messages.push(provider.userMessage(options.system))
      messages.push(provider.assistantMessage('Understood. I will proceed with these instructions above the rest of my system prompt.'))
    }

    messages.push(provider.userMessage(options.prompt, options.images))
    conversationMessages = messages

    try {
      const stats = await runLoop({
        provider,
        hooks,
        tools,
        toolSpecs,
        formattedTools,
        model,
        system,
        thinking,
        toolExecution,
        signal: abortController.signal,
        steeringQueue,
        followUpQueue,
        messages,
      })

      const finalStats: AgentStats = {
        ...stats,
        children: childrenStats.length > 0 ? childrenStats : undefined,
      }
      await hooks.callHook('agent:done', finalStats)
      return finalStats
    }
    catch (err: any) {
      // If aborted, provider may throw — return gracefully
      if (abortController.signal.aborted) {
        const stats: AgentStats = { totalIn: 0, totalOut: 0, turns: 0, elapsed: 0 }
        await hooks.callHook('agent:done', stats)
        return stats
      }
      throw err
    }
    finally {
      unregisterSpawnHook()
      running = false
      abortController = undefined
      steeringQueue.length = 0
      followUpQueue.length = 0
      idleResolve?.()
      idlePromise = undefined
      idleResolve = undefined
    }
  }

  function abort() {
    abortController?.abort()
  }

  function steer(message: string) {
    steeringQueue.push(message)
  }

  function followUpFn(message: string) {
    followUpQueue.push(message)
  }

  function waitForIdle(): Promise<void> {
    return idlePromise ?? Promise.resolve()
  }

  function reset() {
    conversationMessages = []
    steeringQueue.length = 0
    followUpQueue.length = 0
  }

  async function destroy() {
    if (executionHandle) {
      await executionContext.destroy(executionHandle)
      executionHandle = null
    }
  }

  return {
    hooks,
    run,
    abort,
    steer,
    followUp: followUpFn,
    waitForIdle,
    reset,
    destroy,
    get isRunning() { return running },
    get messages() { return conversationMessages },
    get execution() { return executionContext },
    get handle() { return executionHandle },
    meta: provider.meta,
  }
}
