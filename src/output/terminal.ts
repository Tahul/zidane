import type { Agent } from '../agent'
import type { HarnessConfig } from '../harnesses'
import chalk from 'chalk'
import { init as initMd4x, renderToAnsi } from 'md4x/wasm'

export async function setupTerminalOutput(agent: Agent, model: string, prompt: string, harness: HarnessConfig) {
  await initMd4x()

  console.log('\n⚽ Zizou')
  console.log(`${chalk.bold('🤖 Model:')} ${chalk.green(model)} (${agent.meta.isOAuth ? chalk.green('oauth') : chalk.red('key')})`)
  console.log(`${chalk.bold('📝 Prompt:')} ${chalk.yellow(prompt)}`)
  console.log(`${chalk.bold('🔧 Harness:')} ${chalk.cyan(harness.name)}`)
  console.log(`${chalk.bold('🔧 Tools:')} ${chalk.cyan(Object.values(harness.tools).map(t => t.spec.name).join(', '))}`)
  console.log()

  let isFirstDelta = true
  let hadToolCalls = false

  agent.hooks.hook(
    'turn:before',
    () => {
      isFirstDelta = true
    },
  )

  agent.hooks.hook(
    'stream:text',
    ({ text }) => {
      if (isFirstDelta) {
        if (hadToolCalls)
          process.stdout.write('\n')
        process.stdout.write('\x1B7') // save cursor position
        isFirstDelta = false
        hadToolCalls = false
      }
      else {
        process.stdout.write('\x1B8\x1B[0J') // restore cursor + clear to end
      }
      process.stdout.write(renderToAnsi(text, { heal: true }))
    },
  )

  agent.hooks.hook(
    'stream:end',
    ({ text }) => {
      process.stdout.write('\x1B8\x1B[0J') // restore cursor + clear to end
      process.stdout.write(`${renderToAnsi(text)}\n`)
    },
  )

  agent.hooks.hook(
    'tool:before',
    ({ name, input }) => {
      hadToolCalls = true
      const toolcallStringified = JSON.stringify(input)
      console.log(` ↳ ${chalk.cyan(name)}${toolcallStringified && toolcallStringified.trim() !== '{}' ? ` (${chalk.yellow(toolcallStringified)})` : ''}`)
    },
  )

  agent.hooks.hook('system:before', ctx => console.log(chalk.cyan(`System: ${chalk.yellow(ctx.system)}`)))

  agent.hooks.hook('agent:done', ({ totalIn, totalOut, turns, elapsed }) => {
    const seconds = Math.floor(elapsed / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    const timeStr = minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`
    console.log(chalk.cyan(`💸 Tokens: ${chalk.yellow(totalIn)} in / ${chalk.green(totalOut)} out (${chalk.magenta(turns)} turn${turns > 1 ? 's' : ''}) in ${chalk.green(timeStr)}`))
  })
}
