/**
 * Agent turn execution loop.
 *
 * Handles streaming, tool execution (sequential/parallel),
 * steering injection, follow-up messages, and abort.
 */

import type { Hookable } from 'hookable'
import type { AgentHooks } from './agent'
import type { ExecutionContext, ExecutionHandle } from './contexts'
import type { ToolContext, ToolDef } from './harnesses'
import type { Provider, StreamOptions, ToolSpec } from './providers'
import type { AgentStats, ThinkingLevel, ToolExecutionMode } from './types'
import { validateToolArgs } from './tools/validation'

export interface LoopContext {
  provider: Provider
  hooks: Hookable<AgentHooks>
  tools: Record<string, ToolDef>
  toolSpecs: ToolSpec[]
  formattedTools: unknown[]
  model: string
  system: string
  thinking: ThinkingLevel
  toolExecution: ToolExecutionMode
  signal: AbortSignal
  execution: ExecutionContext
  handle: ExecutionHandle
  steeringQueue: string[]
  followUpQueue: string[]
  messages: ReturnType<Provider['userMessage']>[]
}

export async function runLoop(ctx: LoopContext): Promise<AgentStats> {
  let totalIn = 0
  let totalOut = 0
  const startTime = Date.now()
  const maxTurns = 50

  for (let turn = 0; turn < maxTurns; turn++) {
    if (ctx.signal.aborted) {
      await ctx.hooks.callHook('agent:abort', {})
      break
    }

    const result = await executeTurn(ctx, turn)

    totalIn += result.usage.input
    totalOut += result.usage.output

    // Check abort after turn completes
    if (ctx.signal.aborted) {
      await ctx.hooks.callHook('agent:abort', {})
      break
    }

    // Check steering queue after tool execution
    if (ctx.steeringQueue.length > 0) {
      const steerMsg = ctx.steeringQueue.shift()!
      await ctx.hooks.callHook('steer:inject', { message: steerMsg })
      ctx.messages.push(ctx.provider.userMessage(steerMsg))
      continue
    }

    if (result.ended) {
      // Check follow-up queue before finishing
      if (ctx.followUpQueue.length > 0) {
        const followUp = ctx.followUpQueue.shift()!
        await ctx.hooks.callHook('steer:inject', { message: followUp })
        ctx.messages.push(ctx.provider.userMessage(followUp))
        continue
      }

      return { totalIn, totalOut, turns: turn + 1, elapsed: Date.now() - startTime }
    }
  }

  const stats: AgentStats = { totalIn, totalOut, turns: maxTurns, elapsed: Date.now() - startTime }
  await ctx.hooks.callHook('agent:done', stats)
  return stats
}

// ---------------------------------------------------------------------------
// Single turn
// ---------------------------------------------------------------------------

interface TurnResult {
  ended: boolean
  usage: { input: number, output: number }
}

