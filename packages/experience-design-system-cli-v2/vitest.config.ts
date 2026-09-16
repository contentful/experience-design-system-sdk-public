import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    env: { FORCE_COLOR: '3' },
  },
});
