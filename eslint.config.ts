import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'app',
  typescript: true,
  jsonc: false,
  yaml: false,
  markdown: false,
  rules: {
    'no-console': 'off',
    'node/prefer-global/process': 'off',
  },
})
