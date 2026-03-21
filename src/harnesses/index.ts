import type Anthropic from '@anthropic-ai/sdk'
import type { Hookable } from 'hookable'
import type { AgentHooks } from '../agent'
import type { ExecutionContext, ExecutionHandle } from '../contexts'
import type { Provider } from '../providers'

/**
 * Runtime context passed to every tool execution.
 * Provides access to the agent's provider, abort signal, execution environment, and hooks.
 */
export interface ToolContext {
  /** The LLM provider for this agent run */
  provider: Provider
  /** Abort signal — tools should check this for early termination */
  signal: AbortSignal
  /** The execution context (shell, filesystem, etc.) */
  execution: ExecutionContext
  /** The active execution handle for the current agent run */
  handle: ExecutionHandle
  /** Agent hooks for emitting events (e.g. spawn:complete) */
  hooks: Hookable<AgentHooks>
  /** The harness config for this agent (tools available to the agent) */
  harness: HarnessConfig
}

export interface ToolDef {
  spec: Anthropic.Tool
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>
}

export type ToolMap = Map<string, ToolDef>

export interface HarnessConfig {
  /** Display name for this harness */
  name: string
  /** Default system prompt injected when no system is provided at run time */
  system?: string
  /** Tool definitions available to the agent */
  tools: Record<string, ToolDef>
}

/**
 * Define a harness with a name, optional system prompt, and tools.
 */
export function defineHarness(config: HarnessConfig): HarnessConfig {
  return config
}

export type Harness = HarnessConfig

export { default as basic, basicTools } from './basic'
