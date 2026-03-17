/**
 * CLI entrypoint for the agent.
 *
 * Usage: bun start --prompt "your message here"
 */

import type { Harness } from './harnesses'
import { parseArgs } from 'node:util'
import { createAgent } from './agent'
import { setupTerminalOutput } from './output/terminal'
import { anthropic } from './providers'

async function main() {
  const { system, prompt, model, harness } = args()

  const provider = anthropic()

  const agent = createAgent({ harness, provider })

  await setupTerminalOutput(agent, model, prompt, harness)

  await agent.run({ model, prompt, system })
}

function args(): { system: string, prompt: string, model: string, harness: Harness } {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      prompt: { type: 'string', short: 'p' },
      model: { type: 'string', short: 'm', default: 'claude-opus-4-6' },
      harness: { type: 'string', short: 't', default: 'basic' },
      system: { type: 'string', short: 's' },
    },
    strict: false,
  })

  const system = values.system as string
  const prompt = values.prompt as string
  const model = values.model as string
  const harness = values.harness as Harness || 'basic'

  if (!prompt || (typeof prompt === 'string' && prompt.trim() === '')) {
    console.error('Usage: bun start --prompt "your message"')
    process.exit(1)
  }

  return { system, prompt, model, harness }
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  process.exit(1)
})
