/**
 * Shared types for the agent system.
 */

// ---------------------------------------------------------------------------
// Thinking / Reasoning
// ---------------------------------------------------------------------------

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high'

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export type ToolExecutionMode = 'sequential' | 'parallel'

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export interface ImageContent {
  type: 'image'
  source: {
    type: 'base64'
    media_type: string
    data: string
  }
}

export type ContentBlock
  = | { type: 'text', text: string }
    | ImageContent

// ---------------------------------------------------------------------------
// Agent run options
// ---------------------------------------------------------------------------

export interface AgentRunOptions {
  model?: string
  prompt: string
  system?: string
  thinking?: ThinkingLevel
  images?: ImageContent[]
}

// ---------------------------------------------------------------------------
// Agent stats
// ---------------------------------------------------------------------------

export interface AgentStats {
  totalIn: number
  totalOut: number
  turns: number
  elapsed: number
}
