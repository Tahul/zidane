import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    providers: 'src/providers/index.ts',
  },
  format: ['esm'],
  dts: {
    tsconfig: 'tsconfig.build.json',
    compilerOptions: {
      composite: false,
      allowImportingTsExtensions: false,
    },
  },
  clean: true,
})
