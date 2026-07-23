import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/review/ui.test.tsx'],
    globalSetup: ['test/setup/build.ts'],
    testTimeout: 30000,
    pool: 'forks',
    retry: 1,
  },
});
