import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// NOTE: `base` MUST match the GitHub Pages repo name. If you rename the repo,
// update this string AND the workflow at .github/workflows/deploy-pages.yml.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: '/squads-demo/',
    define: {
      'import.meta.env.VITE_API_BASE': JSON.stringify(
        env.VITE_API_BASE ?? 'http://localhost:8787',
      ),
    },
    test: {
      environment: 'jsdom',
      globals: true,
    },
  };
});
