/**
 * Spawn tool — create sub-agents from a parent agent.
 *
 * Usage:
 *   const spawnTool = createSpawnTool({ provider, harness })
 *   // Add to a harness's tools, or use in defineHarness()
 *
 * The LLM calls the tool with a task prompt. A child agent runs
 * the task to completion and returns its final response.
 */

import type { ExecutionContext } from '../contexts'
import type { HarnessConfig, ToolContext, ToolDef } from '../harnesses'
import type { Provider } from '../providers'
import type { AgentStats, ThinkingLevel } from '../types'
import { createAgent } from '../agent'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnToolOptions {
  /** Provider for child agents */
  provider: Provider
  /** Harness for child agents (tools they can use) */
  harness: HarnessConfig
  /** Execution context for children. If omitted, children inherit from ToolContext or create their own. */
  execution?: ExecutionContext
  /** Maximum concurrent sub-agents (default: 3) */
  maxConcurrent?: number
  /** Model override for child agents */
  model?: string
  /** System prompt for child agents */
  system?: string
  /** Thinking level for child agents */
  thinking?: ThinkingLevel
  /** Called when a child agent starts */
  onSpawn?: (child: ChildAgent) => void
  /** Called when a child agent completes */
  onComplete?: (child: ChildAgent, stats: AgentStats) => void
}

export interface ChildAgent {
  id: string
  task: string
  startedAt: number
}

export interface SpawnTool extends ToolDef {
  /** Currently running children */
  readonly children: ReadonlyMap<string, ChildAgent>
  /** Aggregated stats from all completed children (returns a copy) */
  readonly totalChildStats: Readonly<AgentStats>
}

// ---------------------------------------------------------------------------
// createSpawnTool
// ---------------------------------------------------------------------------

export function createSpawnTool(options: SpawnToolOptions): SpawnTool {
  const children = new Map<string, ChildAgent>()
  let childCounter = 0
  let activeCount = 0
  const maxConcurrent = options.maxConcurrent ?? 3

  const _totalChildStats: AgentStats = {
    totalIn: 0,
    totalOut: 0,
    turns: 0,
    elapsed: 0,
  }

  return {
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

    async execute(input: Record<string, unknown>, toolCtx: ToolContext): Promise<string> {
      const task = input.task as string
      const systemOverride = input.system as string | undefined

      if (activeCount >= maxConcurrent) {
        return `Cannot spawn: ${activeCount}/${maxConcurrent} sub-agents already running. Wait for one to complete.`
      }

      const id = `child-${++childCounter}`
      const child: ChildAgent = { id, task, startedAt: Date.now() }

      const agent = createAgent({
        harness: options.harness,
        provider: options.provider,
        execution: options.execution ?? toolCtx.execution,
      })

      children.set(id, child)
      activeCount++
      options.onSpawn?.(child)

      try {
        const stats = await agent.run({
          prompt: task,
          model: options.model,
          system: systemOverride ?? options.system,
          thinking: options.thinking,
          signal: toolCtx.signal,
        })

        _totalChildStats.totalIn += stats.totalIn
        _totalChildStats.totalOut += stats.totalOut
        _totalChildStats.turns += stats.turns
        _totalChildStats.elapsed += stats.elapsed

        options.onComplete?.(child, stats)

        // Report to parent agent for automatic stats collection
        await toolCtx.hooks.callHook('spawn:complete', {
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
