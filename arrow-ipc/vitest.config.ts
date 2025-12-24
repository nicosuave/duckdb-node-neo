import { defineConfig } from 'vitest/config';

// Native addons crash vitest workers before tests run without isolate: false.
// The wrapper script (scripts/run-tests.sh) handles the cleanup crash exit code.

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/build/**',
      '**/nanoarrow/**',
    ],
    isolate: false,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
