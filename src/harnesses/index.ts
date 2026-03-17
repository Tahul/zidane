import type Anthropic from '@anthropic-ai/sdk'
import { harness as basic } from './basic'

export interface ToolDef {
  spec: Anthropic.Tool
  execute: (input: Record<string, unknown>) => Promise<string>
}

export type ToolMap = Map<string, ToolDef>

export const harnesses = {
  basic,
} as const

export type Harness = keyof typeof harnesses
