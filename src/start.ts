/**
 * CLI entrypoint for the agent.
 *
 * Usage: bun start --prompt "your message here"
 */

import type { Harness } from './harnesses'
import type { ThinkingLevel } from './types'
import { parseArgs } from 'node:util'
import { createAgent } from './agent'
import { setupTerminalOutput } from './output/terminal'
import { anthropic, cerebras, openrouter } from './providers'

const providers = {
  anthropic: anthropic(),
  openrouter: openrouter(),
  cerebras: cerebras(),
}

async function main() {
  const { system, prompt, model, harness, thinking, provider: providerName } = args()

  const agent = createAgent({ harness, provider: providers[providerName as keyof typeof providers] })

  await setupTerminalOutput(agent, model, prompt, harness)

  await agent.run({ model, prompt, system, thinking })
}

function args() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      prompt: { type: 'string', short: 'm' },
      model: { type: 'string', short: 'm' },
      harness: { type: 'string', short: 't', default: 'basic' },
      system: { type: 'string', short: 's' },
      thinking: { type: 'string', choices: ['off', 'minimal', 'low', 'medium', 'high'], default: 'off' },
      provider: { type: 'string', short: 'p', choices: Object.keys(providers), default: 'anthropic' },
    },
    strict: false,
  })

  const system = values.system as string
  const prompt = values.prompt as string
  const model = values.model as string || providers[values.provider as keyof typeof providers]?.meta.defaultModel
  const harness = (values.harness as Harness) || 'basic'
  const thinking = (values.thinking as ThinkingLevel) || 'off'
  const provider = values.provider as keyof typeof providers || 'anthropic'

  if (!prompt || (typeof prompt === 'string' && prompt.trim() === '')) {
    console.error('Usage: bun start --prompt "your message"')
    process.exit(1)
  }

  return { system, prompt, model, harness, thinking, provider }
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
