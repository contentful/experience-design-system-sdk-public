import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    // ink/chalk disable color when stdout is not a TTY, which it never is under
    // vitest. Forcing truecolor makes rendered frames carry the same escape
    // codes a real terminal gets, so theme assertions are meaningful.
    env: { FORCE_COLOR: '3' },
  },
});
