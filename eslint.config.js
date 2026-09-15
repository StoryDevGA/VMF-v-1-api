import js from '@eslint/js'

export default [
  { ignores: ['node_modules/**', 'coverage/**', 'tmp/**', 'logs/**', '.git/**'] },
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {
      ...js.configs.recommended.rules,
      // Existing Node/Jest globals and unused legacy exports need a separate inventory.
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
]
