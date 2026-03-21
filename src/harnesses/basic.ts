import type { ToolDef } from '.'
import { defineHarness } from '.'
import { listFiles, readFile, shell, writeFile } from '../tools'

/** Core tools available in every basic harness (without spawn) */
export const basicTools = { shell, readFile, writeFile, listFiles }

// Lazy-loaded spawn to break circular dependency:
// basic → tools/spawn → agent → harnesses → basic
let _spawn: ToolDef | undefined
function getSpawn(): ToolDef {
  if (!_spawn) {
    // eslint-disable-next-line ts/no-require-imports
    _spawn = require('../tools/spawn').spawn as ToolDef
  }
  return _spawn
}

const spawnProxy: ToolDef = {
  get spec() { return getSpawn().spec },
  execute(input, ctx) { return getSpawn().execute(input, ctx) },
}

export default defineHarness({
  name: 'basic',
  system: 'You are a helpful assistant with access to shell, file reading, file writing, directory listing, and sub-agent spawning tools. Use them to accomplish tasks in the project directory.',
  tools: { ...basicTools, spawn: spawnProxy },
})
