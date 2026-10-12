import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * Flat ESLint config.
 *
 * - `eslint-config-next/core-web-vitals` already includes the Next.js TypeScript config, so that
 *   preset lives in one place (ADR-0003).
 * - Type-aware linting is enabled for `src/**` using `recommendedTypeChecked` plus a curated set of
 *   stricter rules. The full `strictTypeChecked` preset was rejected: it flags deliberate patterns
 *   such as promise-returning storage interfaces and documented defensive checks, and a lint config
 *   nobody can keep green is worse than a smaller one everybody respects.
 * - Test and setup files opt out of rules that are noise outside of application code.
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'coverage/**',
      'next-env.d.ts',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },

  ...nextCoreWebVitals,

  ...tseslint.configs.recommendedTypeChecked.map((preset) => ({
    ...preset,
    files: ['**/*.{ts,tsx}'],
  })),

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: rootDir,
      },
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],
      // Storage, catalogue and repository interfaces are promise-based on purpose so a remote
      // implementation can replace the local one without changing call sites (ADR-0006). Methods
      // that resolve synchronously therefore legitimately have no `await`.
      '@typescript-eslint/require-await': 'off',
      // `type` aliases and `interface` are both used deliberately: `type` for data shapes, and
      // `interface` for the contracts other modules implement (storage, repositories, catalogues).
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },

  {
    files: ['src/components/**/*.tsx', 'src/app/**/*.tsx'],
    rules: {
      // Presentational components must not reach into persistence or the platform layer.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/core/persistence/**', '@/core/persistence', '../core/persistence/**'],
              message:
                'Components must not import persistence directly. Use the store/repository layer (docs/ARCHITECTURE.md → persistence boundary).',
            },
          ],
        },
      ],
    },
  },

  {
    // jsdom environment shims and test helpers legitimately check for APIs the DOM types claim exist.
    files: ['vitest.setup.ts', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      'no-console': 'off',
    },
  },
];

export default config;
