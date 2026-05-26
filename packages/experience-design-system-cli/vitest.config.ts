import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/review/ui.test.tsx'],
    globalSetup: ['test/setup/build.ts'],
    testTimeout: 15000,
  },
});
