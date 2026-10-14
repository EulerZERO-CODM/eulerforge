import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level verification.
 *
 * These tests drive the *production build* in a real Chromium: pointer capture, canvas
 * rasterisation, real downloads and real focus behaviour cannot be verified in jsdom, so they are
 * kept out of the unit suite and run as their own CI job (`.github/workflows/ci.yml` -> `browser`).
 *
 * The suite is deliberately small and lives outside `src/`, so the application never depends on it:
 * nothing here is imported by application code, and the only hooks the app exposes are inert `data-*`
 * attributes already used by the component tests.
 */

const PORT = Number(process.env.E2E_PORT ?? 3120);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // The suite mutates a local document store and downloads files; running files in parallel inside
  // one file would make the assertions about history order fragile, so keep it sequential.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined && process.env.CI !== '',
  // No retries anywhere: a browser suite that only passes on the second attempt is not evidence.
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // The `github` reporter is what turns a failure into a check-run annotation: the run's log and
  // artifacts live in storage this repository's tooling cannot always fetch, so the failure text is
  // published through the API instead of only in a screenshot.
  reporter:
    process.env.CI === undefined || process.env.CI === ''
      ? [['list']]
      : [['list'], ['github'], ['html', { open: 'never' }]],
  outputDir: './test-results',
  use: {
    baseURL: BASE_URL,
    // Real downloads are part of the contract (PNG/JPEG export), so they must be accepted: each one
    // lands in Playwright's own temporary directory and the specs read its bytes from `download.path()`
    // before it is cleaned up. Nothing is written into the repository.
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    // A wide window keeps the whole stage and the inspector rail on screen, so the pointer maths in
    // the specs never has to scroll the artboard into view.
    viewport: { width: 1440, height: 960 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `next start` serves the production build (`npm run build` runs first in CI).
    command: `npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: process.env.CI === undefined || process.env.CI === '',
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: '1' },
  },
});
