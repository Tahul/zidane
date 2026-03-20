/**
 * CLI entrypoint for the agent.
 *
 * Usage: bun start --prompt "your message here"
 *        bun start --prompt "run ls" --context docker
 *        bun start --prompt "do stuff" --context docker --image node:22
 */

import type { ExecutionContext } from './contexts'
import type { ThinkingLevel } from './types'
import { parseArgs } from 'node:util'
import { createAgent } from './agent'
import { createDockerContext, createProcessContext } from './contexts'
import { basic } from './harnesses'
import { setupTerminalOutput } from './output/terminal'
import { anthropic, cerebras, openrouter } from './providers'

const providers = {
  anthropic: anthropic(),
  openrouter: openrouter(),
  cerebras: cerebras(),
}

const harnesses = {
  basic,
} as const

async function main() {
  const { system, prompt, model, harness, thinking, provider: providerName, context, image, cwd } = args()

  const harnessConfig = harnesses[harness as keyof typeof harnesses]
  if (!harnessConfig) {
    console.error(`Unknown harness: ${harness}. Available: ${Object.keys(harnesses).join(', ')}`)
    process.exit(1)
  }

  const executionContext = createContext(context)

  const agent = createAgent({
    harness: harnessConfig,
    provider: providers[providerName as keyof typeof providers],
    context: executionContext,
    spawnConfig: { image, cwd },
  })

  if (context !== 'process') {
    console.log(`🔧 Execution context: ${context}${image ? ` (${image})` : ''}${cwd ? ` in ${cwd}` : ''}`)
  }

  await setupTerminalOutput(agent, model, prompt, harnessConfig)

  try {
    await agent.run({ model, prompt, system, thinking })
  }
  finally {
    await agent.destroy()
  }
}

function createContext(type: string): ExecutionContext {
  switch (type) {
    case 'docker':
      return createDockerContext()
    case 'process':
    default:
      return createProcessContext()
  }
}

function args() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      prompt: { type: 'string', short: 'm' },
      model: { type: 'string', short: 'm' },
      harness: { type: 'string', short: 't', default: 'basic' },
      system: { type: 'string', short: 's' },
      thinking: { type: 'string', default: 'off' },
      provider: { type: 'string', short: 'p', default: 'anthropic' },
      context: { type: 'string', short: 'c', default: 'process' },
      image: { type: 'string' },
      cwd: { type: 'string' },
    },
    strict: false,
  })

  const system = values.system as string
  const prompt = values.prompt as string
  const model = values.model as string || providers[values.provider as keyof typeof providers]?.meta.defaultModel
  const harness = (values.harness as string) || 'basic'
  const thinking = (values.thinking as ThinkingLevel) || 'off'
  const provider = values.provider as keyof typeof providers || 'anthropic'
  const context = (values.context as string) || 'process'
  const image = values.image as string | undefined
  const cwd = values.cwd as string | undefined

  if (!prompt || (typeof prompt === 'string' && prompt.trim() === '')) {
    console.error('Usage: bun start --prompt "your message" [--context process|docker] [--image node:22] [--cwd /workspace]')
    process.exit(1)
  }

  return { system, prompt, model, harness, thinking, provider, context, image, cwd }
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
