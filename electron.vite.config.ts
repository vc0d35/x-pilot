import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { IPC } from './src/shared/ipc';

const DEV_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' http://localhost:*; connect-src 'self' ws://localhost:* http://localhost:*";

/** index.html ships the production policy; the dev server needs Vite's HMR socket and module URLs. */
function devCsp(): Plugin {
  return {
    name: 'xpilot-dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace(
        /(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/,
        (_m, before: string, after: string) => `${before}${DEV_CSP}${after}`,
      ),
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    define: { __XPILOT_IPC__: JSON.stringify(IPC) },
    build: {
      // Every preload runs sandboxed, where require() reaches only electron and node builtins,
      // so dependencies (zod) are bundled in rather than externalized.
      externalizeDeps: false,
      rollupOptions: {
        external: ['electron'],
        input: {
          x: resolve(__dirname, 'src/preload/x/index.ts'),
          sidebar: resolve(__dirname, 'src/preload/sidebar.ts'),
          view: resolve(__dirname, 'src/preload/view.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), devCsp()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
