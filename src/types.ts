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
  /** Abort signal — when triggered, the agent stops after the current turn */
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Agent stats
// ---------------------------------------------------------------------------

export interface AgentStats {
  totalIn: number
  totalOut: number
  turns: number
  elapsed: number
  /** Stats from child agents spawned during this run */
  children?: ChildRunStats[]
}

export interface ChildRunStats {
  id: string
  task: string
  stats: AgentStats
}
