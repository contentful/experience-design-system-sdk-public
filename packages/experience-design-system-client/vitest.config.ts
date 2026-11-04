import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.test.ts'],
    server: { deps: { inline: ['@contentful/experience-design-system-types'] } },
  },
});
