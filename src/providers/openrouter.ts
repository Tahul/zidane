/**
 * OpenRouter provider.
 *
 * Uses the OpenAI-compatible chat completions API via raw fetch.
 * Supports tool calling, streaming, and image content.
 *
 * Set OPENROUTER_API_KEY in your environment or .env file.
 */

import type { Message, Provider, StreamCallbacks, StreamOptions, ToolResult, ToolSpec, TurnResult } from '.'
import type { ImageContent } from '../types'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

function getApiKey(): string {
  if (process.env.OPENROUTER_API_KEY)
    return process.env.OPENROUTER_API_KEY

  throw new Error('No OpenRouter API key found. Set OPENROUTER_API_KEY in your environment.')
}

// ---------------------------------------------------------------------------
// OpenAI-compatible types
// ---------------------------------------------------------------------------

interface OAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: unknown
  tool_calls?: { id: string, type: 'function', function: { name: string, arguments: string } }[]
  tool_call_id?: string
}

interface OAITool {
  type: 'function'
  function: { name: string, description: string, parameters: Record<string, unknown> }
}

// Sentinel to identify our structured messages in the opaque `content: unknown`
const TOOL_RESULTS_TAG = '__zidane_tool_results__'
const ASSISTANT_TOOL_CALLS_TAG = '__zidane_assistant_tc__'

function convertImageContent(img: ImageContent) {
  return {
    type: 'image_url' as const,
    image_url: { url: `data:${img.source.media_type};base64,${img.source.data}` },
  }
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

async function consumeSSE(
  response: Response,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let finishReason = 'stop'
  let usage = { input: 0, output: 0 }
  const tcMap = new Map<number, { id: string, name: string, args: string }>()

  try {
    while (true) {
      if (signal?.aborted)
        break
      const { done, value } = await reader.read()
      if (done)
        break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: '))
          continue
        const data = line.slice(6).trim()
        if (data === '[DONE]')
          continue

        let chunk: any
        try {
          chunk = JSON.parse(data)
        }
        catch {
          continue
        }

        const choice = chunk.choices?.[0]
        if (!choice)
          continue
        if (choice.finish_reason)
          finishReason = choice.finish_reason

        if (choice.delta?.content) {
          text += choice.delta.content
          callbacks.onText(choice.delta.content)
        }

        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const existing = tcMap.get(tc.index)
            if (existing) {
              if (tc.function?.arguments)
                existing.args += tc.function.arguments
            }
            else {
              tcMap.set(tc.index, {
                id: tc.id || `call_${tc.index}`,
                name: tc.function?.name || '',
                args: tc.function?.arguments || '',
              })
            }
          }
        }

        if (chunk.usage)
          usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens }
      }
    }
  }
  finally {
    reader.releaseLock()
  }

  const toolCalls = Array.from(tcMap.values()).map(tc => ({
    id: tc.id,
    name: tc.name,
    input: tc.args ? JSON.parse(tc.args) as Record<string, unknown> : {},
  }))

  return { text, toolCalls, finishReason, usage }
}

// ---------------------------------------------------------------------------
// Convert our Message[] to OAI messages for the API
// ---------------------------------------------------------------------------

function toOAIMessages(system: string, messages: Message[]): OAIMessage[] {
  const out: OAIMessage[] = [{ role: 'system', content: system }]

  for (const msg of messages) {
    const c = msg.content as any

    // Tool results (tagged by toolResultsMessage)
    if (c?._tag === TOOL_RESULTS_TAG) {
      for (const tr of c.results as { tool_call_id: string, content: string }[]) {
        out.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content })
      }
      continue
    }

    // Assistant message that included tool calls (tagged by stream())
    if (c?._tag === ASSISTANT_TOOL_CALLS_TAG) {
      out.push({
        role: 'assistant',
        content: c.text || null,
        tool_calls: c.tool_calls,
      })
      continue
    }

    // Plain user/assistant message
    out.push({ role: msg.role, content: msg.content })
  }

  return out
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function openrouter(defaultModel?: string): Provider {
  const apiKey = getApiKey()
  const fallbackModel = defaultModel || 'anthropic/claude-sonnet-4'

  return {
    name: 'openrouter',
    meta: { defaultModel: fallbackModel },

    formatTools(tools: ToolSpec[]): OAITool[] {
      return tools.map(t => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }))
    },

    userMessage(content: string, images?: ImageContent[]): Message {
      if (images?.length) {
        return {
          role: 'user',
          content: [...images.map(convertImageContent), { type: 'text' as const, text: content }],
        }
      }
      return { role: 'user', content }
    },

    assistantMessage(content: string): Message {
      return { role: 'assistant', content }
    },

    toolResultsMessage(results: ToolResult[]): Message {
      return {
        role: 'user',
        content: {
          _tag: TOOL_RESULTS_TAG,
          results: results.map(r => ({ tool_call_id: r.id, content: r.content })),
        },
      }
    },

    async stream(options: StreamOptions, callbacks: StreamCallbacks): Promise<TurnResult> {
      const modelId = options.model || fallbackModel
      const messages = toOAIMessages(options.system, options.messages)

      const body: Record<string, unknown> = {
        model: modelId,
        messages,
        max_tokens: options.maxTokens,
        stream: true,
      }

      if (options.tools && (options.tools as unknown[]).length > 0)
        body.tools = options.tools

      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/Tahul/zidane',
          'X-Title': 'zidane',
        },
        body: JSON.stringify(body),
        signal: options.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenRouter API error: ${response.status} ${errorText}`)
      }

      const result = await consumeSSE(response, callbacks, options.signal)
      const done = result.finishReason === 'stop' || result.toolCalls.length === 0

      // Build assistant message for conversation history
      let assistantMessage: unknown = result.text
      if (result.toolCalls.length > 0) {
        assistantMessage = {
          _tag: ASSISTANT_TOOL_CALLS_TAG,
          text: result.text || null,
          tool_calls: result.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.input) },
          })),
        }
      }

      return {
        assistantMessage,
        text: result.text,
        toolCalls: result.toolCalls,
        done,
        usage: result.usage,
      }
    },
  }
}
