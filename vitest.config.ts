import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Vitest configuration for unit / integration tests.
 *
 * Scope: domain logic, registries, validation, persistence adapters and component behaviour in
 * jsdom. End-to-end browser flows are a planned addition (docs/ROADMAP.md, Phase 2) and are
 * deliberately not faked here.
 */
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: [
        'src/core/**',
        'src/config/**',
        'src/lib/**',
        'src/state/**',
        'src/components/**',
        'src/app/**',
      ],
      exclude: ['src/content/generated/**', 'src/core/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
