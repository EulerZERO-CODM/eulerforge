import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * Browser-only globals the core must never reference.
 *
 * `Blob` is deliberately absent: it is a platform global Node provides as well, and the raster
 * pipeline returns one. `URL` is handled by `no-restricted-syntax` instead, because parsing a URL in
 * Node is legitimate while `URL.createObjectURL` is not.
 */
/**
 * The browser-test harness drives the production build from outside it (ADR-0018). Nothing the
 * application ships may import it: a spec must be able to fail without the product knowing it
 * exists, and the harness must never become a runtime dependency.
 *
 * Every block below that restricts imports includes this list. Flat config replaces a rule's options
 * wholesale rather than merging them, so a later block that omitted these patterns would silently
 * switch the ban off again - which is exactly what happened to the persistence ban in ADR-0018.
 */
const HARNESS_IMPORT_PATTERNS = [
  {
    group: ['**/e2e/**', '@playwright/**', 'playwright', 'playwright-core'],
    message:
      'Application code must not import the browser-test harness. The Playwright specs read persisted state instead (ADR-0018).',
  },
];

/** Components render; they may not reach into persistence directly. */
const PERSISTENCE_IMPORT_PATTERNS = [
  {
    // `**/core/persistence/**` catches the relative forms too: the patterns are matched against the
    // import as written, and a component two directories down writes `../../core/persistence/...`.
    group: [
      '**/core/persistence/**',
      '**/core/persistence',
      '@/core/persistence/**',
      '@/core/persistence',
    ],
    message:
      'Components must not import persistence directly. Use the store/repository layer (docs/ARCHITECTURE.md -> persistence boundary).',
  },
];

/** The core is framework-free: no browser adapters, no state layer, no React, no routes. */
const CORE_IMPORT_PATTERNS = [
  {
    group: [
      '**/lib/browser/**',
      '**/state/**',
      '**/components/**',
      '**/app/**',
      'react',
      'react-dom',
      'react-dom/*',
      'next',
      'next/*',
    ],
    message:
      'src/core/** is framework-free: no browser adapters, no state layer, no React, no routes (ADR-0019).',
  },
];

const DOM_ONLY_GLOBALS = [
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'self',
  'Image',
  'HTMLCanvasElement',
  'HTMLImageElement',
  'HTMLAnchorElement',
  'XMLHttpRequest',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'matchMedia',
  'getComputedStyle',
  'DOMParser',
  'ImageData',
  'Path2D',
  'OffscreenCanvas',
  'atob',
  'btoa',
];

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
    // Every shipped file, stated before the narrower blocks: flat config replaces a rule's options
    // rather than merging them, so each narrower block below repeats the harness ban alongside its
    // own patterns.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: HARNESS_IMPORT_PATTERNS }],
    },
  },

  {
    // Presentational components must not reach into persistence or the platform layer.
    files: ['src/components/**/*.tsx', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...HARNESS_IMPORT_PATTERNS, ...PERSISTENCE_IMPORT_PATTERNS] },
      ],
    },
  },

  {
    // The core must run without a browser: it is imported by Node tests, by the server renderer and
    // by the export pipeline, none of which have a `document`. Browser-only APIs live in
    // `src/lib/browser/**` and are composed with core values by the interface (ADR-0019).
    //
    // `no-restricted-globals` only reports references that resolve to a *global*, so a local
    // variable, parameter or field named `document` is unaffected - the core's document model is
    // full of those.
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...DOM_ONLY_GLOBALS.map((name) => ({
          name,
          message:
            'src/core/** stays DOM-free. Move the browser call behind src/lib/browser/** and take the value as an argument (ADR-0019).',
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          // `URL` itself is a standard global in Node; only the object-URL API is browser-only.
          selector:
            "MemberExpression[object.name='URL'][property.name=/^(create|revoke)ObjectURL$/]",
          message:
            'src/core/** stays DOM-free. Downloading a file is the job of src/lib/browser/download.ts (ADR-0019).',
        },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: [...HARNESS_IMPORT_PATTERNS, ...CORE_IMPORT_PATTERNS] },
      ],
    },
  },

  {
    // The storage boundary is the one core module that inspects a browser API, and it does so behind
    // a server-render guard: with no `window` it returns the volatile in-memory backend and reports
    // that cause, instead of pretending a project was saved (ADR-0006). Nothing else in the core may
    // reach for `window`; `document` and browser storage stay banned here too.
    files: ['src/core/persistence/storage.ts', 'src/core/persistence/storage*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...DOM_ONLY_GLOBALS.filter((name) => name !== 'window').map((name) => ({
          name,
          message:
            'Only the storage boundary may inspect browser APIs, and only through src/lib/browser/** (ADR-0019).',
        })),
      ],
    },
  },

  {
    // jsdom environment shims and test helpers legitimately check for APIs the DOM types claim exist.
    files: ['vitest.setup.ts', '**/*.test.{ts,tsx}', 'src/testing/**/*.{ts,tsx}'],
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
