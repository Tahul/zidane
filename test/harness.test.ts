import { describe, expect, it } from 'bun:test'
import { harnesses } from '../src/harnesses'

// ---------------------------------------------------------------------------
// Harness: basic tools
// ---------------------------------------------------------------------------

describe('basic harness', () => {
  const tools = harnesses.basic

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
