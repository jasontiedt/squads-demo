import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the Echoes of Emperors two-browser handoff scenario.
 *
 * We spin up TWO local servers via `webServer`:
 *  1. The Cloudflare Worker (`wrangler dev`) on :8787 — backed by
 *     Miniflare's in-memory KV (no real Cloudflare account needed).
 *  2. The web app via `vite build && vite preview` on :5174.
 *     We must use `vite preview`, NOT `vite dev`, because
 *     `App.tsx` only wires the real network API when
 *     `import.meta.env.PROD` is true.
 *
 * The web build is told to hit the local Worker via `VITE_WORKER_URL`.
 * Vite serves under the GH Pages base path `/squads-demo/`, so our
 * `baseURL` includes that prefix.
 *
 * Concurrency: this scenario is stateful (gameCode collisions in
 * in-memory KV, single Worker instance), so we keep `workers: 1`.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:5174/squads-demo/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Worker: Miniflare-backed KV, no production deploy needed.
      command: 'npx wrangler dev --port 8787 --local',
      cwd: '../worker',
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Web: vite preview serves the production build so the real
      // network API (RealGameApi) is used instead of MockGameApi.
      command: 'pnpm exec vite build && pnpm exec vite preview --port 5174 --strictPort',
      cwd: '../web',
      port: 5174,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        VITE_WORKER_URL: 'http://localhost:8787',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
