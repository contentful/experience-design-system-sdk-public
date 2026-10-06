import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    pool: 'forks',
    retry: 1,
    passWithNoTests: true,
  },
});
