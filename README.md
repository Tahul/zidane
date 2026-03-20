![Zidane](https://github.com/Tahul/zidane/blob/main/zidane.jpeg?raw=true)

# Zidane

An agent that goes straight to the goal.

Minimal TypeScript agent loop built with [Bun](https://bun.sh).

Hook into every step of the agent's execution using [hookable](https://github.com/unjs/hookable).

Built to be embedded in other projects easily, extended through [providers](#providers) and [harnesses](#harnesses).

## Quickstart

```bash
# Install
bun install

# Authenticate with Anthropic OAuth (Claude Pro/Max)
bun run auth

# Run
bun start --prompt "create a hello world express app"
```

## CLI

```bash
bun start \
  --prompt "your task"    \   # required
  --model claude-opus-4-6 \   # model id (default: claude-opus-4-6)
  --provider anthropic    \   # anthropic | openrouter | cerebras
  --harness basic         \   # tool set to use
  --system "be concise"   \   # system prompt
  --thinking off              # off | minimal | low | medium | high
```

## Providers

### Anthropic

Direct Anthropic API with OAuth and API key support.

```bash
# OAuth (Claude Pro/Max subscription)
bun run auth

# Or API key
ANTHROPIC_API_KEY=sk-ant-... bun start --prompt "hello"
```

### OpenRouter

Access 200+ models through OpenRouter's unified API.

```bash
OPENROUTER_API_KEY=sk-or-... bun start \
  --provider openrouter \
  --model anthropic/claude-sonnet-4-6 \
  --prompt "hello"
```

### Cerebras

Ultra-fast inference on Cerebras wafer-scale hardware.

```bash
CEREBRAS_API_KEY=csk-... bun start \
  --provider cerebras \
  --model zai-glm-4.7 \
  --prompt "hello"
```

## Thinking

Extended reasoning for complex tasks. Maps to Anthropic's thinking API or OpenRouter's `:thinking` variant.

```bash
bun start --prompt "solve this proof" --thinking high
```

| Level | Budget |
|---|---|
| `off` | disabled |
| `minimal` | 1k tokens |
| `low` | 4k tokens |
| `medium` | 10k tokens |
| `high` | 32k tokens |

## Tools (Harnesses)

Tools are grouped into **harnesses**. The `basic` harness includes:

| Tool | Description |
|---|---|
| `shell` | Execute shell commands |
| `read_file` | Read file contents |
| `write_file` | Write/create files |
| `list_files` | List directory contents |

All paths are sandboxed to the working directory.

## Hooks

The agent uses [hookable](https://github.com/unjs/hookable) for lifecycle events. Every hook receives a mutable context object.

### Lifecycle

```ts
agent.hooks.hook('system:before', (ctx) => {
  // ctx.system — system prompt text
})

agent.hooks.hook('turn:before', (ctx) => {
  // ctx.turn — turn number
  // ctx.options — StreamOptions being sent to provider
})

agent.hooks.hook('turn:after', (ctx) => {
  // ctx.turn, ctx.usage { input, output }
})

agent.hooks.hook('agent:done', (ctx) => {
  // ctx.totalIn, ctx.totalOut, ctx.turns, ctx.elapsed
})

agent.hooks.hook('agent:abort', () => {
  // fired when agent.abort() is called
})
```

### Streaming

```ts
agent.hooks.hook('stream:text', (ctx) => {
  // ctx.delta — new text chunk
  // ctx.text — accumulated text so far
})

agent.hooks.hook('stream:end', (ctx) => {
  // ctx.text — final complete text
})
```

### Tool Execution

```ts
agent.hooks.hook('tool:before', (ctx) => {
  // ctx.name, ctx.input
})

agent.hooks.hook('tool:after', (ctx) => {
  // ctx.name, ctx.input, ctx.result
})

agent.hooks.hook('tool:error', (ctx) => {
  // ctx.name, ctx.input, ctx.error
})
```

### Tool Gate — block execution

Mutate `ctx.block = true` to prevent a tool from running.

```ts
agent.hooks.hook('tool:gate', (ctx) => {
  if (ctx.name === 'shell' && String(ctx.input.command).includes('rm -rf')) {
    ctx.block = true
    ctx.reason = 'dangerous command'
  }
})
```

### Tool Transform — modify output

Mutate `ctx.result` or `ctx.isError` to transform tool results before they're sent back to the model.

```ts
agent.hooks.hook('tool:transform', (ctx) => {
  if (ctx.result.length > 5000)
    ctx.result = ctx.result.slice(0, 5000) + '\n... (truncated)'
})
```

### Context Transform — prune messages

Mutate `ctx.messages` before each LLM call for context window management.

```ts
agent.hooks.hook('context:transform', (ctx) => {
  if (ctx.messages.length > 30)
    ctx.messages.splice(2, ctx.messages.length - 30)
})
```

## Steering & Follow-up

### Steering — interrupt mid-run

Inject a message while the agent is working. Delivered between tool calls, skipping remaining tools in the current turn.

```ts
agent.hooks.hook('tool:after', () => {
  agent.steer('focus only on the tests directory')
})
```

### Follow-up — continue after done

Queue messages that extend the conversation after the agent finishes.

```ts
agent.followUp('now write tests for what you built')
agent.followUp('then update the README')
```

## Parallel Tool Execution

Execute multiple tool calls from a single turn concurrently.

```ts
const agent = createAgent({
  harness: 'basic',
  provider,
  toolExecution: 'parallel', // default: 'sequential'
})
```

## Image Content

Pass images alongside the prompt.

```ts
import { readFileSync } from 'fs'

await agent.run({
  prompt: 'describe this screenshot',
  images: [{
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: readFileSync('screenshot.png').toString('base64'),
    },
  }],
})
```

## State Management

```ts
agent.isRunning   // boolean — is a run in progress?
agent.messages    // Message[] — conversation history
agent.abort()     // cancel the current run
agent.reset()     // clear messages and queues
await agent.waitForIdle() // wait for current run to complete
```

## Project Structure

```
src/
  types.ts              shared types
  agent.ts              createAgent, state management
  loop.ts               turn execution loop
  start.ts              CLI entrypoint
  auth.ts               Anthropic OAuth flow
  tools/
    validation.ts       tool argument validation
  providers/
    index.ts            Provider interface
    openai-compat.ts    shared OpenAI-compatible utilities
    anthropic.ts        Anthropic provider
    openrouter.ts       OpenRouter provider
    cerebras.ts         Cerebras provider
  harnesses/
    index.ts            harness registry
    basic.ts            shell, read, write, list tools
  output/
    terminal.ts         terminal rendering (md4x)
test/
  mock-provider.ts      mock provider for testing
  agent.test.ts         agent test suite (30 tests)
  validation.test.ts    validation tests
```

## Testing

```bash
bun test
```

30 tests with a mock provider — no LLM calls needed.

## License

ISC
