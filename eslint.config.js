// @ts-check
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.{js,ts}',
      'scripts/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  // Non-engine packages: only the no-web rule (engine gets a stricter block below).
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@bible/web', '@bible/web/*'], message: 'Packages must not depend on the web app.' }] },
      ],
    },
  },
  // ---- THE HARD BOUNDARY (must come LAST so it wins for engine files). ----
  // The engine is pure, deterministic and standalone: no internal packages, no UI/DOM/storage deps,
  // no wall-clock, no Math.random.
  {
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bible/*'],
              message:
                'The engine must not import other internal packages — it is pure and standalone (it only owns types others import).',
            },
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*', 'zustand', 'framer-motion', 'i18next', 'react-i18next', 'idb-keyval'],
              message: 'The engine must be free of UI / DOM / storage dependencies.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Determinism: draw from the seeded RNG, never Math.random.' },
        { object: 'Date', property: 'now', message: 'Determinism: no wall-clock reads in the engine.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Determinism: no new Date() in the engine.' },
      ],
    },
  },
)
