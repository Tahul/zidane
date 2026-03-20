/**
 * Factory for creating a basic harness with optional spawn tool.
 *
 * Separated from basic.ts to avoid circular imports
 * (basic → tools/spawn → agent → harnesses → basic).
 */

import type { HarnessConfig, ToolDef } from '.'
import type { Provider } from '../providers'
import type { SpawnToolOptions } from '../tools/spawn'
import { defineHarness } from '.'
import { createSpawnTool } from '../tools/spawn'
import basic, { basicTools } from './basic'

export interface BasicHarnessOptions {
  /** Provider for sub-agent spawning. When provided, includes the spawn tool. */
  provider?: Provider
  /** Override spawn tool options (provider is still required) */
  spawn?: Omit<SpawnToolOptions, 'provider' | 'harness'>
}

/**
 * Create a basic harness with optional spawn tool.
 *
 * Without a provider, returns the same harness as the default `basic` export.
 * With a provider, includes a `spawn` tool for sub-agent delegation.
 * Children use the base basic harness (without spawn) to avoid infinite nesting.
 *
 * @example
 * ```ts
 * // Without spawn (same as `basic`)
 * const harness = createBasicHarness()
 *
 * // With spawn
 * const harness = createBasicHarness({ provider })
 *
 * // With spawn + options
 * const harness = createBasicHarness({
 *   provider,
 *   spawn: { maxConcurrent: 5, thinking: 'medium' },
 * })
 * ```
 */
export function createBasicHarness(options?: BasicHarnessOptions): HarnessConfig {
  if (!options?.provider) {
    return basic
  }

  const tools: Record<string, ToolDef> = { ...basicTools }

  tools.spawn = createSpawnTool({
    ...options.spawn,
    provider: options.provider,
    harness: basic, // children get base tools without spawn
  })

  return defineHarness({
    name: 'basic',
    system: 'You are a helpful assistant with access to shell, file reading, file writing, directory listing, and sub-agent spawning tools. Use them to accomplish tasks in the project directory.',
    tools,
  })
}
