import { describe, expect, it } from 'vitest';
import { composeComponents } from '../../src/controller/endpoint/compose-components-endpoint.js';

describe('composeComponents validation', () => {
  it('ignores an obsolete agent option', async () => {
    await expect(composeComponents({ components: [], allFiles: [], agent: 'not-a-real-agent' })).resolves.toMatchObject(
      {
        components: [],
        warnings: [],
      },
    );
  });

  it('accepts a known agent without throwing', async () => {
    await expect(composeComponents({ components: [], allFiles: [], agent: 'claude' })).resolves.toMatchObject({
      components: [],
      warnings: [],
    });
  });

  it('does not require an agent', async () => {
    await expect(composeComponents({ components: [], allFiles: [] })).resolves.toMatchObject({
      components: [],
      warnings: [],
    });
  });

  it('ignores the obsolete forceAgent option', async () => {
    const result = await composeComponents({ components: [], allFiles: [], forceAgent: true });
    expect(result.components).toHaveLength(0);
  });
});
