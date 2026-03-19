import type { ToolSpec } from '../src/providers'
import type { ImageContent } from '../src/types'
import { describe, expect, it } from 'bun:test'
import {
  ASSISTANT_TOOL_CALLS_TAG,
  assistantMessage,
  buildAssistantContent,
  consumeSSE,
  convertImageContent,
  formatTools,
  toOAIMessages,
  TOOL_RESULTS_TAG,
  toolResultsMessage,
  userMessage,
} from '../src/providers/openai-compat'

// ---------------------------------------------------------------------------
// convertImageContent
// ---------------------------------------------------------------------------

describe('convertImageContent', () => {
  it('converts image content to OpenAI image_url format', () => {
    const img: ImageContent = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
    }

    const result = convertImageContent(img)

    expect(result.type).toBe('image_url')
    expect(result.image_url.url).toBe('data:image/png;base64,abc123')
  })

  it('handles different media types', () => {
    const img: ImageContent = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'xyz' },
    }

    const result = convertImageContent(img)
    expect(result.image_url.url).toBe('data:image/jpeg;base64,xyz')
  })
})

// ---------------------------------------------------------------------------
// formatTools
// ---------------------------------------------------------------------------

describe('formatTools', () => {
  it('converts ToolSpec[] to OpenAI function tool format', () => {
    const tools: ToolSpec[] = [
      {
        name: 'shell',
        description: 'Run a command',
        input_schema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
    ]

    const result = formatTools(tools)

    expect(result).toEqual([
      {
        type: 'function',
        function: {
          name: 'shell',
          description: 'Run a command',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      },
    ])
  })

  it('handles multiple tools', () => {
    const tools: ToolSpec[] = [
      { name: 'a', description: 'Tool A', input_schema: {} },
      { name: 'b', description: 'Tool B', input_schema: {} },
    ]

    const result = formatTools(tools)
    expect(result.length).toBe(2)
    expect(result[0].function.name).toBe('a')
    expect(result[1].function.name).toBe('b')
  })

  it('returns empty array for empty input', () => {
    expect(formatTools([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// userMessage
// ---------------------------------------------------------------------------

describe('userMessage', () => {
  it('creates a plain text user message', () => {
    const msg = userMessage('hello')
    expect(msg).toEqual({ role: 'user', content: 'hello' })
  })

  it('creates a multimodal message with images', () => {
    const images: ImageContent[] = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
    ]

    const msg = userMessage('describe this', images)

    expect(msg.role).toBe('user')
    expect(Array.isArray(msg.content)).toBe(true)
    const content = msg.content as any[]
    expect(content.length).toBe(2)
    expect(content[0].type).toBe('image_url')
    expect(content[0].image_url.url).toBe('data:image/png;base64,abc')
    expect(content[1]).toEqual({ type: 'text', text: 'describe this' })
  })

  it('creates a multimodal message with multiple images', () => {
    const images: ImageContent[] = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img1' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'img2' } },
    ]

    const msg = userMessage('two images', images)
    const content = msg.content as any[]
    expect(content.length).toBe(3) // 2 images + 1 text
    expect(content[2]).toEqual({ type: 'text', text: 'two images' })
  })

  it('falls back to plain text when images is empty', () => {
    const msg = userMessage('no images', [])
    expect(msg).toEqual({ role: 'user', content: 'no images' })
  })
})

// ---------------------------------------------------------------------------
// assistantMessage
// ---------------------------------------------------------------------------

describe('assistantMessage', () => {
  it('creates an assistant message', () => {
    expect(assistantMessage('hi')).toEqual({ role: 'assistant', content: 'hi' })
  })
})

// ---------------------------------------------------------------------------
// toolResultsMessage
// ---------------------------------------------------------------------------

describe('toolResultsMessage', () => {
  it('creates a tagged tool results message', () => {
    const msg = toolResultsMessage([
      { id: 'tc1', content: 'output 1' },
      { id: 'tc2', content: 'output 2' },
    ])

    expect(msg.role).toBe('user')
    const content = msg.content as any
    expect(content._tag).toBe(TOOL_RESULTS_TAG)
    expect(content.results).toEqual([
      { tool_call_id: 'tc1', content: 'output 1' },
      { tool_call_id: 'tc2', content: 'output 2' },
    ])
  })

  it('handles empty results', () => {
    const msg = toolResultsMessage([])
    const content = msg.content as any
    expect(content._tag).toBe(TOOL_RESULTS_TAG)
    expect(content.results).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildAssistantContent
// ---------------------------------------------------------------------------

describe('buildAssistantContent', () => {
  it('returns plain text when no tool calls', () => {
    const result = buildAssistantContent('just text', [])
    expect(result).toBe('just text')
  })

  it('returns tagged content with tool calls', () => {
    const toolCalls = [
      { id: 'tc1', name: 'shell', input: { command: 'echo hi' } },
    ]

    const result = buildAssistantContent('thinking...', toolCalls) as any

    expect(result._tag).toBe(ASSISTANT_TOOL_CALLS_TAG)
    expect(result.text).toBe('thinking...')
    expect(result.tool_calls).toEqual([
      {
        id: 'tc1',
        type: 'function',
        function: { name: 'shell', arguments: '{"command":"echo hi"}' },
      },
    ])
  })

  it('sets text to null when empty string with tool calls', () => {
    const toolCalls = [{ id: 'tc1', name: 'read', input: { path: '.' } }]
    const result = buildAssistantContent('', toolCalls) as any
    expect(result._tag).toBe(ASSISTANT_TOOL_CALLS_TAG)
    expect(result.text).toBeNull()
  })

  it('handles multiple tool calls', () => {
    const toolCalls = [
      { id: 'tc1', name: 'shell', input: { command: 'echo a' } },
      { id: 'tc2', name: 'shell', input: { command: 'echo b' } },
    ]

    const result = buildAssistantContent('both', toolCalls) as any
    expect(result.tool_calls.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// toOAIMessages
// ---------------------------------------------------------------------------

describe('toOAIMessages', () => {
  it('prepends system message', () => {
    const result = toOAIMessages('You are helpful', [])
    expect(result).toEqual([{ role: 'system', content: 'You are helpful' }])
  })

  it('passes through plain user and assistant messages', () => {
    const messages = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi there' },
    ]

    const result = toOAIMessages('sys', messages)
    expect(result.length).toBe(3)
    expect(result[1]).toEqual({ role: 'user', content: 'hello' })
    expect(result[2]).toEqual({ role: 'assistant', content: 'hi there' })
  })

  it('expands TOOL_RESULTS_TAG into individual tool messages', () => {
    const messages = [
      {
        role: 'user' as const,
        content: {
          _tag: TOOL_RESULTS_TAG,
          results: [
            { tool_call_id: 'tc1', content: 'result 1' },
            { tool_call_id: 'tc2', content: 'result 2' },
          ],
        },
      },
    ]

    const result = toOAIMessages('sys', messages)
    expect(result.length).toBe(3) // system + 2 tool results
    expect(result[1]).toEqual({ role: 'tool', tool_call_id: 'tc1', content: 'result 1' })
    expect(result[2]).toEqual({ role: 'tool', tool_call_id: 'tc2', content: 'result 2' })
  })

  it('expands ASSISTANT_TOOL_CALLS_TAG into assistant with tool_calls', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: {
          _tag: ASSISTANT_TOOL_CALLS_TAG,
          text: 'let me check',
          tool_calls: [
            { id: 'tc1', type: 'function', function: { name: 'shell', arguments: '{"command":"ls"}' } },
          ],
        },
      },
    ]

    const result = toOAIMessages('sys', messages)
    expect(result.length).toBe(2)
    expect(result[1].role).toBe('assistant')
    expect(result[1].content).toBe('let me check')
    expect(result[1].tool_calls).toEqual([
      { id: 'tc1', type: 'function', function: { name: 'shell', arguments: '{"command":"ls"}' } },
    ])
  })

  it('handles null text in ASSISTANT_TOOL_CALLS_TAG', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: {
          _tag: ASSISTANT_TOOL_CALLS_TAG,
          text: null,
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'a', arguments: '{}' } }],
        },
      },
    ]

    const result = toOAIMessages('sys', messages)
    expect(result[1].content).toBeNull()
  })

  it('handles a full conversation with mixed message types', () => {
    const messages = [
      { role: 'user' as const, content: 'do something' },
      {
        role: 'assistant' as const,
        content: {
          _tag: ASSISTANT_TOOL_CALLS_TAG,
          text: 'running',
          tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'shell', arguments: '{"command":"echo hi"}' } }],
        },
      },
      {
        role: 'user' as const,
        content: {
          _tag: TOOL_RESULTS_TAG,
          results: [{ tool_call_id: 'tc1', content: 'hi' }],
        },
      },
      { role: 'assistant' as const, content: 'Done! Output was hi.' },
    ]

    const result = toOAIMessages('system prompt', messages)

    expect(result.length).toBe(5) // system + user + assistant(tc) + tool + assistant
    expect(result[0].role).toBe('system')
    expect(result[1].role).toBe('user')
    expect(result[2].role).toBe('assistant')
    expect(result[2].tool_calls).toBeDefined()
    expect(result[3].role).toBe('tool')
    expect(result[4].role).toBe('assistant')
    expect(result[4].content).toBe('Done! Output was hi.')
  })
})

// ---------------------------------------------------------------------------
// consumeSSE
// ---------------------------------------------------------------------------

describe('consumeSSE', () => {
  function makeSSEResponse(lines: string[]): Response {
    const text = `${lines.join('\n')}\n`
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text))
        controller.close()
      },
    })
    return new Response(stream)
  }

  it('parses text deltas from SSE stream', async () => {
    const response = makeSSEResponse([
      'data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}',
      'data: {"choices":[{"delta":{"content":" world"},"index":0}]}',
      'data: {"choices":[{"finish_reason":"stop","delta":{},"index":0}]}',
      'data: [DONE]',
    ])

    const deltas: string[] = []
    const result = await consumeSSE(response, { onText: d => deltas.push(d) })

    expect(result.text).toBe('Hello world')
    expect(deltas).toEqual(['Hello', ' world'])
    expect(result.finishReason).toBe('stop')
    expect(result.toolCalls).toEqual([])
  })

  it('parses tool calls from SSE stream', async () => {
    const response = makeSSEResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell","arguments":""}}]},"index":0}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"com"}}]},"index":0}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"mand\\":\\"ls\\"}"}}]},"index":0}]}',
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{},"index":0}]}',
      'data: [DONE]',
    ])

    const result = await consumeSSE(response, { onText: () => {} })

    expect(result.toolCalls.length).toBe(1)
    expect(result.toolCalls[0].id).toBe('call_1')
    expect(result.toolCalls[0].name).toBe('shell')
    expect(result.toolCalls[0].input).toEqual({ command: 'ls' })
    expect(result.finishReason).toBe('tool_calls')
  })

  it('parses multiple tool calls', async () => {
    const response = makeSSEResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell","arguments":"{\\"command\\":\\"echo a\\"}"}}]},"index":0}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"read_file","arguments":"{\\"path\\":\\"test.txt\\"}"}}]},"index":0}]}',
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{},"index":0}]}',
      'data: [DONE]',
    ])

    const result = await consumeSSE(response, { onText: () => {} })

    expect(result.toolCalls.length).toBe(2)
    expect(result.toolCalls[0].name).toBe('shell')
    expect(result.toolCalls[1].name).toBe('read_file')
    expect(result.toolCalls[1].input).toEqual({ path: 'test.txt' })
  })

  it('parses usage data', async () => {
    const response = makeSSEResponse([
      'data: {"choices":[{"delta":{"content":"hi"},"index":0}]}',
      'data: {"choices":[{"finish_reason":"stop","delta":{},"index":0}],"usage":{"prompt_tokens":42,"completion_tokens":7}}',
      'data: [DONE]',
    ])

    const result = await consumeSSE(response, { onText: () => {} })
    expect(result.usage).toEqual({ input: 42, output: 7 })
  })

  it('handles empty stream gracefully', async () => {
    const response = makeSSEResponse(['data: [DONE]'])

    const result = await consumeSSE(response, { onText: () => {} })

    expect(result.text).toBe('')
    expect(result.toolCalls).toEqual([])
    expect(result.finishReason).toBe('stop')
  })

  it('skips malformed JSON lines', async () => {
    const response = makeSSEResponse([
      'data: not-json',
      'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}',
      'data: {"broken',
      'data: [DONE]',
    ])

    const result = await consumeSSE(response, { onText: () => {} })
    expect(result.text).toBe('ok')
  })

  it('skips lines that are not data lines', async () => {
    const response = makeSSEResponse([
      ': comment',
      'event: ping',
      'data: {"choices":[{"delta":{"content":"yes"},"index":0}]}',
      '',
      'data: [DONE]',
    ])

    const result = await consumeSSE(response, { onText: () => {} })
    expect(result.text).toBe('yes')
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    controller.abort()

    const response = makeSSEResponse([
      'data: {"choices":[{"delta":{"content":"should not appear"},"index":0}]}',
    ])

    const result = await consumeSSE(response, { onText: () => {} }, controller.signal)
    expect(result.text).toBe('')
  })

  it('handles text + tool calls in the same stream', async () => {
    const response = makeSSEResponse([
      'data: {"choices":[{"delta":{"content":"Let me run that"},"index":0}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell","arguments":"{\\"command\\":\\"ls\\"}"}}]},"index":0}]}',
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{},"index":0}]}',
      'data: [DONE]',
    ])

    const result = await consumeSSE(response, { onText: () => {} })
    expect(result.text).toBe('Let me run that')
    expect(result.toolCalls.length).toBe(1)
    expect(result.toolCalls[0].name).toBe('shell')
  })

  it('assigns fallback id when tool call has no id', async () => {
    const response = makeSSEResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"test","arguments":"{}"}}]},"index":0}]}',
      'data: {"choices":[{"finish_reason":"tool_calls","delta":{},"index":0}]}',
      'data: [DONE]',
    ])

    const result = await consumeSSE(response, { onText: () => {} })
    expect(result.toolCalls[0].id).toBe('call_0')
  })
})
