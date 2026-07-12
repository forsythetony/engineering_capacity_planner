import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the backend so the browser fetches same-origin (no CORS
    // in dev). If the backend isn't running, the fetch fails and the UI falls
    // back to the bundled sample dataset.
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  preview: { port: 4173 },
});
