/**
 * Shared utilities for OpenAI-compatible providers (OpenRouter, Cerebras, etc.).
 *
 * Provides SSE stream parsing, message format conversion, and tool formatting.
 */

import type { Message, StreamCallbacks, ToolResult, ToolSpec } from '.'
import type { ImageContent } from '../types'

// ---------------------------------------------------------------------------
// OpenAI-compatible types
// ---------------------------------------------------------------------------

export interface OAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: unknown
  tool_calls?: { id: string, type: 'function', function: { name: string, arguments: string } }[]
  tool_call_id?: string
}

export interface OAITool {
  type: 'function'
  function: { name: string, description: string, parameters: Record<string, unknown> }
}

// Sentinel tags for structured messages in opaque `content: unknown`
export const TOOL_RESULTS_TAG = '__zidane_tool_results__'
export const ASSISTANT_TOOL_CALLS_TAG = '__zidane_assistant_tc__'

// ---------------------------------------------------------------------------
// Image conversion
// ---------------------------------------------------------------------------

export function convertImageContent(img: ImageContent) {
  return {
    type: 'image_url' as const,
    image_url: { url: `data:${img.source.media_type};base64,${img.source.data}` },
  }
}

// ---------------------------------------------------------------------------
// SSE stream parser
// ---------------------------------------------------------------------------

export async function consumeSSE(
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
// Message conversion
// ---------------------------------------------------------------------------

export function toOAIMessages(system: string, messages: Message[]): OAIMessage[] {
  const out: OAIMessage[] = [{ role: 'system', content: system }]

  for (const msg of messages) {
    const c = msg.content as any

    if (c?._tag === TOOL_RESULTS_TAG) {
      for (const tr of c.results as { tool_call_id: string, content: string }[]) {
        out.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content })
      }
      continue
    }

    if (c?._tag === ASSISTANT_TOOL_CALLS_TAG) {
      out.push({ role: 'assistant', content: c.text || null, tool_calls: c.tool_calls })
      continue
    }

    out.push({ role: msg.role, content: msg.content })
  }

  return out
}

// ---------------------------------------------------------------------------
// Shared message builders
// ---------------------------------------------------------------------------

export function formatTools(tools: ToolSpec[]): OAITool[] {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

export function userMessage(content: string, images?: ImageContent[]): Message {
  if (images?.length) {
    return {
      role: 'user',
      content: [...images.map(convertImageContent), { type: 'text' as const, text: content }],
    }
  }
  return { role: 'user', content }
}

export function assistantMessage(content: string): Message {
  return { role: 'assistant', content }
}

export function toolResultsMessage(results: ToolResult[]): Message {
  return {
    role: 'user',
    content: {
      _tag: TOOL_RESULTS_TAG,
      results: results.map(r => ({ tool_call_id: r.id, content: r.content })),
    },
  }
}

export function buildAssistantContent(text: string, toolCalls: { id: string, name: string, input: Record<string, unknown> }[]): unknown {
  if (toolCalls.length > 0) {
    return {
      _tag: ASSISTANT_TOOL_CALLS_TAG,
      text: text || null,
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.input) },
      })),
    }
  }
  return text
}
