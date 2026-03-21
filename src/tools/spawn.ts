/**
 * Spawn tool — create sub-agents from a parent agent.
 *
 * A static tool that reads provider and harness from ToolContext.
 * Just add it to any harness's tools — no factory needed.
 *
 * Usage:
 *   import { spawn } from 'zidane'
 *
 *   const harness = defineHarness({
 *     name: 'orchestrator',
 *     tools: { ...basicTools, spawn },
 *   })
 */

import type { HarnessConfig, ToolContext, ToolDef } from '../harnesses'
import type { AgentStats } from '../types'
import { createAgent } from '../agent'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChildAgent {
  id: string
  task: string
  startedAt: number
}

export interface SpawnToolState {
  /** Currently running children */
  readonly children: ReadonlyMap<string, ChildAgent>
  /** Aggregated stats from all completed children (returns a copy) */
  readonly totalChildStats: Readonly<AgentStats>
}

// ---------------------------------------------------------------------------
// State (module-scoped per spawn tool instance)
// ---------------------------------------------------------------------------

const children = new Map<string, ChildAgent>()
let childCounter = 0
let activeCount = 0
const MAX_CONCURRENT = 3

const _totalChildStats: AgentStats = {
  totalIn: 0,
  totalOut: 0,
  turns: 0,
  elapsed: 0,
}

// ---------------------------------------------------------------------------
// spawn tool
// ---------------------------------------------------------------------------

/**
 * Static spawn tool — add directly to any harness.
 *
 * Reads provider and harness from ToolContext at execution time.
 * Children get the same harness as the parent (including spawn),
 * so sub-agents can spawn their own children.
 */
export const spawn: ToolDef & SpawnToolState = {
  get children() { return children },
  get totalChildStats() { return { ..._totalChildStats } },

  spec: {
    name: 'spawn',
    description: 'Spawn a sub-agent to work on a specific task. The sub-agent runs independently with its own tool access and returns its final response. Use this to delegate work, parallelize tasks, or isolate concerns.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'The task prompt for the sub-agent. Be specific about what you want it to accomplish.',
        },
        system: {
          type: 'string',
          description: 'Optional system prompt override for this specific sub-agent.',
        },
      },
      required: ['task'],
    },
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const task = input.task as string
    const systemOverride = input.system as string | undefined

    if (activeCount >= MAX_CONCURRENT) {
      return `Cannot spawn: ${activeCount}/${MAX_CONCURRENT} sub-agents already running. Wait for one to complete.`
    }

    const id = `child-${++childCounter}`
    const child: ChildAgent = { id, task, startedAt: Date.now() }

    const agent = createAgent({
      harness: ctx.harness,
      provider: ctx.provider,
      execution: ctx.execution,
    })

    children.set(id, child)
    activeCount++

    try {
      const stats = await agent.run({
        prompt: task,
        system: systemOverride,
        signal: ctx.signal,
      })

      _totalChildStats.totalIn += stats.totalIn
      _totalChildStats.totalOut += stats.totalOut
      _totalChildStats.turns += stats.turns
      _totalChildStats.elapsed += stats.elapsed

      // Report to parent agent for automatic stats collection
      await ctx.hooks.callHook('spawn:complete', {
        id,
        task,
        stats,
      })

      const response = extractText(agent.messages.at(-1))

      return [
        `[sub-agent ${id}] Completed in ${stats.turns} turns (${stats.elapsed}ms)`,
        `Tokens: ${stats.totalIn} in / ${stats.totalOut} out`,
        '',
        response || '(no text response)',
      ].join('\n')
    }
    catch (err: any) {
      return `[sub-agent ${id}] Error: ${err.message}`
    }
    finally {
      activeCount--
      await agent.destroy()
      children.delete(id)
    }
  },
}

// ---------------------------------------------------------------------------
// createSpawnTool (configurable factory)
// ---------------------------------------------------------------------------

export interface SpawnToolOptions {
  /** Maximum concurrent sub-agents (default: 3) */
  maxConcurrent?: number
  /** Model override for child agents */
  model?: string
  /** System prompt for child agents */
  system?: string
  /** Thinking level for child agents */
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high'
  /** Override harness for children (defaults to parent's harness from ToolContext) */
  harness?: HarnessConfig
  /** Called when a child agent starts */
  onSpawn?: (child: ChildAgent) => void
  /** Called when a child agent completes */
  onComplete?: (child: ChildAgent, stats: AgentStats) => void
}

/**
 * Create a configured spawn tool with custom options.
 *
 * For most cases, use the static `spawn` export directly.
 * Use this factory when you need custom concurrency limits,
 * model overrides, or lifecycle callbacks.
 */
export function createSpawnTool(options: SpawnToolOptions = {}): ToolDef & SpawnToolState {
  const localChildren = new Map<string, ChildAgent>()
  let localCounter = 0
  let localActiveCount = 0
  const maxConcurrent = options.maxConcurrent ?? 3

  const localStats: AgentStats = {
    totalIn: 0,
    totalOut: 0,
    turns: 0,
    elapsed: 0,
  }

  return {
    get children() { return localChildren },
    get totalChildStats() { return { ...localStats } },

    spec: {
      name: 'spawn',
      description: 'Spawn a sub-agent to work on a specific task. The sub-agent runs independently with its own tool access and returns its final response. Use this to delegate work, parallelize tasks, or isolate concerns.',
      input_schema: {
        type: 'object' as const,
        properties: {
          task: {
            type: 'string',
            description: 'The task prompt for the sub-agent. Be specific about what you want it to accomplish.',
          },
          system: {
            type: 'string',
            description: 'Optional system prompt override for this specific sub-agent.',
          },
        },
        required: ['task'],
      },
    },

    async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
      const task = input.task as string
      const systemOverride = input.system as string | undefined

      if (localActiveCount >= maxConcurrent) {
        return `Cannot spawn: ${localActiveCount}/${maxConcurrent} sub-agents already running. Wait for one to complete.`
      }

      const id = `child-${++localCounter}`
      const child: ChildAgent = { id, task, startedAt: Date.now() }

      const agent = createAgent({
        harness: options.harness ?? ctx.harness,
        provider: ctx.provider,
        execution: ctx.execution,
      })

      localChildren.set(id, child)
      localActiveCount++
      options.onSpawn?.(child)

      try {
        const stats = await agent.run({
          prompt: task,
          model: options.model,
          system: systemOverride ?? options.system,
          thinking: options.thinking,
          signal: ctx.signal,
        })

        localStats.totalIn += stats.totalIn
        localStats.totalOut += stats.totalOut
        localStats.turns += stats.turns
        localStats.elapsed += stats.elapsed

        options.onComplete?.(child, stats)

        await ctx.hooks.callHook('spawn:complete', {
          id,
          task,
          stats,
        })

        const response = extractText(agent.messages.at(-1))

        return [
          `[sub-agent ${id}] Completed in ${stats.turns} turns (${stats.elapsed}ms)`,
          `Tokens: ${stats.totalIn} in / ${stats.totalOut} out`,
          '',
          response || '(no text response)',
        ].join('\n')
      }
      catch (err: any) {
        return `[sub-agent ${id}] Error: ${err.message}`
      }
      finally {
        localActiveCount--
        await agent.destroy()
        localChildren.delete(id)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(message: unknown): string {
  if (!message || typeof message !== 'object')
    return ''

  const msg = message as Record<string, unknown>

  if (typeof msg.content === 'string')
    return msg.content

  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block: Record<string, unknown>) => block.type === 'text')
      .map((block: Record<string, unknown>) => block.text)
      .join('\n')
  }

  return ''
}
