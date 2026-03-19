import { describe, expect, it } from 'bun:test'
import { anthropic, cerebras, openrouter } from '../src/providers'

// ---------------------------------------------------------------------------
// Provider factory smoke tests (no API keys — tests error handling)
// ---------------------------------------------------------------------------

describe('provider factories', () => {
  describe('anthropic', () => {
    it('creates a provider with correct name', () => {
      // anthropic() reads ANTHROPIC_API_KEY or .credentials.json
      // We can test the factory structure without making real calls
      const original = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      try {
        const provider = anthropic()
        expect(provider.name).toBe('anthropic')
        expect(typeof provider.formatTools).toBe('function')
        expect(typeof provider.userMessage).toBe('function')
        expect(typeof provider.assistantMessage).toBe('function')
        expect(typeof provider.toolResultsMessage).toBe('function')
        expect(typeof provider.stream).toBe('function')
      }
      finally {
        if (original !== undefined)
          process.env.ANTHROPIC_API_KEY = original
        else delete process.env.ANTHROPIC_API_KEY
      }
    })

    it('detects OAuth tokens', () => {
      const original = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = 'sk-ant-oat-test-token'
      try {
        const provider = anthropic()
        expect(provider.meta.isOAuth).toBe(true)
      }
      finally {
        if (original !== undefined)
          process.env.ANTHROPIC_API_KEY = original
        else delete process.env.ANTHROPIC_API_KEY
      }
    })

    it('sets isOAuth false for regular API keys', () => {
      const original = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api-regular-key'
      try {
        const provider = anthropic()
        expect(provider.meta.isOAuth).toBe(false)
      }
      finally {
        if (original !== undefined)
          process.env.ANTHROPIC_API_KEY = original
        else delete process.env.ANTHROPIC_API_KEY
      }
    })

    it('formats tools in Anthropic format', () => {
      const original = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      try {
        const provider = anthropic()
        const tools = provider.formatTools([
          { name: 'test', description: 'A test tool', input_schema: { type: 'object', properties: {} } },
        ])
        expect(tools).toEqual([
          { name: 'test', description: 'A test tool', input_schema: { type: 'object', properties: {} } },
        ])
      }
      finally {
        if (original !== undefined)
          process.env.ANTHROPIC_API_KEY = original
        else delete process.env.ANTHROPIC_API_KEY
      }
    })

    it('creates user message with images in Anthropic format', () => {
      const original = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      try {
        const provider = anthropic()
        const msg = provider.userMessage('describe', [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ])
        expect(msg.role).toBe('user')
        const content = msg.content as any[]
        expect(content[0].type).toBe('image')
        expect(content[0].source.type).toBe('base64')
        expect(content[1]).toEqual({ type: 'text', text: 'describe' })
      }
      finally {
        if (original !== undefined)
          process.env.ANTHROPIC_API_KEY = original
        else delete process.env.ANTHROPIC_API_KEY
      }
    })

    it('creates tool results in Anthropic format', () => {
      const original = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
      try {
        const provider = anthropic()
        const msg = provider.toolResultsMessage([
          { id: 'tc1', content: 'output' },
        ])
        expect(msg.role).toBe('user')
        const content = msg.content as any[]
        expect(content[0].type).toBe('tool_result')
        expect(content[0].tool_use_id).toBe('tc1')
        expect(content[0].content).toBe('output')
      }
      finally {
        if (original !== undefined)
          process.env.ANTHROPIC_API_KEY = original
        else delete process.env.ANTHROPIC_API_KEY
      }
    })
  })

  describe('cerebras', () => {
    it('throws without CEREBRAS_API_KEY', () => {
      const original = process.env.CEREBRAS_API_KEY
      delete process.env.CEREBRAS_API_KEY
      try {
        expect(() => cerebras()).toThrow('CEREBRAS_API_KEY')
      }
      finally {
        if (original !== undefined)
          process.env.CEREBRAS_API_KEY = original
      }
    })

    it('creates provider with correct name and default model', () => {
      const original = process.env.CEREBRAS_API_KEY
      process.env.CEREBRAS_API_KEY = 'test-key'
      try {
        const provider = cerebras()
        expect(provider.name).toBe('cerebras')
        expect(provider.meta.defaultModel).toBe('zai-glm-4.7')
      }
      finally {
        if (original !== undefined)
          process.env.CEREBRAS_API_KEY = original
        else delete process.env.CEREBRAS_API_KEY
      }
    })

    it('accepts custom default model', () => {
      const original = process.env.CEREBRAS_API_KEY
      process.env.CEREBRAS_API_KEY = 'test-key'
      try {
        const provider = cerebras('gpt-oss-120b')
        expect(provider.meta.defaultModel).toBe('gpt-oss-120b')
      }
      finally {
        if (original !== undefined)
          process.env.CEREBRAS_API_KEY = original
        else delete process.env.CEREBRAS_API_KEY
      }
    })

    it('uses OpenAI-compat message helpers', () => {
      const original = process.env.CEREBRAS_API_KEY
      process.env.CEREBRAS_API_KEY = 'test-key'
      try {
        const provider = cerebras()

        // userMessage
        const user = provider.userMessage('hello')
        expect(user).toEqual({ role: 'user', content: 'hello' })

        // assistantMessage
        const asst = provider.assistantMessage('hi')
        expect(asst).toEqual({ role: 'assistant', content: 'hi' })

        // formatTools
        const tools = provider.formatTools([
          { name: 'test', description: 'desc', input_schema: {} },
        ])
        expect(tools[0]).toEqual({
          type: 'function',
          function: { name: 'test', description: 'desc', parameters: {} },
        })
      }
      finally {
        if (original !== undefined)
          process.env.CEREBRAS_API_KEY = original
        else delete process.env.CEREBRAS_API_KEY
      }
    })
  })

  describe('openrouter', () => {
    it('throws without OPENROUTER_API_KEY', () => {
      const original = process.env.OPENROUTER_API_KEY
      delete process.env.OPENROUTER_API_KEY
      try {
        expect(() => openrouter()).toThrow('OPENROUTER_API_KEY')
      }
      finally {
        if (original !== undefined)
          process.env.OPENROUTER_API_KEY = original
      }
    })

    it('creates provider with correct name and default model', () => {
      const original = process.env.OPENROUTER_API_KEY
      process.env.OPENROUTER_API_KEY = 'test-key'
      try {
        const provider = openrouter()
        expect(provider.name).toBe('openrouter')
        expect(provider.meta.defaultModel).toBe('anthropic/claude-sonnet-4-6')
      }
      finally {
        if (original !== undefined)
          process.env.OPENROUTER_API_KEY = original
        else delete process.env.OPENROUTER_API_KEY
      }
    })

    it('accepts custom default model', () => {
      const original = process.env.OPENROUTER_API_KEY
      process.env.OPENROUTER_API_KEY = 'test-key'
      try {
        const provider = openrouter('google/gemini-pro')
        expect(provider.meta.defaultModel).toBe('google/gemini-pro')
      }
      finally {
        if (original !== undefined)
          process.env.OPENROUTER_API_KEY = original
        else delete process.env.OPENROUTER_API_KEY
      }
    })

    it('uses OpenAI-compat message helpers', () => {
      const original = process.env.OPENROUTER_API_KEY
      process.env.OPENROUTER_API_KEY = 'test-key'
      try {
        const provider = openrouter()
        const user = provider.userMessage('test')
        expect(user).toEqual({ role: 'user', content: 'test' })
      }
      finally {
        if (original !== undefined)
          process.env.OPENROUTER_API_KEY = original
        else delete process.env.OPENROUTER_API_KEY
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Provider interface contract tests
// ---------------------------------------------------------------------------

describe('provider interface contract', () => {
  const providers = [
    {
      name: 'cerebras',
      factory: () => {
        process.env.CEREBRAS_API_KEY = 'test'
        return cerebras()
      },
    },
    {
      name: 'openrouter',
      factory: () => {
        process.env.OPENROUTER_API_KEY = 'test'
        return openrouter()
      },
    },
    {
      name: 'anthropic',
      factory: () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
        return anthropic()
      },
    },
  ]

  for (const { name, factory } of providers) {
    describe(name, () => {
      it('has all required Provider fields', () => {
        const provider = factory()
        expect(typeof provider.name).toBe('string')
        expect(typeof provider.meta).toBe('object')
        expect(typeof provider.formatTools).toBe('function')
        expect(typeof provider.userMessage).toBe('function')
        expect(typeof provider.assistantMessage).toBe('function')
        expect(typeof provider.toolResultsMessage).toBe('function')
        expect(typeof provider.stream).toBe('function')
      })

      it('userMessage returns correct role', () => {
        const provider = factory()
        const msg = provider.userMessage('test')
        expect(msg.role).toBe('user')
      })

      it('assistantMessage returns correct role', () => {
        const provider = factory()
        const msg = provider.assistantMessage('test')
        expect(msg.role).toBe('assistant')
      })
    })
  }
})
