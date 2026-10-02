import { describe, expect, it } from 'vitest';
import { buildPrompt, formatCustomPromptBanner } from '../../src/generate/services/prompt-service.js';

describe('prompt service', () => {
  it('assembles stage policy, inline context, and skill instructions in order', async () => {
    const prompt = await buildPrompt({
      skill: 'select',
      mode: 'autonomous',
      outDir: '/unused',
      rawComponentsInline: '{"name":"Card"}',
      skillContentOverride: 'CUSTOM_SKILL',
    });

    expect(prompt.indexOf('AUTONOMOUS mode')).toBeLessThan(prompt.indexOf('Raw component data'));
    expect(prompt.indexOf('Raw component data')).toBeLessThan(prompt.indexOf('Skill instructions follow:'));
    expect(prompt).toContain('CUSTOM_SKILL');
  });

  it('keeps the custom prompt warning wording stable', () => {
    expect(formatCustomPromptBanner('components', '/tmp/custom.md')).toContain(
      'Bundled invariants (utility-wrapper rejection, description content rules) do NOT apply.',
    );
  });
});
