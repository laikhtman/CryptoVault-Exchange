import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  optimizeDeps: {
    // Let Vite pre-bundle @trezor/connect-web — it's CJS-only and must be
    // converted to ESM by esbuild before the browser can load it.
    // Excluding it (previous behaviour) served the raw CJS to the browser
    // which caused "exports is not defined" at runtime.
    include: ['@trezor/connect-web'],
  },
});
