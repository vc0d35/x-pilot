import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { IPC } from './src/shared/ipc';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // The sidebar preload runs sandboxed, so it must be a single self-contained file:
    // a sandboxed preload cannot require() sibling chunks. Inline the channel table
    // instead of importing src/shared/ipc.ts, which the X preload also imports.
    define: { __XPILOT_IPC__: JSON.stringify(IPC) },
    build: {
      rollupOptions: {
        input: {
          x: resolve(__dirname, 'src/preload/x/index.ts'),
          sidebar: resolve(__dirname, 'src/preload/sidebar.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
