import { describe, expect, it } from 'vitest';

describe('index', () => {
  it('re-exports the generated module without throwing', async () => {
    await expect(import('./index.js')).resolves.toBeDefined();
  });
});
