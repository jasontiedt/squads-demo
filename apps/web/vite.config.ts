import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// NOTE: `base` MUST match the GitHub Pages repo name. If you rename the repo,
// update this string AND the workflow at .github/workflows/deploy-pages.yml.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Worker URL precedence (also mirrored in src/App.tsx):
  //   VITE_WORKER_URL  — preferred name, used by deploy workflow
  //   VITE_API_BASE    — legacy alias
  //   localhost:8787   — `wrangler dev` default
  const workerUrl =
    env.VITE_WORKER_URL ?? env.VITE_API_BASE ?? 'http://localhost:8787';
  return {
    plugins: [react()],
    base: '/squads-demo/',
    define: {
      'import.meta.env.VITE_WORKER_URL': JSON.stringify(workerUrl),
      // Kept defined for any consumer still reading the legacy name.
      'import.meta.env.VITE_API_BASE': JSON.stringify(workerUrl),
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test-setup.ts'],
    },
  };
});
