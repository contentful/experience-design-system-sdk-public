import { describe, expect, it } from 'vitest';
import { buildPrompt } from '@contentful/experience-design-system-generation';

const INLINE_COMPONENTS = JSON.stringify([
  {
    name: 'TestComponent',
    source: 'src/TestComponent.tsx',
    framework: 'react',
    props: [],
    slots: [],
  },
]);

describe('prompt-builder lockstep (skill ↔ autonomous preamble)', () => {
  it('never instructs the model to emit values for token props', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).not.toMatch(/(?<!not\s)include\s+`?values`?\s+for\s+`?cdf_type:\s*"token"/i);
    expect(prompt).toMatch(/do not include `values` for `cdf_type: "token"`/i);
  });

  it('states the cardinality rule in the condensed preamble', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toMatch(/cardinality/i);
  });
});
