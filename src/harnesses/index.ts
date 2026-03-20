import type Anthropic from '@anthropic-ai/sdk'

export interface ToolDef {
  spec: Anthropic.Tool
  execute: (input: Record<string, unknown>) => Promise<string>
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

export { default as basic } from './basic'
