import { describe, expect, it } from 'vitest';
import { generateComponents } from '../../../src/generation/controller/generate-components-endpoint.js';

describe('generateComponents validation', () => {
  it('throws for an unknown agent name', async () => {
    await expect(
      generateComponents({ components: [], agent: 'not-a-real-agent' }),
    ).rejects.toThrow('Unknown agent: "not-a-real-agent"');
  });

  it('passes validation and delegates to service with valid agent', async () => {
    await expect(
      generateComponents({ components: [], agent: 'claude' }),
    ).rejects.toThrow('runGenerationService not yet implemented');
  });

  it('uses claude as default when agent is omitted', async () => {
    await expect(
      generateComponents({ components: [] }),
    ).rejects.toThrow('runGenerationService not yet implemented');
  });
});
