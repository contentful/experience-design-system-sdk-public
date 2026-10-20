import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@tui': fileURLToPath(new URL('./src/tui', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    env: { FORCE_COLOR: '3' },
  },
});
