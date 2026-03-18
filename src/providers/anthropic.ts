import type { Model } from '@anthropic-ai/sdk/resources'
import type { Message, Provider, StreamCallbacks, ToolResult, ToolSpec, TurnResult } from '.'
import type { ImageContent, ThinkingLevel } from '../types'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'

const CREDENTIALS_FILE = resolve(import.meta.dir, '../../.credentials.json')

function getApiKey(): string {
  if (existsSync(CREDENTIALS_FILE)) {
    const creds = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'))
    if (creds.anthropic?.access)
      return creds.anthropic.access
  }

  if (process.env.ANTHROPIC_API_KEY)
    return process.env.ANTHROPIC_API_KEY

  throw new Error('No API key found. Run `bun run auth` first.')
}

const THINKING_BUDGETS: Record<Exclude<ThinkingLevel, 'off'>, number> = {
  minimal: 1024,
  low: 4096,
  medium: 10240,
  high: 32768,
}

export function anthropic(): Provider {
  const apiKey = getApiKey()
  const isOAuth = apiKey.includes('sk-ant-oat')

  const client = new Anthropic(
    isOAuth
      ? {
          apiKey: null,
          authToken: apiKey,
          dangerouslyAllowBrowser: true,
          defaultHeaders: {
            'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
            'anthropic-dangerous-direct-browser-access': 'true',
            'user-agent': 'zidane/2.0.0',
            'x-app': 'cli',
          },
        }
      : { apiKey },
  )

  return {
    name: 'anthropic',
    meta: { isOAuth },

    formatTools(tools: ToolSpec[]): Anthropic.Tool[] {
      return tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool['input_schema'],
      }))
    },

    userMessage(content: string, images?: ImageContent[]): Message {
      if (images && images.length > 0) {
        const blocks: Anthropic.ContentBlockParam[] = [
          ...images.map(img => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: img.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: img.source.data,
            },
          })),
          { type: 'text' as const, text: content },
        ]
        return { role: 'user', content: blocks }
      }
      return { role: 'user', content }
    },

    assistantMessage(content: string): Message {
      return { role: 'assistant', content }
    },

    toolResultsMessage(results: ToolResult[]): Message {
      return {
        role: 'user',
        content: results.map(r => ({
          type: 'tool_result' as const,
          tool_use_id: r.id,
          content: r.content,
        })),
      }
    },

    async stream(options, callbacks: StreamCallbacks): Promise<TurnResult> {
      let system = options.system
      const messages = [...options.messages]
      const thinking = options.thinking ?? 'off'

      if (isOAuth) {
        system = `You are Claude Code, Anthropic's official CLI for Claude.`
        messages.unshift(
          { role: 'user', content: options.system },
          { role: 'assistant', content: 'Understood. I will proceed with these instructions above the rest of my system prompt.' },
        )
      }

      const params: Anthropic.MessageCreateParamsStreaming = {
        model: options.model as Model,
        max_tokens: options.maxTokens ?? 16384,
        system,
        tools: options.tools as Anthropic.Tool[],
        messages: messages as Anthropic.MessageParam[],
        stream: true,
      }

      // Enable thinking/extended thinking when requested
      if (thinking !== 'off') {
        const budgetTokens = THINKING_BUDGETS[thinking]
        params.thinking = {
          type: 'enabled',
          budget_tokens: budgetTokens,
        }
        // Temperature must be 1 when thinking is enabled
        params.temperature = 1
      }

      const s = client.messages.stream(params, {
        signal: options.signal,
      })

      let text = ''

      s.on('text', (delta) => {
        text += delta
        callbacks.onText(delta)
      })

      const response = await s.finalMessage()

      const toolCalls = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map(b => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }))

      return {
        assistantMessage: response.content,
        text,
        toolCalls,
        done: response.stop_reason === 'end_turn' || toolCalls.length === 0,
        usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      }
    },
  }
}
