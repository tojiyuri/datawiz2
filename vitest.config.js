import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['server/__tests__/**/*.test.js'],
    testTimeout: 15000,
    setupFiles: ['./server/__tests__/_setup.js'],
    pool: 'forks',          // each test file gets a fresh process — clean DB state
    poolOptions: {
      forks: { singleFork: false },
    },
    silent: false,
  },
});
