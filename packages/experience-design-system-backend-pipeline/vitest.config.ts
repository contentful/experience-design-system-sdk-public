import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    pool: 'forks',
    maxWorkers: 4,
    retry: 1,
    passWithNoTests: true,
  },
});
