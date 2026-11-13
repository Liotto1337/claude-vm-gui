import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { loadEnv } from 'vite';
import { bugReportOrigin } from './scripts/bug-report-origin';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ mode }) => {
  const origin = bugReportOrigin(loadEnv(mode, process.cwd()).VITE_BUG_REPORT_ORIGIN);
  return {
    main: {
      build: { externalizeDeps: true },
      // Версия из package.json: app.getVersion() при запуске out/main/index.js (E2E) отдаёт версию Electron
      define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUG_REPORT_ORIGIN__: JSON.stringify(origin) },
      resolve: { alias: { '@shared': resolve('src/shared') } },
    },
    preload: {
      build: { externalizeDeps: true },
      resolve: { alias: { '@shared': resolve('src/shared') } },
    },
    renderer: {
      root: 'src/renderer',
      resolve: { alias: { '@shared': resolve('src/shared') } },
      define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUG_REPORT_ORIGIN__: JSON.stringify(origin) },
      plugins: [react(), {
        name: 'cvg-csp',
        transformIndexHtml: (html) => html.replace('%CVG_BUG_REPORT_ORIGIN%', origin),
      }],
    },
  };
});
