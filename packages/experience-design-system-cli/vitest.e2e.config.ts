import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: [
      'test/import/headless.test.ts',
      'test/import/flags.test.ts',
      'test/import/tui/**/*.test.tsx',
      'test/apply/**/*.test.ts',
      'test/analyze/**/*.test.ts',
      'test/generate/**/*.test.ts',
      'test/session/**/*.test.ts',
    ],
    globalSetup: ['test/setup/build.ts'],
    testTimeout: 60000,
  },
});