async function executeTurn(ctx: LoopContext, turn: number): Promise<TurnResult> {
  const streamOptions: StreamOptions = {
    model: ctx.model,
    system: ctx.system,
    tools: ctx.formattedTools,
    messages: ctx.messages,
    maxTokens: 16384,
    thinking: ctx.thinking,
    signal: ctx.signal,
  }

  // Context transform hook — lets consumers prune/modify messages before LLM call
  await ctx.hooks.callHook('context:transform', { messages: ctx.messages as any })

  await ctx.hooks.callHook('turn:before', { turn, options: streamOptions })

  let currentText = ''

  const result = await ctx.provider.stream(
    streamOptions,
    {
      onText(delta) {
        currentText += delta
        ctx.hooks.callHook('stream:text', { delta, text: currentText })
      },
    },
  )

  if (currentText) {
    await ctx.hooks.callHook('stream:end', { text: currentText })
  }

  await ctx.hooks.callHook('turn:after', { turn, usage: result.usage })

  if (result.done) {
    return { ended: true, usage: result.usage }
  }

  ctx.messages.push({ role: 'assistant', content: result.assistantMessage })

  // Execute tool calls
  const toolResults = ctx.toolExecution === 'parallel'
    ? await executeToolsParallel(ctx, result.toolCalls)
    : await executeToolsSequential(ctx, result.toolCalls)

  ctx.messages.push(ctx.provider.toolResultsMessage(toolResults))

  return { ended: false, usage: result.usage }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

interface ToolCallInput {
  id: string
  name: string
  input: Record<string, unknown>
}

interface ToolResultOutput {
  id: string
  content: string
}

async function executeSingleTool(
  ctx: LoopContext,
  call: ToolCallInput,
): Promise<{ result: ToolResultOutput, steered: boolean }> {
  const toolDef = ctx.tools[call.name]

  // Gate hook — mutate ctx.block to block execution
  const gateCtx = { name: call.name, input: call.input, block: false, reason: 'Tool execution was blocked' }
  await ctx.hooks.callHook('tool:gate', gateCtx)

  if (gateCtx.block) {
    return { result: { id: call.id, content: `Blocked: ${gateCtx.reason}` }, steered: false }
  }

  if (!toolDef) {
    const err = new Error(`Unknown tool: ${call.name}`)
    await ctx.hooks.callHook('tool:error', { name: call.name, input: call.input, error: err })
    return { result: { id: call.id, content: `Tool error: ${err.message}` }, steered: false }
  }

  // Validate arguments
  const validation = validateToolArgs(call.input, toolDef.spec.input_schema as Record<string, unknown>)
  if (!validation.valid) {
    return { result: { id: call.id, content: `Validation error: ${validation.error}` }, steered: false }
  }

  await ctx.hooks.callHook('tool:before', { name: call.name, input: call.input })

  let output: string
  let isError = false

  try {
    const toolCtx: ToolContext = {
      signal: ctx.signal,
      execution: ctx.execution,
      handle: ctx.handle,
      hooks: ctx.hooks,
    }
    output = await toolDef.execute(call.input, toolCtx)
  }
  catch (err: any) {
    await ctx.hooks.callHook('tool:error', { name: call.name, input: call.input, error: err })
    output = `Tool error: ${err.message}`
    isError = true
  }

  // Transform hook — mutate ctx.result / ctx.isError to modify output
  const transformCtx = { name: call.name, input: call.input, result: output, isError }
  await ctx.hooks.callHook('tool:transform', transformCtx)
  output = transformCtx.result
  isError = transformCtx.isError

  await ctx.hooks.callHook('tool:after', { name: call.name, input: call.input, result: output })

  return { result: { id: call.id, content: output }, steered: false }
}

async function executeToolsSequential(
  ctx: LoopContext,
  toolCalls: ToolCallInput[],
): Promise<ToolResultOutput[]> {
  const results: ToolResultOutput[] = []

  for (const call of toolCalls) {
    if (ctx.signal.aborted)
      break

    // Check steering queue between tool calls
    if (ctx.steeringQueue.length > 0) {
      const steerMsg = ctx.steeringQueue.shift()!
      await ctx.hooks.callHook('steer:inject', { message: steerMsg })

      // Add error results for skipped tool calls
      for (const skipped of toolCalls.slice(toolCalls.indexOf(call))) {
        results.push({ id: skipped.id, content: 'Skipped: steering message received' })
      }

      // Inject steering message
      ctx.messages.push(ctx.provider.toolResultsMessage(results))
      ctx.messages.push(ctx.provider.userMessage(steerMsg))
      return []
    }

    const { result } = await executeSingleTool(ctx, call)
    results.push(result)
  }

  return results
}

async function executeToolsParallel(
  ctx: LoopContext,
  toolCalls: ToolCallInput[],
): Promise<ToolResultOutput[]> {
  const executions = toolCalls.map(call => executeSingleTool(ctx, call))
  const settled = await Promise.all(executions)
  return settled.map(s => s.result)
}
