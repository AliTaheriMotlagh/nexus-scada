import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.NEXUS_BACKEND ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/hubs': { target: backend, ws: true },
    },
  },
  worker: { format: 'es' },
  build: { outDir: 'dist', chunkSizeWarningLimit: 8000, sourcemap: false },
});
