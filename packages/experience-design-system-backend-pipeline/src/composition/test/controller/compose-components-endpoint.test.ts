import { describe, expect, it } from 'vitest';
import { composeComponents } from '../../controller/compose-components-endpoint.js';

describe('composeComponents validation', () => {
  it('throws for an unknown agent name', async () => {
    await expect(composeComponents({ components: [], allFiles: [], agent: 'not-a-real-agent' })).rejects.toThrow(
      'Unknown agent: "not-a-real-agent"',
    );
  });

  it('accepts a known agent without throwing', async () => {
    await expect(composeComponents({ components: [], allFiles: [], agent: 'claude' })).resolves.toMatchObject({
      components: [],
      warnings: [],
    });
  });

  it('uses claude as default when agent is omitted', async () => {
    await expect(composeComponents({ components: [], allFiles: [] })).resolves.toMatchObject({
      components: [],
      warnings: [],
    });
  });

  it('passes forceAgent=false by default', async () => {
    const result = await composeComponents({ components: [], allFiles: [] });
    expect(result.components).toHaveLength(0);
  });
});
