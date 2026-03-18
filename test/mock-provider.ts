/**
 * Mock provider for testing the agent loop without real LLM calls.
 *
 * Usage:
 *   const provider = createMockProvider([
 *     { text: 'I will use the shell tool', toolCalls: [{ id: 'tc1', name: 'shell', input: { command: 'echo hi' } }] },
 *     { text: 'Done! The output was hi.', done: true },
 *   ])
 */

import type { Message, Provider, StreamCallbacks, ToolResult, ToolSpec, TurnResult } from '../src/providers'
import type { ImageContent } from '../src/types'

export interface MockTurn {
  text: string
  toolCalls?: { id: string, name: string, input: Record<string, unknown> }[]
  done?: boolean
}

export function createMockProvider(turns: MockTurn[]): Provider {
  let turnIndex = 0

  return {
    name: 'mock',
    meta: { isMock: true },

    formatTools(tools: ToolSpec[]) {
      return tools
    },

    userMessage(content: string, _images?: ImageContent[]): Message {
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
      if (options.signal?.aborted) {
        return {
          assistantMessage: '',
          text: '',
          toolCalls: [],
          done: true,
          usage: { input: 0, output: 0 },
        }
      }

      const turn = turns[turnIndex++]
      if (!turn) {
        return {
          assistantMessage: 'No more mock turns configured',
          text: 'No more mock turns configured',
          toolCalls: [],
          done: true,
          usage: { input: 0, output: 0 },
        }
      }

      // Simulate streaming text deltas
      for (const char of turn.text) {
        callbacks.onText(char)
      }

      const toolCalls = turn.toolCalls ?? []
      const isDone = turn.done ?? toolCalls.length === 0

      return {
        assistantMessage: turn.text,
        text: turn.text,
        toolCalls,
        done: isDone,
        usage: { input: 10, output: turn.text.length },
      }
    },
  }
}
