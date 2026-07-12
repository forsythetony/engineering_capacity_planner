import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// Read env (incl. the shared root .env) so nothing here is hardcoded.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  const apiTarget = env.VITE_API_TARGET || 'http://127.0.0.1:3001';
  const port = Number(env.VITE_PORT) || 5173;
  const previewPort = Number(env.VITE_PREVIEW_PORT) || 4173;

  return {
    plugins: [react()],
    // Read VITE_* app vars from the repo-root .env (one file for the whole app).
    envDir: repoRoot,
    server: {
      port,
      // Proxy API calls to the backend so the browser fetches same-origin (no
      // CORS in dev). If the backend is down, the fetch fails and the UI falls
      // back to the bundled sample dataset.
      proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    },
    preview: { port: previewPort },
  };
});
