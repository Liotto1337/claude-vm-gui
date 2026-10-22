import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  main: {
    build: { externalizeDeps: true },
    // Версия из package.json: app.getVersion() при запуске out/main/index.js (E2E) отдаёт версию Electron
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    build: { externalizeDeps: true },
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
  },
});
