import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// SignalK serves embedded webapps from a sub-path, so use relative asset URLs.
// The webapp builds into ../public, which the plugin package ships.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../src/core'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../public'),
    emptyOutDir: true,
  },
  server: {
    // allow importing the shared core module from outside the webapp root in dev
    fs: { allow: [resolve(__dirname, '..')] },
    // dev proxy so `npm run dev:webapp` can talk to a running SignalK server
    proxy: {
      '/plugins': 'http://localhost:3000',
      '/skServer': 'http://localhost:3000',
      '/signalk': { target: 'http://localhost:3000', ws: true },
    },
  },
});
