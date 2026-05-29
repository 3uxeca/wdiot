import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
    // Node by default (schema/storage tests). React renderer tests opt into a
    // DOM environment with a per-file `// @vitest-environment jsdom` directive.
    environment: 'node',
    globals: false,
  },
});
