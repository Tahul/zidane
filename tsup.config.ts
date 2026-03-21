import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    providers: 'src/providers/index.ts',
    tools: 'src/tools/index.ts',
    harnesses: 'src/harnesses/index.ts',
  },
  format: ['esm'],
  dts: {
    compilerOptions: {
      composite: false,
      allowImportingTsExtensions: false,
    },
  },
  clean: true,
})
