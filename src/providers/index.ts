export interface ToolSpec {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  id: string
  content: string
}

export interface TurnOptions {
  model: string
  system: string
  tools: unknown[]
  messages: Message[]
  maxTokens: number
}

export interface Message {
  role: 'user' | 'assistant'
  content: unknown
}

export interface StreamCallbacks {
  onText: (delta: string) => void
}

export interface TurnResult {
  /** Full response to push into message history as assistant turn */
  assistantMessage: unknown
  /** Text content blocks concatenated */
  text: string
  /** Tool calls requested by the model */
  toolCalls: ToolCall[]
  /** Whether the model wants to stop */
  done: boolean
  usage: { input: number, output: number }
}

export interface StreamOptions {
  model: string
  system: string
  tools: unknown[]
  messages: Message[]
  maxTokens: number
}

export interface Provider {
  readonly name: string
  readonly meta: Record<string, unknown>

  /** Format tool specs for this provider */
  formatTools: (tools: ToolSpec[]) => unknown[]

  /** Create an initial user message */
  userMessage: (content: string) => Message

  /** Create an assistant message (for priming) */
  assistantMessage: (content: string) => Message

  /** Create a tool results message to send back */
  toolResultsMessage: (results: ToolResult[]) => Message

  /** Stream a turn, calling onText for each text delta */
  stream: (options: TurnOptions, callbacks: StreamCallbacks) => Promise<TurnResult>
}

export { anthropic } from './anthropic'
