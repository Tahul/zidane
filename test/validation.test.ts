import { describe, expect, it } from 'bun:test'
import { validateToolArgs } from '../src/tools/validation'

describe('validateToolArgs', () => {
  const schema = {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path'],
  }

  it('passes with all required fields present', () => {
    const result = validateToolArgs({ path: '/tmp/test' }, schema)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('passes with required + optional fields', () => {
    const result = validateToolArgs({ path: '/tmp/test', content: 'hello' }, schema)
    expect(result.valid).toBe(true)
  })

  it('fails when required field is missing', () => {
    const result = validateToolArgs({}, schema)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('path')
  })

  it('fails when required field is null', () => {
    const result = validateToolArgs({ path: null }, schema)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('path')
  })

  it('fails when required field is undefined', () => {
    const result = validateToolArgs({ path: undefined }, schema)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('path')
  })

  it('passes with no required fields in schema', () => {
    const noRequired = { type: 'object', properties: { path: { type: 'string' } } }
    const result = validateToolArgs({}, noRequired)
    expect(result.valid).toBe(true)
  })

  it('passes with extra unknown fields', () => {
    const result = validateToolArgs({ path: '/tmp', extra: 42 }, schema)
    expect(result.valid).toBe(true)
  })
})
