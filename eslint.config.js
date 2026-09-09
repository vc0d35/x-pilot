const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

const nodeGlobals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  __dirname: 'readonly',
  module: 'writable',
  require: 'readonly',
  fetch: 'readonly',
};

const browserGlobals = {
  document: 'readonly',
  location: 'readonly',
  window: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  getComputedStyle: 'readonly',
};

module.exports = tseslint.config(
  { ignores: ['.claude/', 'out/', 'dist/', 'node_modules/', 'test-results/', 'playwright-report/', 'build/'] },

  js.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // Tool `execute`, the adapter bridge and the agent provider are async by contract: an
      // implementation with nothing to await still has to return a promise.
      '@typescript-eslint/require-await': 'off',
    },
  },

  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts'],
    rules: {
      // Test doubles feed raw JSON fixtures in and read `any` back out of `page.evaluate`; the
      // assertions are the check, so tracking `any` through a test body is noise.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // `expect(fake.method).toHaveBeenCalled()` reads a method as a value on purpose and never
      // calls it, which is exactly the shape this rule exists to flag.
      '@typescript-eslint/unbound-method': 'off',
      // The page scripts under test ship as raw source and are compiled with `new Function`.
      '@typescript-eslint/no-implied-eval': 'off',
    },
  },

  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...nodeGlobals, ...browserGlobals } },
  },

  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module' },
  },
);
