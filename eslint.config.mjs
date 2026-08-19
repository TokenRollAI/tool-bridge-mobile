import { defineConfig } from 'eslint/config'
import expoConfig from 'eslint-config-expo/flat.js'

export default defineConfig([
  ...expoConfig,
  {
    ignores: [
      '.expo/**',
      'android/**',
      'coverage/**',
      'dist/**',
      'ios/**',
      'node_modules/**',
    ],
    rules: {
      'import/order': ['error', {
        alphabetize: { caseInsensitive: true, order: 'asc' },
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
        'newlines-between': 'always',
      }],
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
])
