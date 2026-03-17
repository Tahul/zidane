import type { Hookable } from 'hookable'
import type { Harness } from './harnesses'
import type { Provider, StreamOptions, ToolSpec } from './providers'
import { createHooks } from 'hookable'
import { harnesses } from './harnesses'

const MAX_TURNS = 50

export interface AgentOptions {
  harness: Harness
  provider: Provider
}

export interface AgentHooks {
  'system:before': (ctx: { system: string }) => void
  'turn:before': (ctx: { turn: number, options: StreamOptions }) => void
  'turn:after': (ctx: { turn: number, usage: { input: number, output: number } }) => void
  'stream:text': (ctx: { delta: string, text: string }) => void
  'stream:end': (ctx: { text: string }) => void
  'tool:before': (ctx: { name: string, input: Record<string, unknown> }) => void
  'tool:after': (ctx: { name: string, input: Record<string, unknown>, result: string }) => void
  'tool:error': (ctx: { name: string, input: Record<string, unknown>, error: Error }) => void
  'agent:done': (ctx: { totalIn: number, totalOut: number, turns: number }) => void
}

export interface AgentRunOptions {
  model?: string
  prompt: string
  system?: string
}

export interface Agent {
  hooks: Hookable<AgentHooks>
  run: (options: AgentRunOptions) => Promise<{ totalIn: number, totalOut: number, turns: number }>
  meta: Record<string, unknown>
}

export function createAgent({ harness, provider }: AgentOptions) {
  const hooks = createHooks<AgentHooks>()

  async function run({ model, prompt, system }: AgentRunOptions) {
    const toolSpecs: ToolSpec[] = Object.values(harnesses[harness]).map(
      t => ({
        name: t.spec.name,
        description: t.spec.description || '',
        input_schema: t.spec.input_schema as Record<string, unknown>,
      }),
    )
    const formattedTools = provider.formatTools(toolSpecs)

    const messages = [] as ReturnType<Provider['userMessage']>[]

    if (system) {
      await hooks.callHook('system:before', { system })
      messages.push(provider.userMessage(system))
      messages.push(provider.assistantMessage('Understood. I will proceed with these instructions above the rest of my system prompt.'))
    }

    messages.push(provider.userMessage(prompt))

    let totalIn = 0
    let totalOut = 0

    async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
      const toolDef = harnesses[harness][name]

      if (!toolDef) {
        const err = new Error(`Unknown tool: ${name}`)
        await hooks.callHook('tool:error', { name, input, error: err })
        return `Tool error: ${err.message}`
      }

      try {
        return await toolDef.execute(input)
      }
      catch (err: any) {
        await hooks.callHook('tool:error', { name, input, error: err })
        return `Tool error: ${err.message}`
      }
    }

    async function executeTurn(turn: number): Promise<boolean> {
      const streamOptions: StreamOptions = {
        model: model || 'claude-opus-4-6',
        system: system || 'You are a helpful assistant.',
        tools: formattedTools,
        messages,
        maxTokens: 16384,
      }

      await hooks.callHook('turn:before', { turn, options: streamOptions })

      let currentText = ''

      const result = await provider.stream(
        streamOptions,
        {
          onText(delta) {
            currentText += delta
            hooks.callHook('stream:text', { delta, text: currentText })
          },
        },
      )

      if (currentText) {
        await hooks.callHook('stream:end', { text: currentText })
      }

      totalIn += result.usage.input
      totalOut += result.usage.output

      await hooks.callHook('turn:after', { turn, usage: result.usage })

      if (result.done) {
        const stats = { totalIn, totalOut, turns: turn + 1 }
        await hooks.callHook('agent:done', stats)
        return true
      }

      messages.push({ role: 'assistant', content: result.assistantMessage })

      const toolResults = []
      for (const call of result.toolCalls) {
        await hooks.callHook('tool:before', { name: call.name, input: call.input })
        const output = await executeTool(call.name, call.input)
        await hooks.callHook('tool:after', { name: call.name, input: call.input, result: output })
        toolResults.push({ id: call.id, content: output })
      }

      messages.push(provider.toolResultsMessage(toolResults))
      return false
    }

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const ended = await executeTurn(turn)
      if (ended)
        return { totalIn, totalOut, turns: turn + 1 }
    }

    const stats = { totalIn, totalOut, turns: MAX_TURNS }
    await hooks.callHook('agent:done', stats)
    return stats
  }

  return { hooks, run, meta: provider.meta }
}
