/**
 * Spawn tool — create sub-agents from a parent agent.
 *
 * Usage:
 *   const spawnTool = createSpawnTool({ provider, harness })
 *   // Add to a harness's tools, or use in defineHarness()
 *
 * The LLM calls the tool with a task prompt. A child agent runs
 * the task to completion and returns its final response.
 *
 * Features:
 *   - Abort propagation: parent abort signal cancels all children
 *   - Stats collection: child token usage is tracked
 *   - Execution inheritance: children can inherit or isolate execution
 *   - Concurrency limit: cap parallel sub-agents
 */

import type { Agent, AgentOptions } from '../agent'
import type { ExecutionContext } from '../contexts'
import type { HarnessConfig, ToolDef } from '../harnesses'
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
  /** How children get their execution context */
  execution?: 'inherit' | ExecutionContext
  /** Maximum concurrent sub-agents (default: 3) */
  maxConcurrent?: number
  /** Model override for child agents */
  model?: string
  /** System prompt override for child agents */
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
  agent: Agent
  startedAt: number
}

// ---------------------------------------------------------------------------
// createSpawnTool
// ---------------------------------------------------------------------------

export function createSpawnTool(options: SpawnToolOptions): ToolDef & { children: Map<string, ChildAgent>, totalChildStats: AgentStats } {
  const children = new Map<string, ChildAgent>()
  let childCounter = 0
  let activeCount = 0
  const maxConcurrent = options.maxConcurrent ?? 3

  const totalChildStats: AgentStats = {
    totalIn: 0,
    totalOut: 0,
    turns: 0,
    elapsed: 0,
  }

  function getChildExecution(parentAgent?: Agent): ExecutionContext | undefined {
    if (!options.execution || options.execution === 'inherit') {
      return parentAgent?.execution
    }
    return options.execution
  }

  const tool: ToolDef & { children: Map<string, ChildAgent>, totalChildStats: AgentStats } = {
    children,
    totalChildStats,

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

    async execute(input: Record<string, unknown>): Promise<string> {
      const task = input.task as string
      const systemOverride = input.system as string | undefined

      if (activeCount >= maxConcurrent) {
        return `Cannot spawn: ${activeCount}/${maxConcurrent} sub-agents already running. Wait for one to complete.`
      }

      const id = `child-${++childCounter}`

      const childOptions: AgentOptions = {
        harness: options.harness,
        provider: options.provider,
        execution: getChildExecution(),
      }

      const agent = createAgent(childOptions)
      const child: ChildAgent = { id, task, agent, startedAt: Date.now() }

      children.set(id, child)
      activeCount++
      options.onSpawn?.(child)

      try {
        const stats = await agent.run({
          prompt: task,
          model: options.model,
          system: systemOverride ?? options.system,
          thinking: options.thinking,
        })

        // Collect stats
        totalChildStats.totalIn += stats.totalIn
        totalChildStats.totalOut += stats.totalOut
        totalChildStats.turns += stats.turns
        totalChildStats.elapsed += stats.elapsed

        options.onComplete?.(child, stats)

        // Extract final text response
        const lastMessage = agent.messages.at(-1)
        const response = extractText(lastMessage)

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

  return tool
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
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('\n')
  }

  return ''
}
