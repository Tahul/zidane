import { describe, expect, it } from 'bun:test'
import { basic, createBasicHarness, defineHarness } from '../src/harnesses'
import { createMockProvider } from './mock-provider'

// ---------------------------------------------------------------------------
// Harness: basic tools
// ---------------------------------------------------------------------------

describe('basic harness', () => {
  const tools = basic.tools

  it('has a name and system prompt', () => {
    expect(basic.name).toBe('basic')
    expect(basic.system).toBeDefined()
    expect(typeof basic.system).toBe('string')
  })

  it('exports expected tool set', () => {
    const names = Object.keys(tools)
    expect(names).toContain('shell')
    expect(names).toContain('readFile')
    expect(names).toContain('writeFile')
    expect(names).toContain('listFiles')
  })

  describe('shell', () => {
    it('has correct spec', () => {
      expect(tools.shell.spec.name).toBe('shell')
      expect((tools.shell.spec.input_schema as any).required).toEqual(['command'])
    })

    it('executes echo command', async () => {
      const result = await tools.shell.execute({ command: 'echo hello' })
      expect(result.trim()).toBe('hello')
    })

    it('returns error for failing command', async () => {
      const result = await tools.shell.execute({ command: 'false' })
      expect(result).toContain('Exit code')
    })

    it('returns no output for silent command', async () => {
      const result = await tools.shell.execute({ command: 'true' })
      expect(result).toBe('(no output)')
    })
  })

  describe('readFile', () => {
    it('has correct spec', () => {
      expect(tools.readFile.spec.name).toBe('read_file')
      expect((tools.readFile.spec.input_schema as any).required).toEqual(['path'])
    })

    it('returns error for nonexistent file', async () => {
      const result = await tools.readFile.execute({ path: 'nonexistent-file-xyz-12345.txt' })
      expect(result).toContain('File not found')
    })
  })

  describe('writeFile', () => {
    it('has correct spec', () => {
      expect(tools.writeFile.spec.name).toBe('write_file')
      expect((tools.writeFile.spec.input_schema as any).required).toEqual(['path', 'content'])
    })
  })

  describe('listFiles', () => {
    it('has correct spec', () => {
      expect(tools.listFiles.spec.name).toBe('list_files')
    })

    it('lists project root', async () => {
      const result = await tools.listFiles.execute({ path: '.' })
      expect(result).toContain('src')
      expect(result).toContain('test')
      expect(result).toContain('package.json')
    })

    it('returns error for nonexistent directory', async () => {
      const result = await tools.listFiles.execute({ path: 'nonexistent-dir-xyz-12345' })
      expect(result).toContain('not found')
    })
  })
})

// ---------------------------------------------------------------------------
// createBasicHarness
// ---------------------------------------------------------------------------

describe('createBasicHarness', () => {
  it('returns base basic harness when no options', () => {
    const harness = createBasicHarness()
    expect(harness.name).toBe('basic')
    expect(Object.keys(harness.tools)).not.toContain('spawn')
    // Should have the 4 core tools
    expect(Object.keys(harness.tools)).toEqual(Object.keys(basic.tools))
  })

  it('returns base basic harness when no provider', () => {
    const harness = createBasicHarness({})
    expect(Object.keys(harness.tools)).not.toContain('spawn')
  })

  it('includes spawn tool when provider is given', () => {
    const provider = createMockProvider([{ text: 'done', done: true }])
    const harness = createBasicHarness({ provider })

    expect(Object.keys(harness.tools)).toContain('spawn')
    expect(Object.keys(harness.tools)).toContain('shell')
    expect(Object.keys(harness.tools)).toContain('readFile')
    expect(harness.tools.spawn.spec.name).toBe('spawn')
  })

  it('spawn tool has correct spec', () => {
    const provider = createMockProvider([{ text: 'done', done: true }])
    const harness = createBasicHarness({ provider })
    const spawn = harness.tools.spawn

    expect(spawn.spec.name).toBe('spawn')
    expect((spawn.spec.input_schema as any).required).toContain('task')
  })

  it('passes spawn options through', () => {
    const provider = createMockProvider([{ text: 'done', done: true }])
    const harness = createBasicHarness({
      provider,
      spawn: { maxConcurrent: 5 },
    })

    expect(harness.tools.spawn).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// defineHarness
// ---------------------------------------------------------------------------

describe('defineHarness', () => {
  it('creates a harness config with name and tools', () => {
    const harness = defineHarness({
      name: 'test-harness',
      tools: {
        echo: {
          spec: {
            name: 'echo',
            description: 'Echo input back',
            input_schema: {
              type: 'object' as const,
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
          async execute({ text }) {
            return text as string
          },
        },
      },
    })

    expect(harness.name).toBe('test-harness')
    expect(harness.system).toBeUndefined()
    expect(Object.keys(harness.tools)).toEqual(['echo'])
  })

  it('creates a harness config with system prompt', () => {
    const harness = defineHarness({
      name: 'custom',
      system: 'You are a code reviewer.',
      tools: {},
    })

    expect(harness.name).toBe('custom')
    expect(harness.system).toBe('You are a code reviewer.')
  })
})
