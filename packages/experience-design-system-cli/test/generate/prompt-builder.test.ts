import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../src/generate/prompt-builder.js';

const INLINE_COMPONENTS = JSON.stringify([
  {
    name: 'Button',
    source: 'src/Button.tsx',
    framework: 'react',
    props: [],
    slots: [],
  },
]);

describe('buildPrompt', () => {
  it('autonomous preamble includes do-not-pause instruction', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('AUTONOMOUS mode');
    expect(prompt).toContain('do not pause to ask for confirmation');
  });

  it('interactive preamble does not include autonomous override', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'interactive',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('INTERACTIVE mode');
    expect(prompt).not.toContain('do not pause');
  });

  it('injects inline raw components JSON into the prompt', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('Raw component data (JSON)');
    expect(prompt).toContain('Button');
  });

  it('omits token sections when not provided', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).not.toContain('DTCG token data (for token kind lookups)');
    expect(prompt).not.toContain('Token-name sidecar (raw name');
  });

  it('inlines optional token data when provided', async () => {
    const tokensInline = JSON.stringify({ colors: { primary: { $type: 'color', $value: '#0066ff' } } });
    const tokenMapInline = JSON.stringify({ '--brand-primary': 'colors.primary' });
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      tokensInline,
      tokenMapInline,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('DTCG token data (for token kind lookups)');
    expect(prompt).toContain('colors.primary');
    expect(prompt).toContain('Token-name sidecar (raw name');
    expect(prompt).toContain('--brand-primary');
  });

  it('includes tool-call protocol instructions in autonomous mode', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('classify_prop');
    expect(prompt).toContain('exclude_prop');
    expect(prompt).toContain('classify_slot');
  });

  it('includes skill file content', async () => {
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: INLINE_COMPONENTS,
      outDir: '/fake/out',
    });
    // Skill file contains these headings
    expect(prompt).toContain('## Purpose');
    expect(prompt).toContain('Generate Components');
  });

  it('tokens autonomous preamble includes tool-call protocol instructions', async () => {
    const rawTokensInline = JSON.stringify([
      { name: '--color-primary', value: '#0066ff', source: 'css', inferredKind: 'color', ambiguous: false },
    ]);
    const prompt = await buildPrompt({
      skill: 'tokens',
      mode: 'autonomous',
      rawTokensInline,
      outDir: '/fake/out',
    });
    expect(prompt).toContain('set_token');
    expect(prompt).toContain('set_group');
    expect(prompt).not.toContain('<<<EDS_OUTPUT_START>>>');
  });
});
