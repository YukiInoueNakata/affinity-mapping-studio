import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// kj-studio is the personal / individual edition.  Sync (Yjs / WebSocket) is
// permanently disabled here — the alias below always redirects sync imports
// to the no-op stub so Rollup never pulls Yjs into the bundle.

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  define: {
    __INCLUDE_SYNC__: 'false',
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src'),
      './sync/syncManager.js': resolve(__dirname, 'src/sync-stub/syncManager.ts'),
      './components/SyncConnectDialog.js': resolve(
        __dirname,
        'src/sync-stub/SyncConnectDialog.tsx'
      ),
      './components/SyncStatusBadge.js': resolve(
        __dirname,
        'src/sync-stub/SyncStatusBadge.tsx'
      ),
    },
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
  },
});
