import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../../src/agents/prompts/build-prompt.js';

const generationSkillsRoot = new URL('../../../../experience-design-system-generation/skills/', import.meta.url);

describe('generation validation guidance', () => {
  it.each([
    {
      skill: 'components' as const,
      fileName: 'generate-components.md',
      outputRule: 'Every prop in the input has exactly one `classify_prop` or `exclude_prop` call',
      warningRule: 'Preserve unresolved warnings in the relevant `description` or `reason`',
    },
    {
      skill: 'tokens' as const,
      fileName: 'generate-tokens.md',
      outputRule: 'Every raw token in the input has exactly one `set_token` call',
      warningRule: 'Preserve unresolved warnings in the token `description`',
    },
  ])(
    'loads $skill guidance through packaged and fallback prompt paths',
    async ({ skill, fileName, outputRule, warningRule }) => {
      const options = { skill, mode: 'autonomous' as const, outDir: '/tmp/out' };
      const packagedPrompt = await buildPrompt({
        ...options,
        skillPathOverride: fileURLToPath(new URL(fileName, generationSkillsRoot)),
      });
      const fallbackPrompt = await buildPrompt(options);

      expect(packagedPrompt).toBe(fallbackPrompt);
      expect(packagedPrompt.includes('experience-design-system-cli print validate')).toBe(false);
      expect(packagedPrompt).toContain(outputRule);
      expect(packagedPrompt).toContain(warningRule);
    },
  );

  it('preserves open domains, declared requiredness, falsy defaults, and bounded-source uncertainty in the loaded skill', async () => {
    const prompt = await buildPrompt({ skill: 'components', mode: 'autonomous', outDir: '/tmp/out' });
    expect(prompt).toContain('The declared type and contract govern available alternatives and open domains');
    expect(prompt).toContain('a union that includes `string` or `number` remains open');
    expect(prompt).toContain("Preserve the input's declared prop `required` value");
    expect(prompt).toContain('including `false`, `0`, and the empty string');
    expect(prompt).toContain('Missing evidence does not close a domain');
  });
});
