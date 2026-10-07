import { describe, expect, it } from 'vitest';
import { selectComponents } from '../../controller/select-components-endpoint.js';

describe('selectComponents validation', () => {
  it('throws for an unknown agent name', async () => {
    await expect(
      selectComponents({ components: [], agent: 'not-a-real-agent' }),
    ).rejects.toThrow('Unknown agent: "not-a-real-agent"');
  });

  it('returns empty selections for empty component list without calling agent', async () => {
    await expect(
      selectComponents({ components: [], agent: 'claude' }),
    ).resolves.toEqual({ selections: [], warnings: [] });
  });

  it('uses claude as default when agent is omitted', async () => {
    await expect(
      selectComponents({ components: [] }),
    ).resolves.toEqual({ selections: [], warnings: [] });
  });
});
