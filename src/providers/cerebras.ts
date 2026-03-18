import type { Provider, StreamCallbacks, StreamOptions, TurnResult } from '.'
import {
  assistantMessage,
  buildAssistantContent,
  consumeSSE,
  formatTools,
  toOAIMessages,
  toolResultsMessage,
  userMessage,
} from './openai-compat'

const BASE_URL = 'https://api.cerebras.ai/v1'

function getApiKey(): string {
  if (process.env.CEREBRAS_API_KEY)
    return process.env.CEREBRAS_API_KEY

  throw new Error('No Cerebras API key found. Set CEREBRAS_API_KEY in your environment.')
}

export function cerebras(defaultModel?: string): Provider {
  const apiKey = getApiKey()
  const fallbackModel = defaultModel || 'zai-glm-4.7'

  return {
    name: 'cerebras',
    meta: { defaultModel: fallbackModel },
    formatTools,
    userMessage,
    assistantMessage,
    toolResultsMessage,

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

      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: options.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Cerebras API error: ${response.status} ${errorText}`)
      }

      const result = await consumeSSE(response, callbacks, options.signal)

      return {
        assistantMessage: buildAssistantContent(result.text, result.toolCalls),
        text: result.text,
        toolCalls: result.toolCalls,
        done: result.finishReason === 'stop' || result.toolCalls.length === 0,
        usage: result.usage,
      }
    },
  }
}
