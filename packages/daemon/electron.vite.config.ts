import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * electron-vite build config for the WDIOT daemon.
 *
 * - main:     Electron main process (tray, capture, storage, LLM, ingest).
 * - preload:  contextBridge scripts for each renderer window.
 * - renderer: two separate React entry points — the hotkey palette and the
 *             timeline viewer (plan repo layout, Boundary 1).
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          'palette-preload': resolve(__dirname, 'src/preload/palette-preload.ts'),
          'timeline-preload': resolve(__dirname, 'src/preload/timeline-preload.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          palette: resolve(__dirname, 'src/renderer/palette/index.html'),
          timeline: resolve(__dirname, 'src/renderer/timeline/index.html'),
        },
      },
    },
  },
});
